import { caseFold } from "unicode-case-folding";

const WINDOWS_INVALID_PATH_CHARS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNICODE_CONTROL_CHARACTER = /\p{Cc}/u;

export function hasPortablePathSegments(normalized: string): boolean {
  return normalized
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !WINDOWS_INVALID_PATH_CHARS.test(segment) &&
        !UNICODE_CONTROL_CHARACTER.test(segment) &&
        !segment.endsWith(".") &&
        !segment.endsWith(" ") &&
        !WINDOWS_RESERVED_PATH_SEGMENT.test(segment),
    );
}

export function portablePathKey(value: string): string {
  return caseFold(value.replaceAll("\\", "/").normalize("NFC"));
}

export function isSafeTemplatePackagePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized !== value ||
    normalized !== normalized.trim() ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return false;
  }
  return hasPortablePathSegments(normalized);
}

export function findTemplatePackagePathHierarchyCollision(
  paths: readonly string[],
): { ancestor: string; descendant: string } | null {
  const pathByKey = new Map(paths.map((path) => [portablePathKey(path), path]));
  for (const descendant of paths) {
    const segments = portablePathKey(descendant).split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = pathByKey.get(segments.slice(0, length).join("/"));
      if (ancestor !== undefined) {
        return { ancestor, descendant };
      }
    }
  }
  return null;
}
