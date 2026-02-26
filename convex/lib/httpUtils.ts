export function parseBooleanQueryParam(value: string | null) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
}
