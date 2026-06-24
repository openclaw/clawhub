const WORKER_SECRET_KEY_VALUE_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|[_-]KEY|AUTHORIZATION|CREDENTIAL)[A-Z0-9_]*|token|secret|password|api[_-]?key|authorization|credential)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi;
const WORKER_AUTHORIZATION_KEY_VALUE_PATTERN =
  /\b(authorization)(["']?\s*[:=]\s*["']?)[^\r\n"',}]+/gi;
const WORKER_COMMON_TOKEN_PATTERN =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{20,})\b/gi;

export function redactWorkerSignedUrlsAndAuthHeaders(value: string) {
  return value
    .replace(/https?:\/\/[^\s"')<>]+/g, "[redacted-url]")
    .replace(
      /\b(?:Authorization\s*:\s*)?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      "[redacted-secret]",
    );
}

export function redactWorkerPublicText(value: string) {
  return redactWorkerSignedUrlsAndAuthHeaders(value)
    .replace(
      WORKER_AUTHORIZATION_KEY_VALUE_PATTERN,
      (_match, key: string, separator: string) => `${key}${separator}[redacted-secret]`,
    )
    .replace(
      WORKER_SECRET_KEY_VALUE_PATTERN,
      (_match, key: string, separator: string) => `${key}${separator}[redacted-secret]`,
    )
    .replace(WORKER_COMMON_TOKEN_PATTERN, "[redacted-secret]")
    .replace(/\b[A-Za-z0-9_+/=-]{64,}\b/g, "[redacted-secret]");
}
