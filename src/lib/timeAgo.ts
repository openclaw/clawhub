const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m}m ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h}h ago`;
  }
  if (diff < WEEK) {
    const d = Math.floor(diff / DAY);
    return `${d}d ago`;
  }
  if (diff < MONTH) {
    const w = Math.floor(diff / WEEK);
    return `${w}w ago`;
  }
  if (diff < YEAR) {
    const m = Math.floor(diff / MONTH);
    return `${m}mo ago`;
  }
  const y = Math.floor(diff / YEAR);
  return `${y}y ago`;
}
