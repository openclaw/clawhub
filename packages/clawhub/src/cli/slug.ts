import { fail } from "./ui.js";
export function sanitizeSlug(value: string) {
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  const cleaned = raw.replace(/^-+/, "").replace(/-+$/, "").replace(/--+/g, "-");
  return cleaned;
}

export function titleCase(value: string) {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const ARCHIVE_EXTENSION_PATTERN = /\.(?:tgz|tar\.gz)$/i;
/** Title-cases an archive basename without its extension or known artifact version. */
export function displayNameFromArchive(value: string, artifactVersion: string) {
  const stem = value.trim().replace(ARCHIVE_EXTENSION_PATTERN, "");
  // Guessing semver here can consume version-looking text in the package name.
  const suffix = ["-", "_", "@"]
    .flatMap((separator) => [`${separator}${artifactVersion}`, `${separator}v${artifactVersion}`])
    .find((candidate) => stem.endsWith(candidate));
  return titleCase((suffix ? stem.slice(0, -suffix.length) : stem) || stem);
}

export function parseSkillRef(skillArg: string) {
  const value = skillArg.trim().toLowerCase();
  if (!value) fail("Skill required");
  const slashIndex = value.indexOf("/");
  if (slashIndex < 0) return { slug: value, ownerHandle: undefined };
  if (value.indexOf("/", slashIndex + 1) >= 0) fail(`Invalid skill ref: ${skillArg}`);
  const ownerHandle = value.slice(0, slashIndex).replace(/^@+/, "");
  const slug = value.slice(slashIndex + 1);
  if (!ownerHandle || !slug) fail(`Invalid skill ref: ${skillArg}`);
  return { slug, ownerHandle };
}

export function normalizeOwnerHandle(raw: string | null | undefined) {
  const handle = raw?.trim().replace(/^@+/, "").toLowerCase();
  if (!handle) return undefined;
  if (handle.includes("/") || handle.includes("\\") || handle.includes("..")) {
    fail(`Invalid owner handle: ${raw}`);
  }
  return handle;
}
