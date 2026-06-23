const DEFAULT_MAX_TEXT_CHARS = 20_000;

export function redactWorkerText(value: string, maxChars = DEFAULT_MAX_TEXT_CHARS) {
  const redacted = value
    .replace(/https?:\/\/[^\s"')<>]+/g, "[redacted-url]")
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      (_match, scheme: string) => `${scheme} [redacted-secret]`,
    )
    .replace(
      /\b(token|secret|password|api[ _-]?key|authorization)(["']?\s*[:=]\s*["']?)(?:Bearer|Basic)?\s*[^\s"',}]+/gi,
      "[redacted-secret]",
    )
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[ _-]?KEY|AUTHORIZATION))(["']?\s*[:=]\s*["']?)(?:Bearer|Basic)?\s*[^\s"',}]+/gi,
      "[redacted-secret]",
    )
    .replace(
      /\bX-(?:Amz|Goog)-(?:Signature|Credential|Security-Token|Algorithm)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      "[redacted-secret]",
    );
  if (redacted.length <= maxChars) return redacted;
  return `${redacted.slice(0, maxChars)}\n...[truncated ${redacted.length - maxChars} chars]`;
}

export function redactWorkerErrorMessage(value: string) {
  return redactWorkerText(value)
    .replace(
      /\b(?:token|secret|password|api[ _-]?key|authorization)\b(["']?\s*[:=]\s*["']?)?(?:Bearer|Basic)?\s*\[redacted-secret\]/gi,
      "[redacted-secret]",
    )
    .replace(
      /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[ _-]?KEY|AUTHORIZATION)\b(["']?\s*[:=]\s*["']?)?(?:Bearer|Basic)?\s*\[redacted-secret\]/g,
      "[redacted-secret]",
    )
    .replace(
      /\bX-(?:Amz|Goog)-(?:Signature|Credential|Security-Token|Algorithm)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      "[redacted-secret]",
    );
}

function escapeGitHubActionsCommandValue(value: string) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function maskGitHubActionsSecret(
  value: string | null | undefined,
  options?: { env?: NodeJS.ProcessEnv; write?: (line: string) => void },
) {
  if (!value) return false;
  const env = options?.env ?? process.env;
  if (env.GITHUB_ACTIONS !== "true") return false;
  const write = options?.write ?? ((line: string) => process.stdout.write(line));
  write(`::add-mask::${escapeGitHubActionsCommandValue(value)}\n`);
  return true;
}

export function maskKnownWorkerSecrets(
  env: NodeJS.ProcessEnv = process.env,
  write?: (line: string) => void,
) {
  const secretKeys = [
    "SECURITY_SCAN_WORKER_TOKEN",
    "OPENAI_API_KEY",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "CONVEX_DEPLOY_KEY",
    "HOMEBREW_GITHUB_API_TOKEN",
  ];
  for (const key of secretKeys) {
    maskGitHubActionsSecret(env[key], { env, write });
  }
}
