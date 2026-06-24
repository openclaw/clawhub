export function redactWorkerTransportText(value: string) {
  return value
    .replace(/https?:\/\/[^\s"')<>]+/g, "[redacted-url]")
    .replace(
      /\b(?:Authorization\s*:\s*)?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      "[redacted-secret]",
    );
}
