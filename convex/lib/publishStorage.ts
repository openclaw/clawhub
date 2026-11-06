export function stripUndefinedForStoredPublish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedForStoredPublish);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) result[key] = stripUndefinedForStoredPublish(nested);
  }
  return result;
}
