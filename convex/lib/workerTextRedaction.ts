const WORKER_SECRET_QUOTED_VALUE_PATTERN_SOURCE = String.raw`(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')`;
const WORKER_SECRET_VALUE_PATTERN_SOURCE = String.raw`(?:\[\s*(?:${WORKER_SECRET_QUOTED_VALUE_PATTERN_SOURCE}|[^\]\s"',}]+)(?:\s*,\s*(?:${WORKER_SECRET_QUOTED_VALUE_PATTERN_SOURCE}|[^\]\s"',}]+))*\s*\]|${WORKER_SECRET_QUOTED_VALUE_PATTERN_SOURCE}|[^\s"',}]+)`;
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

export function redactWorkerPublicText(value: string): string {
  // HTTP errors can embed JSON strings with another layer of quoting. Decode those
  // before matching raw secrets; preserve unchanged literals and adjacent diagnostics.
  const redactedJson = value.replace(
    // eslint-disable-next-line no-control-regex -- JSON strings forbid unescaped U+0000 through U+001F.
    /"(?:\\["\\/bfnrt]|\\u[\da-fA-F]{4}|[^"\\\u0000-\u001F])*"/g,
    (literal) => {
      const decoded = JSON.parse(literal) as string;
      const redacted = redactWorkerPublicText(decoded);
      return redacted === decoded ? literal : JSON.stringify(redacted);
    },
  );
  return redactWorkerSignedUrlsAndAuthHeaders(redactedJson).replace(
    WORKER_SECRET_KEY_VALUE_PATTERN,
    (_match, key: string, separator: string) => `${key}${separator}[redacted-secret]`,
  );
}
