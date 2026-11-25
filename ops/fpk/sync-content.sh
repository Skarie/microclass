#!/bin/bash
#
# 微课堂 —— 把 Docker 生产（8091 / 卷 microclass_data）的「内容数据」
# 单向快照同步到 fnOS 原生应用（8092 / /vol1/@appdata/microclass/data）。
#
# 同步范围（内容）：课程、章节、课时、知识点、题库、题目、题目配图、题组、标签、公告、
#                   课程练习链接、题目体检缓存，以及 uploads/ knowledge-media/ cover-cache/。
# 不同步（各自独立）：账号、会话、学习进度、练习/考试记录、错题、笔记、收藏、审计日志；
#                    FPK 侧只保留 admin 一个账号，且**保留 FPK 自己的 admin 凭据**
#                    （密码即 /vol1/@appdata/microclass/adminpass，不会被 Docker 的密码覆盖）。
# 不复制：media-cache/（HLS 转码缓存，可按需重建）、backups/、import/、bank-import-results/。
#
# 用法：
#   sudo bash ops/fpk/sync-content.sh                    # 完整同步
#   sudo MC_SYNC_VACUUM=1 bash ops/fpk/sync-content.sh   # 同步后 vacuum（慢，回收已删行占用的页）
#   sudo MC_BACKUP_FULL=1 bash ops/fpk/sync-content.sh   # 备份完整数据目录（含 uploads，较慢）
#   sudo bash ops/fpk/sync-content.sh --compare          # 只对比两边内容计数，不改数据
#
# 流程：停两边写入 → 备份 FPK 数据/凭据 → 复制内容 → 剥离非 admin 账号与行为表 → 还原 FPK 的 admin
# 凭据 → 启动两边 → 打印健康与内容计数对比。
#
# 幂等：可反复执行；每次都是一次性快照，之后两边各自新增的内容需要再次同步，以最后一次为准。
# 安全：只读 Docker 卷、只写 FPK 数据目录；用 compose stop/start（不做 down），失败会自动把两边拉起来。
set -uo pipefail

APP="microclass"
SRC_DIR="${MC_SRC_DIR:-/vol1/docker/volumes/microclass_data/_data}"
DST_DIR="${MC_DST_DIR:-/vol1/@appdata/microclass/data}"
COMPOSE_DIR="${MC_COMPOSE_DIR:-/vol1/1000/microclass-deploy}"
COMPOSE_FILE="${MC_COMPOSE_FILE:-compose.evo4.yml}"
BACKUP_DIR="${MC_BACKUP_DIR:-/vol1/1000/microclass-backup}"
NODE_BIN="${MC_NODE_BIN:-/vol1/@appcenter/nodejs_v22/bin/node}"
HELPER="/tmp/mc-sync-db.mjs"
TS="$(date '+%Y%m%d-%H%M%S')"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
die() {
    echo "[$(date '+%H:%M:%S')] ✗ $*" >&2
    exit 1
}

# ---------- 内嵌 node 助手：剥离账号/行为表、内容计数对比 ----------
write_helper() {
    cat > "${HELPER}" <<'MJS'
/** microclass 内容同步助手：strip（剥离账号与行为数据）/ compare（内容计数对比）
 *  dump-admin / restore-admin：保留并使用 FPK 自己的 admin 凭据（账号不共享） */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const BEHAVIOR = [
  'watch_intervals', 'lesson_progress', 'lesson_notes', 'attempts',
  'exam_attempts', 'wrong_questions', 'favorites', 'audit_logs',
];
const CONTENT = [
  'courses', 'lessons', 'knowledge', 'banks', 'questions', 'question_groups',
  'tags', 'question_tags', 'announcements', 'categories', 'bank_folders',
  'practice_links', 'practice_link_lessons',
];
const LABEL = {
  courses: '课程', lessons: '课时', knowledge: '知识点', banks: '题库', questions: '题目',
  question_groups: '题组', tags: '标签', question_tags: '题目-标签', announcements: '公告',
  categories: '分类', bank_folders: '题库文件夹', practice_links: '练习链接',
  practice_link_lessons: '练习链接课时',
};
const tablesOf = (db) =>
  new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name),
  );
const count = (db, t) =>
  tablesOf(db).has(t) ? db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c : null;

function strip(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  const t = tablesOf(db);
  const admins = db.prepare("SELECT id, username FROM users WHERE username = 'admin'").all();
  if (admins.length === 0) {
    console.error('✗ users 表没有 admin，拒绝剥离');
    process.exit(1);
  }
  const keepId = admins[0].id;
  console.log(`保留 admin：id=${keepId}`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const name of BEHAVIOR) {
      if (!t.has(name)) continue;
      const n = db.prepare(`DELETE FROM "${name}"`).run().changes;
      console.log(`  清空 ${name}: ${n} 行`);
    }
    const u = db.prepare('DELETE FROM users WHERE id <> ?').run(keepId).changes;
    console.log(`  删除非 admin 用户: ${u} 行`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('✗ 剥离失败已回滚:', e.message);
    process.exit(1);
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  console.log(fk.length === 0 ? '✓ 外键完整' : `✗ 外键违规 ${fk.length} 条`);
  for (const r of db.prepare('SELECT id, username, role FROM users').all()) {
    console.log(`  users: ${JSON.stringify(r)}`);
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  if (process.env.MC_SYNC_VACUUM === '1') {
    const t0 = Date.now();
    process.stdout.write('VACUUM 中…');
    db.exec('VACUUM');
    console.log(` 完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  db.close();
}

function compare(srcFile, dstFile) {
  const src = new DatabaseSync(srcFile, { readOnly: true });
  const dst = new DatabaseSync(dstFile, { readOnly: true });
  console.log('内容表对比（Docker 8091 → FPK 8092）');
  console.log('表'.padEnd(22) + 'Docker'.padStart(10) + 'FPK'.padStart(10) + '   一致');
  let allOk = true;
  for (const t of CONTENT) {
    const a = count(src, t);
    const b = count(dst, t);
    const ok = a === b;
    if (!ok) allOk = false;
    console.log(`${(LABEL[t] ?? t).padEnd(20)}${String(a).padStart(10)}${String(b).padStart(10)}   ${ok ? '✓' : '✗'}`);
  }
  for (const t of BEHAVIOR) {
    const b = count(dst, t);
    if (b === null) continue;
    console.log(`${('(用户)' + (LABEL[t] ?? t)).padEnd(20)}${'—'.padStart(10)}${String(b).padStart(10)}   ${b === 0 ? '✓ 已清空' : '✗ 仍有数据'}`);
  }
  const du = count(dst, 'users');
  const su = count(src, 'users');
  console.log(`${'账号'.padEnd(20)}${String(su).padStart(10)}${String(du).padStart(10)}   ${du === 1 ? '✓ 仅 admin' : '✗'}`);
  console.log(allOk ? '\n✓ 内容计数完全一致' : '\n✗ 内容计数存在差异');
  src.close();
  dst.close();
  process.exit(allOk ? 0 : 1);
}

const mode = process.argv[2];

/** 导出 FPK 自己的 admin 凭据（同步前） */
function dumpAdmin(dbFile, outFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const row = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  if (!row) {
    console.error('✗ 没有 admin 行，跳过凭据保留');
    process.exit(1);
  }
  writeFileSync(outFile, JSON.stringify(row, null, 2));
  console.log(`已保留 FPK 的 admin 凭据（display_name=${row.display_name}）`);
  db.close();
}

/** 把 FPK 自己的 admin 凭据写回（同步后，覆盖 Docker 的 admin 密码） */
function restoreAdmin(dbFile, jsonFile) {
  const saved = JSON.parse(readFileSync(jsonFile, 'utf8'));
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON');
  const target = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!target) {
    console.error('✗ 目标库没有 admin 行，无法还原凭据');
    process.exit(1);
  }
  db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ?, display_name = ?, created_at = ? WHERE id = ?').run(
    saved.pass_salt,
    saved.pass_hash,
    saved.display_name,
    saved.created_at,
    target.id,
  );
  console.log(`已还原 FPK 的 admin 凭据到 id=${target.id}（密码仍是 $TRIM_PKGVAR/adminpass 里那份）`);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

if (mode === 'strip') strip(process.argv[3]);
else if (mode === 'compare') compare(process.argv[3], process.argv[4]);
else if (mode === 'dump-admin') dumpAdmin(process.argv[3], process.argv[4]);
else if (mode === 'restore-admin') restoreAdmin(process.argv[3], process.argv[4]);
else {
  console.error('用法: node mc-sync-db.mjs strip|compare|dump-admin|restore-admin …');
  process.exit(2);
}
MJS
}

# ---------- 服务启停 / 健康检查 ----------
start_fpk() {
    appcenter-cli start "${APP}" >/dev/null 2>&1 || /var/apps/${APP}/cmd/main start >/dev/null 2>&1
}
stop_fpk() {
    appcenter-cli stop "${APP}" >/dev/null 2>&1 || /var/apps/${APP}/cmd/main stop >/dev/null 2>&1
}
start_docker() {
    (cd "${COMPOSE_DIR}" && docker compose -f "${COMPOSE_FILE}" start api >/dev/null 2>&1)
}
stop_docker() {
    (cd "${COMPOSE_DIR}" && docker compose -f "${COMPOSE_FILE}" stop api >/dev/null 2>&1)
}

wait_http() {
    local url=$1 timeout=${2:-90} i=0
    while [ ${i} -lt ${timeout} ]; do
        if curl -fsS -m 3 "${url}" >/dev/null 2>&1; then return 0; fi
        sleep 2
        i=$((i + 2))
    done
    return 1
}

# fnOS 会在 stop 之后十几秒把应用重新拉起，必须先确认它真的停了才能复制库，
# 否则会复制到写了一半的 SQLite（实测：stop 后 12 秒被自动 start）。
fpk_running() {
    pgrep -f "microclass/server/dist/server.js" >/dev/null 2>&1
}

ensure_fpk_down() {
    local tries=0
    while [ ${tries} -lt 8 ]; do
        if ! fpk_running; then
            # 停住后再观察一段时间，避免「延迟拉起」正好卡在复制过程中
            sleep 15
            if ! fpk_running; then
                return 0
            fi
        fi
        log "检测到 FPK 进程（可能被 fnOS 重新拉起），再次停止…"
        stop_fpk
        sleep 6
        tries=$((tries + 1))
    done
    return 1
}

# ---------- 只读对比模式 ----------
if [ "${1:-}" = "--compare" ]; then
    [ "$(id -u)" -eq 0 ] || die "需要 root 执行"
    [ -x "${NODE_BIN}" ] || NODE_BIN="$(command -v node)" || die "找不到 node"
    write_helper
    "${NODE_BIN}" "${HELPER}" compare "${SRC_DIR}/microclass.db" "${DST_DIR}/microclass.db" 2>/dev/null
    exit $?
fi

# ---------- 前置检查 ----------
[ "$(id -u)" -eq 0 ] || die "需要 root 执行（sudo bash ops/fpk/sync-content.sh）"
[ -d "${SRC_DIR}" ] || die "找不到 Docker 数据目录：${SRC_DIR}"
[ -f "${SRC_DIR}/microclass.db" ] || die "找不到源数据库：${SRC_DIR}/microclass.db"
[ -d "${DST_DIR}" ] || die "找不到 FPK 数据目录：${DST_DIR}"
[ -d "${COMPOSE_DIR}" ] || die "找不到部署目录：${COMPOSE_DIR}"
[ -x "${NODE_BIN}" ] || NODE_BIN="$(command -v node)" || die "找不到 node（可设 MC_NODE_BIN）"
command -v curl >/dev/null || die "需要 curl 做健康检查"

# 失败时尽量把两边重新拉起来，避免留下「都停着」的状态
on_error() {
    echo "[$(date '+%H:%M:%S')] ✗ 同步失败，尝试恢复服务…" >&2
    start_fpk || echo "  （FPK 启动失败，请查看 /vol1/@appdata/microclass/info.log）" >&2
    start_docker || echo "  （docker 启动失败，请查看 compose logs）" >&2
    exit 1
}
trap on_error ERR

# ---------- 主流程 ----------
log "=== 微课堂内容同步（Docker → fnOS FPK）==="
log "源：${SRC_DIR}"
log "目标：${DST_DIR}"

# 1) 记录 FPK 运行用户（停之前）
OWNER=""
if [ -f /vol1/@appdata/${APP}/app.pid ]; then
    OWNER="$(ps -o user= -p "$(cat /vol1/@appdata/${APP}/app.pid)" 2>/dev/null | tr -d ' ')"
fi
[ -n "${OWNER}" ] || OWNER="$(stat -c '%U' "${DST_DIR}")"
log "目标文件归属将设为：${OWNER}"

# 1b) 先保留 FPK 自己的 admin 凭据：复制会把 Docker 的 admin 密码带过来，
#     账号不共享，同步结束后必须换回 FPK 这份（密码即 $TRIM_PKGVAR/adminpass）。
ADMIN_JSON="/tmp/mc-sync-admin-${TS}.json"
KEEP_ADMIN=0
if [ -f "${DST_DIR}/microclass.db" ]; then
    write_helper
    if "${NODE_BIN}" "${HELPER}" dump-admin "${DST_DIR}/microclass.db" "${ADMIN_JSON}" 2>/dev/null; then
        KEEP_ADMIN=1
    else
        log "（未取到现有 admin 凭据：同步后管理员密码会变成 Docker 的）"
    fi
else
    log "（目标库不存在：本次为首次同步，管理员密码沿用 Docker 的 admin）"
fi

# 2) 停写（先停再备份：避免 tar 到半写状态的 SQLite）
log "停止 FPK 应用…"
stop_fpk || log "（FPK 可能本来就没运行）"
log "停止 docker api（compose stop，不做 down）…"
stop_docker || die "docker compose stop 失败，已中止（数据未改动）"
sleep 2

if ! ensure_fpk_down; then
    log "✗ 无法让 FPK 停下（反复被拉起），拒绝继续（避免复制到中间态）"
    on_error
fi
log "✓ 两边均已停写（FPK 已确认停住）"

# 3) 备份 FPK 现有数据（停写后备份，保证一致性）
mkdir -p "${BACKUP_DIR}"
BK="${BACKUP_DIR}/fpk-data-${TS}.tar.gz"
ITEMS="microclass.db .secret knowledge-media cover-cache"
for extra in microclass.db-wal microclass.db-shm; do
    if [ -e "${DST_DIR}/${extra}" ]; then ITEMS="${ITEMS} ${extra}"; fi
done
if [ "${MC_BACKUP_FULL:-0}" = "1" ]; then
    log "备份 FPK 完整数据目录（含 uploads，较慢）→ ${BK}"
    tar -I 'gzip -1' -cf "${BK}" -C "$(dirname "${DST_DIR}")" "$(basename "${DST_DIR}")" || die "备份失败，已中止（数据未改动）"
else
    log "备份 FPK 数据库与配置（不含 uploads/media-cache：媒体每次都会从 Docker 卷重新复制）→ ${BK}"
    tar -I 'gzip -1' -cf "${BK}" -C "${DST_DIR}" ${ITEMS} || die "备份失败，已中止（数据未改动）"
fi
log "备份完成：$(du -h "${BK}" | cut -f1)"

# 备份期间 FPK 也可能被重新拉起，复制前再确认一次
if ! ensure_fpk_down; then
    log "✗ 备份后 FPK 又被拉起且停不下来，拒绝复制"
    on_error
fi

# 4) 复制内容：db + uploads + knowledge-media + cover-cache
log "清空目标 db 与内容目录（保留目录本身）…"
rm -f "${DST_DIR}/microclass.db" "${DST_DIR}/microclass.db-wal" "${DST_DIR}/microclass.db-shm"
mkdir -p "${DST_DIR}/uploads" "${DST_DIR}/knowledge-media" "${DST_DIR}/cover-cache"
rm -rf "${DST_DIR:?}"/uploads/* "${DST_DIR:?}"/knowledge-media/* "${DST_DIR:?}"/cover-cache/*

log "复制 microclass.db（$(du -h "${SRC_DIR}/microclass.db" | cut -f1)）…"
cp -a "${SRC_DIR}/microclass.db" "${DST_DIR}/microclass.db" || die "db 复制失败"
for f in microclass.db-wal microclass.db-shm; do
    if [ -f "${SRC_DIR}/${f}" ]; then cp -a "${SRC_DIR}/${f}" "${DST_DIR}/${f}"; fi
done

log "复制 uploads（$(du -sh "${SRC_DIR}/uploads" | cut -f1)）…"
cp -a "${SRC_DIR}/uploads/." "${DST_DIR}/uploads/" || die "uploads 复制失败"
log "复制 knowledge-media（$(du -sh "${SRC_DIR}/knowledge-media" | cut -f1)）…"
cp -a "${SRC_DIR}/knowledge-media/." "${DST_DIR}/knowledge-media/" || die "knowledge-media 复制失败"
if [ -d "${SRC_DIR}/cover-cache" ]; then
    cp -a "${SRC_DIR}/cover-cache/." "${DST_DIR}/cover-cache/" 2>/dev/null || true
fi
log "跳过 media-cache（HLS 转码缓存，可在 FPK 侧按需重建）"

chown -R "${OWNER}:${OWNER}" "${DST_DIR}" || die "chown 失败"
log "✓ 内容复制完成，归属 ${OWNER}"

# 5) 剥离账号与行为数据（只在 FPK 库上做）
write_helper
log "剥离 FPK 库中的非 admin 账号与用户行为数据…"
"${NODE_BIN}" "${HELPER}" strip "${DST_DIR}/microclass.db" 2>/dev/null || die "剥离失败（FPK 库保持复制后的状态）"

if [ "${KEEP_ADMIN}" = "1" ] && [ -f "${ADMIN_JSON}" ]; then
    log "还原 FPK 自己的 admin 凭据（密码不随内容同步）…"
    "${NODE_BIN}" "${HELPER}" restore-admin "${DST_DIR}/microclass.db" "${ADMIN_JSON}" 2>/dev/null ||
        log "✗ 还原 admin 凭据失败：管理员密码已变成 Docker 的那份"
fi
chown "${OWNER}:${OWNER}" "${DST_DIR}/microclass.db" || true
if [ -f "${DST_DIR}/microclass.db-wal" ]; then chown "${OWNER}:${OWNER}" "${DST_DIR}/microclass.db-wal"; fi

# 6) 启动两边并等待健康
trap - ERR
log "启动 docker api…"
start_docker || die "docker 启动失败"
log "启动 FPK 应用…"
start_fpk || die "FPK 启动失败，见 /vol1/@appdata/microclass/info.log"

log "等待 docker 8091 就绪…"
wait_http "http://127.0.0.1:8091/api/v1/healthz" 120 || log "✗ docker 健康检查超时"
log "等待 FPK 8092 就绪（大库首次启动稍慢）…"
wait_http "http://127.0.0.1:8092/api/v1/healthz" 180 || log "✗ FPK 健康检查超时"

# 7) 结果对比
echo
log "=== 健康与版本 ==="
echo "docker 8091 healthz: $(curl -s -m 5 http://127.0.0.1:8091/api/v1/healthz)"
echo "docker 8091 version: $(curl -s -m 5 http://127.0.0.1:8091/api/v1/version)"
echo "fpk    8092 healthz: $(curl -s -m 5 http://127.0.0.1:8092/api/v1/healthz)"
echo "fpk    8092 version: $(curl -s -m 5 http://127.0.0.1:8092/api/v1/version)"
echo
"${NODE_BIN}" "${HELPER}" compare "${SRC_DIR}/microclass.db" "${DST_DIR}/microclass.db" 2>/dev/null
echo
log "完成。账号未同步：FPK 仍用 admin + /vol1/@appdata/microclass/adminpass。"
log "提醒：这是一次性快照，之后两边新增内容需再次执行本脚本，以最后一次同步为准。"
