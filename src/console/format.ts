export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  const days = Math.floor(value / 86_400);
  const hours = Math.floor(value % 86_400 / 3_600);
  const minutes = Math.floor(value % 3_600 / 60);
  if (days) return `${days}天${hours ? `${hours}小时` : ""}`;
  if (hours) return `${hours}小时${minutes ? `${minutes}分钟` : ""}`;
  if (minutes) return `${minutes}分钟`;
  return value ? `${value}秒` : "0分钟";
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 })
    .format(Math.max(0, Math.round(value)));
}
