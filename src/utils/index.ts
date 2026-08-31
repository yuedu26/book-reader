/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 格式化时长（秒 → 可读字符串）
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}小时${rem}分钟` : `${hours}小时`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}天${remH}小时` : `${days}天`;
}

/**
 * 格式化日期 YYYY-MM-DD
 */
export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = diff / 1000;
  if (seconds < 60) return '刚刚';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}分钟前`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}小时前`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}天前`;
  return formatDate(timestamp);
}

/**
 * 防抖
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * 截断文本
 */
export function truncateText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '...';
}

/**
 * 获取今天的日期字符串
 */
export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}
