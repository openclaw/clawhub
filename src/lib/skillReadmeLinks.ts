import { defaultUrlTransform } from "react-markdown";

const ABSOLUTE_OR_ROOT_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i;

function splitFragment(href: string) {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return { path: href, fragment: "" };
  return {
    path: href.slice(0, hashIndex),
    fragment: href.slice(hashIndex),
  };
}

function normalizeRelativeSkillPath(rawPath: string) {
  if (!rawPath || rawPath.includes("\\") || rawPath.includes("\0")) return null;

  const pathOnly = rawPath.split("?")[0] ?? "";
  const segments: string[] = [];
  for (const segment of pathOnly.split("/")) {
    if (!segment || segment === ".") continue;

    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }

    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      return null;
    }

    segments.push(segment);
  }

  return segments.length ? segments.join("/") : null;
}

export function resolveSkillReadmeHref(href: string, skillSlug: string) {
  const safeHref = defaultUrlTransform(href);
  if (!safeHref) return "";

  const trimmed = safeHref.trim();
  if (!trimmed || ABSOLUTE_OR_ROOT_HREF.test(trimmed)) return safeHref;

  const { path, fragment } = splitFragment(trimmed);
  const normalizedPath = normalizeRelativeSkillPath(path);
  if (!normalizedPath) return "";

  return `/api/v1/skills/${encodeURIComponent(skillSlug)}/file?path=${encodeURIComponent(
    normalizedPath,
  )}${fragment}`;
}
