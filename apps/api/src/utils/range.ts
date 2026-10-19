/**
 * HTTP Range 支持：视频等大文件按需分片返回（断点续播/拖动进度条）。
 *
 * 两个容易踩的坑（已在真实部署中遇到并修复）：
 * 1. 文件存在但运行用户没有读权限时，`createReadStream` 会在异步阶段报 EACCES；
 *    若不在发送前拦截，Fastify 会在已开始响应后再尝试发送错误对象，
 *    报出 `FST_ERR_REP_INVALID_PAYLOAD_TYPE`（500 且信息毫无可操作性）。
 * 2. 流本身出错（磁盘 IO 错误、文件被删除）同样需要兜住，否则进程级未处理错误。
 */
import fs from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { mimeFor } from './mime.js';

/** 用流发送文件，并保证错误不会逃逸成「无效载荷类型」的 500 */
function sendStream(
  req: FastifyRequest,
  reply: FastifyReply,
  absPath: string,
  options?: { start: number; end: number },
): FastifyReply {
  const stream = options ? fs.createReadStream(absPath, options) : fs.createReadStream(absPath);
  stream.on('error', (err) => {
    req.log.error({ err, file: absPath }, '读取文件失败');
    if (reply.raw.headersSent) {
      reply.raw.destroy();
      return;
    }
    void reply.status(500).send({
      error: { code: 'INTERNAL', message: '文件读取失败，请稍后重试', requestId: req.requestId },
    });
  });
  return reply.send(stream);
}

export function sendFileWithRange(
  req: FastifyRequest,
  reply: FastifyReply,
  absPath: string,
  opts?: { cacheControl?: string },
): FastifyReply {
  const cacheControl = opts?.cacheControl ?? 'no-store';
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '文件不存在', requestId: req.requestId } });
  }
  if (!stat.isFile()) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '不是文件', requestId: req.requestId } });
  }

  // 发送前确认可读：给出「权限」而不是含糊的 500，便于部署时定位
  try {
    fs.accessSync(absPath, fs.constants.R_OK);
  } catch {
    req.log.error({ file: absPath }, '文件不可读（权限不足）');
    return reply.status(403).send({
      error: {
        code: 'FORBIDDEN',
        message: '文件不可读：请确认应用运行用户对媒体目录有读权限',
        requestId: req.requestId,
      },
    });
  }

  const total = stat.size;
  const type = mimeFor(absPath);
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const rawStart = m?.[1] ?? '';
    const rawEnd = m?.[2] ?? '';
    const hasStart = rawStart !== '';
    const hasEnd = rawEnd !== '';

    let start: number;
    let end: number;
    if (!hasStart && hasEnd) {
      // 后缀区间 `bytes=-N`：取最后 N 字节（播放器拖到结尾时常用）
      const suffix = Number.parseInt(rawEnd, 10);
      start = Number.isNaN(suffix) ? 0 : Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = hasStart ? Number.parseInt(rawStart, 10) : 0;
      end = hasEnd ? Number.parseInt(rawEnd, 10) : total - 1;
    }
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end) {
      return reply.status(416).header('content-range', `bytes */${total}`).send();
    }
    reply
      .status(206)
      .header('content-type', type)
      .header('content-length', String(end - start + 1))
      .header('content-range', `bytes ${start}-${end}/${total}`)
      .header('accept-ranges', 'bytes')
      .header('cache-control', cacheControl);
    return sendStream(req, reply, absPath, { start, end });
  }

  reply
    .header('content-type', type)
    .header('content-length', String(total))
    .header('accept-ranges', 'bytes')
    .header('cache-control', cacheControl);
  return sendStream(req, reply, absPath);
}
