export function hasOwnProperty<K extends PropertyKey>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}
