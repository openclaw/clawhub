export function insightTime(value: number | null) {
  return value === null
    ? "Not available yet"
    : new Date(value).toISOString().replace("T", " ").replace(/Z$/, " UTC");
}
