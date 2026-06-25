const WORKER_SECRET_VALUE_PATTERN_SOURCE = String.raw`(?:\[\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\]\s"',}]+)(?:\s*,\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\]\s"',}]+))*\s*\]|"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',}]+)`;
const WORKER_SECRET_KEY_VALUE_PATTERN = new RegExp(
  String.raw`\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|[_-]KEY|AUTHORIZATION|CREDENTIAL)[A-Z0-9_]*|token|secret|password|api[_-]?key|authorization|credential)(["']?\s*[:=]\s*)${WORKER_SECRET_VALUE_PATTERN_SOURCE}`,
  "gi",
);

export function redactWorkerSignedUrlsAndAuthHeaders(value: string) {
  return value
    .replace(/https?:\/\/[^\s"')<>]+/g, "[redacted-url]")
    .replace(
      /\bAuthorization\s*:\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi,
      "[redacted-secret]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted-secret]");
}

export function redactWorkerPublicText(value: string) {
  return redactWorkerSignedUrlsAndAuthHeaders(value).replace(
    WORKER_SECRET_KEY_VALUE_PATTERN,
    (_match, key: string, separator: string) => `${key}${separator}[redacted-secret]`,
  );
}
