function routeSegment(value: string) {
  return encodeURIComponent(value.trim().replace(/^@+/, ""));
}

export function normalizePublisherHandle(value: string | null | undefined) {
  return value?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}

export function packageNameFromPublisherClawRoute(owner: string, slug: string) {
  const handle = normalizePublisherHandle(owner);
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,38}[a-zA-Z0-9])?$/.test(handle)) return null;
  if (!slug || slug.includes("/") || slug === "." || slug === "..") return null;
  return `@${handle}/${slug}`;
}

export function buildClawDetailHref(name: string, ownerHandle?: string | null) {
  const normalized = name.trim().replace(/^@+/, "");
  const slash = normalized.indexOf("/");
  const scopedOwner = slash > 0 ? normalized.slice(0, slash) : null;
  const slug = scopedOwner ? normalized.slice(slash + 1) : normalized;
  const owner = normalizePublisherHandle(scopedOwner ?? ownerHandle);
  if (!owner || !slug || slug.includes("/")) return null;
  return `/${routeSegment(owner)}/claws/${routeSegment(slug)}`;
}

export function clawSecurityStatusMessage(
  status: "clean" | "suspicious" | "malicious" | "pending" | "not-run" | null | undefined,
) {
  switch (status) {
    case "clean":
      return "Security checks passed";
    case "suspicious":
      return "Security scan flagged this Claw. Wait for review before adding it.";
    case "malicious":
      return "ClawHub marked this Claw as malicious. Do not add it.";
    case "not-run":
      return "Security review has not started. This Claw is not ready to add yet.";
    default:
      return "Security review pending. This Claw is not ready to add yet.";
  }
}

export function isClawReadyToAdd(
  status: "clean" | "suspicious" | "malicious" | "pending" | "not-run" | null | undefined,
) {
  return status === "clean";
}
