import { normalizeBundlePathForComparison } from "./bundlePaths";

const SECRET_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:api[_-]?key|token|secret|password|passwd|pwd|authorization code|auth code)\s*[:=]\s*["']?[^"',\s;)`]{6,}/gi,
  /\b(?:authorization|x-api-key)\s*[:=]\s*["']?(?:bearer|basic)?\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/g,
  /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@[^\s)'"`]+/gi,
  /(["'`])(?=[A-Za-z0-9+/=_-]{32,}\1)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9+/=_-]+\1/g,
];

export function redactSecretValues(value: string) {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

export function redactBundleContent(value: string) {
  let redacted = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    redacted += code < 32 && code !== 9 && code !== 10 && code !== 13 ? " " : value.charAt(index);
  }
  return redactSecretValues(redacted);
}

export function hasSecretLikeValue(value: string) {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function isExcludedSkillBundlePath(path: string) {
  return (
    isPrimarySkillReadmePath(path) || normalizeBundlePathForComparison(path) === "skill-card.md"
  );
}

export function isPrimarySkillReadmePath(path: string) {
  const normalized = normalizeBundlePathForComparison(path);
  return normalized === "skill.md" || normalized === "skills.md";
}

export function totalBundleBytes(files: Array<{ content: string }>) {
  return files.reduce((sum, file) => sum + utf8Bytes(file.content), 0);
}

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
