# 安全设计与复核记录

本文件记录微课堂 V2 的安全模型、本轮复核发现的问题与修复，以及待办加固项。
复核方式：`apps/api/test/security.test.ts`（33 个用例）覆盖未登录矩阵、越权矩阵、会话、
上传白名单、下载处置与限流；其余为人工代码审查。

## 1. 认证与会话

| 项目     | 实现                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 会话载体 | 签名 Cookie `microclass_sid`（HttpOnly、SameSite=Lax、Path=/、7 天）                                              |
| 令牌     | HMAC-SHA256 签名的 base64url 载荷（含 uid 与过期时间），密钥来自 `MC_SESSION_SECRET` 或数据目录 `.secret`（0600） |
| 密码     | scrypt（N=16384, r=8, p=1），每用户独立 salt；策略：≥6 位、≤128 位                                                |
| 登录失败 | 统一返回「用户名或密码错误」，不区分账号是否存在（有测试断言两种响应的 message 完全一致）                         |
| 退出     | `POST /api/v1/auth/logout` 清 Cookie                                                                              |

失效与越权：Cookie 被篡改/伪造（改签名、改 uid、加长过期）一律 401，见测试
「伪造/篡改的会话 Cookie 不被接受」。

## 2. 授权模型（Fail-closed）

授权在 `onRequest`（解析会话）之后、**`preValidation`（参数校验之前）**统一判定：

1. 非 `/api/**` 路径不鉴权（静态资源与 SPA 回退）；
2. 未匹配到路由的请求直接放行到 404 处理器，保持 `NOT_FOUND` 语义（避免把探测行为变成 401）；
3. `/api/v1/healthz|readyz|version|openapi.json|meta|auth/login|auth/register|auth/logout` 为公开白名单；
4. 其余接口**默认要求登录**（新增接口天然受保护，不需要额外声明）；
5. `ADMIN_ROUTES` / `TEACHER_ROUTES`（`apps/api/src/http/guards.ts` 中的声明式表）给出角色要求。

路由处理器内仍保留 `requireUser/requireTeacherOrAdmin` 作为纵深防御。

> 本轮修复：此前鉴权发生在 body schema 校验之后，未登录的写请求会返回 400（把校验细节暴露出去）
> 而不是 401，学生用非法 body 请求管理接口也是 400 而不是 403。现在统一为 401/403 优先。

## 3. 上传与下载

上传落盘（`StorageService`）：

- 题目配图：白名单 `image/(png|jpeg|gif|webp|bmp)`，**排除 SVG**（SVG 可执行脚本）；
- 扩展名黑名单：`.html/.htm/.xhtml/.svg/.xml/.js/.mjs/.cjs/.jsp/.php` 一律拒绝（防「改后缀」绕过）；
- 文件名经 `path.basename` 处理，存储名由服务端生成（`<subdir>_<时间戳>_<随机>`），杜绝路径穿越。

下载出流（`isInlineMime`）：

- `text/html`、`application/xhtml+xml`、`image/svg+xml`、`text/xml`、`application/xml` **强制 `Content-Disposition: attachment`**；
- 光栅图片、PDF、音视频、纯文本类可内联；
- 配合 helmet 的 `X-Content-Type-Options: nosniff`（测试断言该响应头存在）。

> 本轮修复：此前 `isInlineMime` 允许所有 `text/*` 与 `image/svg+xml` 内联，
> 用户上传的 HTML/SVG 会在同源下被执行（存储型 XSS）。现在下载处置按类型收敛，
> 历史遗留的 HTML 附件也会被强制下载（有测试覆盖）。

## 4. 传输与限流

- `@fastify/helmet`：安全响应头（含 nosniff、Referrer-Policy 等）；CSP 默认关闭，
  因为前端产物为同源托管且当前未引入外部资源，建议在反向代理层按需开启严格 CSP；
- `@fastify/rate-limit`：默认 300 次/分钟（`MC_RATE_LIMIT_MAX`/`MC_RATE_LIMIT_WINDOW` 可调），
  超限返回 429 与统一错误信封（有测试）；
- `MC_TRUST_PROXY=1` 时按 `X-Forwarded-For` 取真实客户端 IP，务必仅在反代之后开启；
- 请求体上限 `MC_MAX_UPLOAD_MB`（默认 50，Docker Compose 默认 200），multipart 限制单文件。

## 5. 其他

- 统一错误信封 `{ error: { code, message, requestId, details } }`，不外泄堆栈；
  服务端异常只返回「服务器内部错误」，堆栈进日志；
- 全链路 `x-request-id`（请求头透传或生成），便于按用户报错页面的 requestId 定位；
- 审计日志（`audit_logs`）记录账号、课程、题库、考试、媒体目录等关键写操作，管理端可查；
- 日志脱敏：cookie、authorization、set-cookie、password/pass/oldpass/newpass 一律 `[Redacted]`；
- 越权矩阵测试覆盖学生 / 教师 / 管理员三种角色对 12 类管理接口的访问。

## 6. 加固现状与剩余待办

已完成（本轮补做）：

1. **CSRF 纵深防御**：`apps/api/src/http/csrf.ts` 对所有非安全方法（POST/PUT/PATCH/DELETE）做 Origin 校验 ——
   无 Origin 的客户端（curl / 服务端调用）放行、同源（含反代场景的 `X-Forwarded-Host`/`X-Forwarded-Proto`）放行、
   `MC_ALLOWED_ORIGINS` 白名单放行，其余一律 403。解决 `SameSite=Lax` 之外的场景（如将来改 `SameSite=None` 或前后端分域）。
2. **可选严格 CSP**：`MC_CSP=1` 时下发 `default-src 'self'`（含 `object-src 'none'`、`frame-ancestors 'self'`，
   `frame-src` 放开 `https:` 以支持嵌入视频）。默认关闭，避免与反代已下发的 CSP 冲突。
3. **依赖漏洞门禁**：CI 增加 `npm audit --omit=dev --audit-level=high`（走公共 registry，国内镜像源不提供审计接口）。
   本轮据此发现并修复 **`@fastify/static` 的 4 个 high 级漏洞**（目录列举路径穿越、编码分隔符绕过路由守卫、
   非规范路径绕过鉴权、路径穿越），`8.x → 10.1.3` 后 `npm audit` 为 **0 漏洞**。

剩余待办（如实记录）：

1. **视频防盗链**：本地视频流仅校验会话，未做短时签名 URL；如需防分享可加带时效的 token。
2. **密码强度**：最低 6 位偏弱，可按部署方要求提高（策略集中在 `apps/api/src/security/password.ts`）。
3. **上传内容嗅探**：当前按 MIME + 扩展名白名单校验，未做魔数（magic bytes）嗅探；如需更强可引入图片解析库。
4. **审计日志留存**：`audit_logs` 目前无限增长，长期运行建议加按时间/条数的清理任务。
