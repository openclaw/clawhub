export function parseBooleanQueryParam(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function parseBooleanQueryParamOptional(value: string | null) {
  if (value == null) return undefined;
  return parseBooleanQueryParam(value);
}

export function resolveBooleanQueryParam(primaryValue: string | null, legacyValue: string | null) {
  return (
    parseBooleanQueryParamOptional(primaryValue) ?? parseBooleanQueryParamOptional(legacyValue)
  );
}
