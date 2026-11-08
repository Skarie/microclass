/**
 * 等级文案：后端 `LEVELS` 常量自带 emoji 前缀（🌱 / 📖 / 🚀 / 🔥 / 👑）。
 * 界面只显示文字等级——emoji 不增加信息，还会让导航和看板显得像装饰贴纸。
 */
export function levelName(level: string | null | undefined): string {
  if (!level) return '—';
  return level.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim() || '—';
}
