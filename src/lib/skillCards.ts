export function skillCardLoadKey(
  versionId: string | null | undefined,
  file: { path: string; sha256?: string | null } | null | undefined,
) {
  if (!versionId || !file) return null;
  return `${versionId}:${file.path.trim().toLowerCase()}:${file.sha256 ?? ""}`;
}
