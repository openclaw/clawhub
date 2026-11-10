const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function tryNormalizePackageName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (!PACKAGE_NAME_PATTERN.test(normalized)) return null;
  return normalized;
}
