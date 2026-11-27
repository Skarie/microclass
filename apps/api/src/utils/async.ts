/**
 * 批量任务让出事件循环。
 *
 * 难度重算/校准这类「读一页 → 内存算一页」的任务在大库（39.6 万题）上会连续跑几秒，
 * 期间同步 SQLite 与纯计算都在同一线程上，接口会整体卡住。块与块之间 `await` 一次，
 * 让 IO 轮询和已排队的请求先跑。
 *
 * 用 `setImmediate` 而不是 `setTimeout(0)`：前者在 IO 阶段之后立刻执行，
 * 不额外吃 1ms 定时器粒度，块数多（几千块）时差别明显。
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
