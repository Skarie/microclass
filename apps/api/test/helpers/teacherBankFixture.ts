/**
 * 「教师版题库」导入测试的共用夹具：内存库（已跑迁移）+ 课程 + 一份两小节的资料目录。
 *
 * 目录结构与真实采集一致：
 *   数学/<册次>/第一章 有理数/<小节>/题目.md + images/axis.png
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import { QuestionMediaStore } from '../../src/services/questionMediaStore.js';

export const COURSE = '初中数学·七年级上册（新）';
export const BOOK = '七年级上册（新）';
export const CHAPTER = '第一章 有理数';
export const SECTION_A = '数轴的应用-点的移动';
export const SECTION_B = '相反数';

/** 最小合法 PNG 头（题图仓库按文件头识别类型） */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

export const SECTION_A_MD = `# ${SECTION_A}

> 学科：数学　版本：人教版 (初中)　书册：${BOOK}　章节：${CHAPTER}
> 知识点ID：11487　题目总数：2
> 题型分布：单选题 1，填空题 1

---

### 第1题（单选题）

**题目标识：** 511916
**难度值：** 0.64

**题目：**

点$A$在数轴上向右移动$3$个单位，表示的数是 ____.

![题目图片](images/axis.png)

**选项：**

A. $-2$
B. $1$
C. $2$
D. $5$

**答案：** B

**解析：**

向右移动用加法.

**AI解析：**

先定方向再算坐标.

**解题思路：**

数形结合.

**相关知识点：**

数轴的三要素.

### 第2题（填空题）

**题目标识：** 511917
**难度值：** 0.2

**题目：**

把结果填在图上 ![题目图片](images/missing.png)

**答案：** 7；-7

**解析：**

相反数.
`;

export const SECTION_B_MD = `# ${SECTION_B}

> 学科：数学　书册：${BOOK}　章节：${CHAPTER}
> 知识点ID：11490　题目总数：2

### 第1题（判断题）

**题目标识：** 511920

**题目：**

$-3$ 的相反数是 $3$.

**答案：** 错误

**解析：**

符号相反.

### 第2题（材料题）

**题目标识：** 511921

**题目：**

阅读材料后作答：略.

**答案：** 略.
`;

export interface TeacherBankFixture {
  db: Db;
  media: QuestionMediaStore;
  dataDir: string;
  sourceRoot: string;
  cleanup: () => void;
}

function writeSource(root: string, relPath: string, content: string | Buffer): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** 新建一套夹具（每个测试文件各自独立，避免相互污染） */
export function createTeacherBankFixture(): TeacherBankFixture {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-teacher-bank-'));
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-teacher-src-'));
  const db = new Db(':memory:');
  runMigrations(db, path.resolve(process.cwd(), 'db', 'migrations'));
  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', [COURSE]);
  const prefix = `数学/${BOOK}/${CHAPTER}`;
  writeSource(sourceRoot, `${prefix}/${SECTION_A}/题目.md`, SECTION_A_MD);
  writeSource(sourceRoot, `${prefix}/${SECTION_B}/题目.md`, SECTION_B_MD);
  writeSource(sourceRoot, `${prefix}/${SECTION_A}/images/axis.png`, PNG);
  return {
    db,
    media: new QuestionMediaStore(dataDir),
    dataDir,
    sourceRoot,
    cleanup: () => {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    },
  };
}
