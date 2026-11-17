function routeSegment(value: string) {
  return encodeURIComponent(value.trim().replace(/^@+/, ""));
}

export function normalizePublisherHandle(value: string | null | undefined) {
  return value?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}

export function packageNameFromPublisherTemplateRoute(owner: string, slug: string) {
  const handle = normalizePublisherHandle(owner);
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,38}[a-zA-Z0-9])?$/.test(handle)) return null;
  if (!slug || slug.includes("/") || slug === "." || slug === "..") return null;
  return `@${handle}/${slug}`;
}

export function buildTemplateDetailHref(name: string, ownerHandle?: string | null) {
  const normalized = name.trim().replace(/^@+/, "");
  const slash = normalized.indexOf("/");
  const scopedOwner = slash > 0 ? normalized.slice(0, slash) : null;
  const slug = scopedOwner ? normalized.slice(slash + 1) : normalized;
  const owner = normalizePublisherHandle(scopedOwner ?? ownerHandle);
  if (!owner || !slug || slug.includes("/")) return null;
  return `/${routeSegment(owner)}/templates/${routeSegment(slug)}`;
}

/** Templates install by `@publisher/slug`, like skills, even when stored under an unscoped name. */
export function buildTemplateInstallRef(name: string, ownerHandle?: string | null) {
  const owner = normalizePublisherHandle(ownerHandle);
  return name.startsWith("@") || !owner ? name : `@${owner}/${name}`;
}

export function isTemplateReadyToAdd(
  status: "clean" | "suspicious" | "malicious" | "pending" | "not-run" | null | undefined,
) {
  return status === "clean";
}

export function buildTemplateSecurityAuditHref(
  name: string,
  ownerHandle?: string | null,
  version?: string | null,
) {
  const detail = buildTemplateDetailHref(name, ownerHandle);
  if (!detail) return null;
  const search = version ? "?" + new URLSearchParams({ version }) : "";
  return detail + "/security-audit" + search;
}
