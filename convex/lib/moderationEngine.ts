import type { Doc, Id } from "../_generated/dataModel";
import {
  isExternallyClearableSuspiciousCode,
  legacyFlagsFromVerdict,
  MODERATION_ENGINE_VERSION,
  normalizeReasonCodes,
  type ModerationFinding,
  REASON_CODES,
  type ScannerModerationVerdict,
  summarizeReasonCodes,
  type ModerationVerdict,
  verdictFromCodes,
} from "./moderationReasonCodes";

type TextFile = { path: string; content: string };
type VirusTotalEngineStats = {
  malicious?: number;
  suspicious?: number;
  undetected?: number;
  harmless?: number;
};

type VirusTotalAnalysis = {
  status?: string;
  scanner?: string;
  source?: string;
  engineStats?: VirusTotalEngineStats;
  metadata?: {
    stats?: VirusTotalEngineStats;
  };
};

export type StaticScanInput = {
  slug: string;
  displayName: string;
  summary?: string;
  frontmatter: Record<string, unknown>;
  metadata?: unknown;
  files: Array<{ path: string; size: number }>;
  fileContents: TextFile[];
};

export type StaticScanResult = {
  status: ScannerModerationVerdict;
  reasonCodes: string[];
  findings: ModerationFinding[];
  summary: string;
  engineVersion: string;
  checkedAt: number;
};

export type ModerationSnapshot = {
  verdict: ScannerModerationVerdict;
  reasonCodes: string[];
  evidence: ModerationFinding[];
  summary: string;
  engineVersion: string;
  evaluatedAt: number;
  sourceVersionId?: Id<"skillVersions">;
  legacyFlags?: string[];
};

const MANIFEST_EXTENSION = /\.(json|yaml|yml|toml)$/i;
const MARKDOWN_EXTENSION = /\.(md|markdown|mdx)$/i;
const CODE_EXTENSION = /\.(js|ts|mjs|cjs|mts|cts|jsx|tsx|py|sh|bash|zsh|rb|go)$/i;
const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000]);
const RAW_IP_URL_PATTERN = /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/|["'])/i;
const INSTALL_PACKAGE_PATTERN = /installer-package\s*:\s*https?:\/\/[^\s"'`]+/i;
const GENERATED_SOURCE_PLACEHOLDER_PATTERN =
  /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=.*["']\$\{[A-Za-z_][A-Za-z0-9_-]*\}["']/m;
const GENERATED_SOURCE_CONTEXT_PATTERN =
  /```(?:python|py|javascript|js|typescript|ts|shell|bash|sh)\b|cat\s*(?:>|>>)?\s*[^`\n]*\.(?:py|js|ts|sh)\b|python3?\b|node\b/i;
const HARDCODED_CONNECTION_ID_PATTERN =
  /["']connection_id["']\s*:\s*["'][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}["']/i;
const GOOGLE_SHEETS_SPREADSHEET_URL_PATTERN =
  /https?:\/\/[^\s"'`]*\/spreadsheets\/([A-Za-z0-9_-]{20,})\/[^\s"'`]*/i;
const DESTRUCTIVE_DELETE_PATTERN =
  /\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\s+(["']?)(\/root\/\.openclaw\/|\/home\/[^/\s"'`]+\/\.openclaw\/|\/Users\/[^/\s"'`]+\/\.openclaw\/|~\/\.openclaw\/|\$HOME\/\.openclaw\/|\$\{HOME\}\/\.openclaw\/|\/etc\/|\/usr\/|\/opt\/|\/Library\/|\/Applications\/)[^\s"'`;|&)]*\1/i;
const SHELL_POSITIONAL_ASSIGNMENT_PATTERN =
  /^\s*([A-Z_][A-Z0-9_]*)=(["']?)\$(?:[1-9][0-9]*|@|\*)\2\s*(?:#.*)?$/gm;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:[A-Za-z0-9]+[_\s-]+)*(?:(?:api|client|consumer)[_\s-]?(?:secret|key)|secret[_\s-]?key|access[_\s-]?(?:token|key|secret|grant)|auth[_\s-]?token|bearer[_\s-]?token|private[_\s-]?key|service[_\s-]?role[_\s-]?key|github[_\s-]?(?:pat|token)|password)\b\s*[:=]\s*["'`]?([A-Za-z0-9][A-Za-z0-9._~+/=-]{15,})["'`]?/i;
const AUTH_HEADER_SECRET_PATTERN =
  /\b(?:authorization|x-api-key|x-api-secret)\b\s*[:=]\s*(?:Bearer\s+)?["'`]?([A-Za-z0-9][A-Za-z0-9._~+/=-]{15,})["'`]?/i;
const SHELL_CREDENTIAL_VARIABLE_PATTERN =
  /\$(?:\{)?[A-Z_][A-Z0-9_]*(?:TOKEN|PAT|SECRET|KEY)[A-Z0-9_]*(?:\})?/;
const GIT_REMOTE_CREDENTIAL_URL_PATTERN =
  /\bgit\s+remote\s+set-url\b[^\n]*https?:\/\/[^\s"'`]*\$(?:\{)?[A-Z_][A-Z0-9_]*(?:TOKEN|PAT|SECRET|KEY)[A-Z0-9_]*(?:\})?[^\s"'`]*@/i;
const MEMORY_CREDENTIAL_STORAGE_PATTERN =
  /\bsave\s+(?:it|the\s+(?:token|secret|credential|key|pat))\s+to\s+(?:your\s+)?(?:memory|conversation|chat)\b/i;
const HOST_PLATFORM_SOURCE_CONTEXT_PATTERN =
  /\$[{]?OPENCLAW_DIR[}]?.{0,200}\/src\/|\/src\/agents\/|\/src\/tools\//is;
const HOST_PLATFORM_PATCH_COMMAND_PATTERN =
  /\b(?:sed\s+-i|perl\s+-0?pi|cp\s+|cat\s+>|python3?\b.{0,120}(?:write|replace))/i;
const HOST_PLATFORM_REBUILD_PATTERN = /\b(?:pnpm\s+build|npm\s+run\s+build|bun\s+run\s+build)\b/i;

function hasMaliciousInstallPrompt(content: string) {
  const hasTerminalInstruction =
    /(?:copy|paste).{0,80}(?:command|snippet).{0,120}(?:terminal|shell)/is.test(content) ||
    /run\s+it\s+in\s+terminal/i.test(content) ||
    /open\s+terminal/i.test(content) ||
    /for\s+macos\s*:/i.test(content);
  if (!hasTerminalInstruction) return false;

  const hasCurlPipe = /(?:curl|wget)\b[^\n|]{0,240}\|\s*(?:\/bin\/)?(?:ba)?sh\b/i.test(content);
  const hasBase64Exec =
    /(?:echo|printf)\s+["'][A-Za-z0-9+/=\s]{40,}["']\s*\|\s*base64\s+-?[dD]\b[^\n|]{0,120}\|\s*(?:\/bin\/)?(?:ba)?sh\b/i.test(
      content,
    );
  const hasRawIpUrl = RAW_IP_URL_PATTERN.test(content);
  const hasInstallerPackage = INSTALL_PACKAGE_PATTERN.test(content);

  return hasBase64Exec || (hasCurlPipe && (hasRawIpUrl || hasInstallerPackage));
}

function truncateEvidence(evidence: string, maxLen = 160) {
  if (evidence.length <= maxLen) return evidence;
  return `${evidence.slice(0, maxLen)}...`;
}

function looksLikePlaceholderIdentifier(identifier: string) {
  return /^[A-Z0-9_]+$/.test(identifier) || /(your|example|placeholder)/i.test(identifier);
}

function looksLikePlaceholderSecret(secret: string) {
  const normalized = secret.trim().toLowerCase();
  if (!normalized) return true;
  if (/^(?:x+|_+|-+|\*+|\.{3})$/.test(normalized)) return true;
  if (/process\.env\.|os\.environ[.[]|getenv\s*\(/.test(normalized)) return true;
  return /(your|example|placeholder|change-?me|replace|redacted|dummy|sample|test-token|token-here|secret-here|api-key-here)/i.test(
    normalized,
  );
}

function findHardcodedSecret(content: string) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(SECRET_ASSIGNMENT_PATTERN) ?? line.match(AUTH_HEADER_SECRET_PATTERN);
    const secret = match?.[1];
    if (!secret || looksLikePlaceholderSecret(secret)) continue;
    return {
      line: i + 1,
      text: line.replaceAll(secret, "[REDACTED]"),
    };
  }
  return null;
}

function findCredentialExposureInstruction(content: string) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (
      GIT_REMOTE_CREDENTIAL_URL_PATTERN.test(line) ||
      (MEMORY_CREDENTIAL_STORAGE_PATTERN.test(line) &&
        SHELL_CREDENTIAL_VARIABLE_PATTERN.test(content))
    ) {
      return { line: i + 1, text: line };
    }
  }
  return null;
}

function findHostPlatformSourcePatch(content: string) {
  if (!HOST_PLATFORM_SOURCE_CONTEXT_PATTERN.test(content)) return null;
  if (!HOST_PLATFORM_REBUILD_PATTERN.test(content)) return null;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!HOST_PLATFORM_PATCH_COMMAND_PATTERN.test(line)) continue;
    if (hasNearbyConfirmationGate(lines, i)) continue;
    return { line: i + 1, text: line };
  }
  return null;
}

function scanSecretLiteralFile(path: string, content: string, findings: ModerationFinding[]) {
  const secretMatch = findHardcodedSecret(content);
  if (!secretMatch) return;

  addFinding(findings, {
    code: REASON_CODES.EXPOSED_SECRET_LITERAL,
    severity: "critical",
    file: path,
    line: secretMatch.line,
    message: "File appears to expose a hardcoded API secret or token.",
    evidence: secretMatch.text,
  });
}

function hasNearbyConfirmationGate(lines: string[], commandIndex: number) {
  const start = Math.max(0, commandIndex - 8);
  const context = lines.slice(start, commandIndex + 1).join("\n");
  return [
    /\bask\s+(?:the\s+)?user\b.{0,120}\b(?:confirm|confirmation|approve|approval|continue|yes)\b/is,
    /\b(?:prompt\s+for|require|request|obtain)\s+(?:explicit\s+)?(?:user\s+)?(?:confirmation|approval)\b/is,
    /\buser\s+(?:confirmation|approval)\b/is,
    /\bcontinue\?\s*\(?(?:yes\/no|y\/n)\)?/is,
    /\breply\s+["']?yes["']?\b/is,
    /\bonly\s+(?:continue\s+)?after\s+(?:the\s+)?user\b.{0,80}\b(?:confirms?|approves?|answers?\s+yes)\b/is,
  ].some((pattern) => pattern.test(context));
}

function findUnguardedDestructiveDelete(content: string) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!DESTRUCTIVE_DELETE_PATTERN.test(lines[i])) continue;
    if (hasNearbyConfirmationGate(lines, i)) continue;
    return { line: i + 1, text: lines[i] };
  }
  return null;
}

function hasShellVariableValidation(content: string, variable: string, useIndex: number) {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const beforeUse = content.slice(0, useIndex);
  const variableReference = String.raw`(?:\$\{${escaped}\}|\$${escaped})`;
  const lengthCheck = new RegExp(
    String.raw`\$\{#${escaped}\}\s*(?:-[a-z]\s+)?(?:[<>!=]=?|-[gl][te])`,
    "m",
  );
  const controlCharStrip = new RegExp(
    String.raw`(?:tr\s+-d\s+["']?\\(?:000|x00).{0,80}\\(?:037|x1[fF]|177|x7[fF])|${escaped}\s*=.*tr\s+-d)`,
    "s",
  );
  const explicitValidation = new RegExp(
    String.raw`(?:validate|sanitize|strip|clean)[A-Za-z0-9_ -]{0,60}${variableReference}|${variableReference}.{0,60}(?:validate|sanitize|strip|clean)`,
    "is",
  );

  return (
    lengthCheck.test(beforeUse) ||
    controlCharStrip.test(beforeUse) ||
    explicitValidation.test(beforeUse)
  );
}

function findUnsafeBrowserTextInput(content: string) {
  for (const assignment of content.matchAll(SHELL_POSITIONAL_ASSIGNMENT_PATTERN)) {
    const variable = assignment[1];
    if (!variable) continue;

    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const browserTextPattern = new RegExp(
      String.raw`\bbrowser\s+action=act\b[^\n]*\bkind=["']?type["']?[^\n]*\btext=(?:"\$${escaped}"|'\$${escaped}'|\$${escaped})(?![A-Za-z0-9_])`,
      "i",
    );
    const match = content.match(browserTextPattern);
    if (!match || match.index === undefined) continue;
    if (hasShellVariableValidation(content, variable, match.index)) continue;

    return findLineAtIndex(content, match.index);
  }
  return null;
}

function addFinding(
  findings: ModerationFinding[],
  finding: Omit<ModerationFinding, "evidence"> & { evidence: string },
) {
  findings.push({ ...finding, evidence: truncateEvidence(finding.evidence.trim()) });
}

function findFirstLine(content: string, pattern: RegExp) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) {
      return { line: i + 1, text: lines[i] };
    }
  }
  return { line: 1, text: lines[0] ?? "" };
}

function findLineAtIndex(content: string, index: number) {
  const line = content.slice(0, index).split("\n").length;
  const lineStart = content.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nextNewline = content.indexOf("\n", index);
  const lineEnd = nextNewline === -1 ? content.length : nextNewline;
  return { line, text: content.slice(lineStart, lineEnd) };
}

function findCallEnd(content: string, openParenIndex: number) {
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let i = openParenIndex; i < content.length; i += 1) {
    const char = content[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return content.length;
}

function isSafeLiteralExecFileCall(callText: string) {
  const match = callText.match(/\b(execFile|execFileSync)\s*\(\s*(["'])([^"']+)\2\s*,\s*\[/);
  if (!match) return false;
  if (/\bshell\s*:\s*true\b/.test(callText)) return false;

  const executable = match[3]?.trim().toLowerCase();
  if (!executable) return false;
  const basename = executable.split(/[\\/]/).at(-1) ?? executable;
  return !/^(?:sh|bash|zsh|fish|cmd|powershell|pwsh)$/.test(basename);
}

function findDangerousChildProcessCall(content: string) {
  if (!/child_process/.test(content)) return null;

  const execPattern = /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/g;
  for (const match of content.matchAll(execPattern)) {
    const callName = match[1];
    const callIndex = match.index;
    if (callIndex === undefined || !callName) continue;

    if (callName === "execFile" || callName === "execFileSync") {
      const openParenIndex = content.indexOf("(", callIndex);
      const callEnd = findCallEnd(content, openParenIndex);
      const callText = content.slice(callIndex, callEnd);
      if (isSafeLiteralExecFileCall(callText)) continue;
    }

    return findLineAtIndex(content, callIndex);
  }

  return null;
}

function normalizeEnvName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function addDeclaredEnvName(names: Set<string>, value: unknown) {
  const normalized = normalizeEnvName(value);
  if (normalized) names.add(normalized);
}

function addDeclaredEnvNamesFromList(names: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry === "string") {
      addDeclaredEnvName(names, entry);
      continue;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      addDeclaredEnvName(names, (entry as { name?: unknown }).name);
    }
  }
}

function collectDeclaredEnvNames(input: {
  frontmatter: Record<string, unknown>;
  metadata?: unknown;
}) {
  const names = new Set<string>();
  const sources: unknown[] = [input.frontmatter, input.metadata];

  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const record = source as Record<string, unknown>;
    const requires =
      record.requires && typeof record.requires === "object" && !Array.isArray(record.requires)
        ? (record.requires as Record<string, unknown>)
        : undefined;

    addDeclaredEnvName(names, record.primaryEnv);
    addDeclaredEnvNamesFromList(names, record.envVars);
    addDeclaredEnvNamesFromList(names, record.env);
    addDeclaredEnvNamesFromList(names, requires?.env);
  }

  return names;
}

function collectReferencedEnvNames(content: string) {
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      addDeclaredEnvName(names, match[1]);
    }
  }

  return names;
}

function hasBroadEnvAccess(content: string) {
  return (
    /Object\.(?:keys|values|entries)\s*\(\s*process\.env\s*\)/.test(content) ||
    /process\.env(?!\s*(?:\.|\[))/.test(content) ||
    /process\.env\[\s*[^"'`\]]/.test(content)
  );
}

function scanCodeFile(
  path: string,
  content: string,
  findings: ModerationFinding[],
  declaredEnvNames: Set<string>,
) {
  if (!CODE_EXTENSION.test(path)) return;

  const dangerousChildProcessCall = findDangerousChildProcessCall(content);
  if (dangerousChildProcessCall) {
    addFinding(findings, {
      code: REASON_CODES.DANGEROUS_EXEC,
      severity: "critical",
      file: path,
      line: dangerousChildProcessCall.line,
      message: "Shell command execution detected (child_process).",
      evidence: dangerousChildProcessCall.text,
    });
  }

  if (/\beval\s*\(|new\s+Function\s*\(/.test(content)) {
    const match = findFirstLine(content, /\beval\s*\(|new\s+Function\s*\(/);
    addFinding(findings, {
      code: REASON_CODES.DYNAMIC_CODE,
      severity: "critical",
      file: path,
      line: match.line,
      message: "Dynamic code execution detected.",
      evidence: match.text,
    });
  }

  const unsafeBrowserTextInput = findUnsafeBrowserTextInput(content);
  if (unsafeBrowserTextInput) {
    addFinding(findings, {
      code: REASON_CODES.UNSAFE_BROWSER_TEXT_INPUT,
      severity: "warn",
      file: path,
      line: unsafeBrowserTextInput.line,
      message: "Shell positional input is typed into browser automation without validation.",
      evidence: unsafeBrowserTextInput.text,
    });
  }

  const hostPlatformSourcePatch = findHostPlatformSourcePatch(content);
  if (hostPlatformSourcePatch) {
    addFinding(findings, {
      code: REASON_CODES.HOST_PLATFORM_SOURCE_PATCH,
      severity: "critical",
      file: path,
      line: hostPlatformSourcePatch.line,
      message: "Install code patches host platform source and rebuilds without confirmation.",
      evidence: hostPlatformSourcePatch.text,
    });
  }

  if (/stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i.test(content)) {
    const match = findFirstLine(content, /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i);
    addFinding(findings, {
      code: REASON_CODES.CRYPTO_MINING,
      severity: "critical",
      file: path,
      line: match.line,
      message: "Possible crypto mining behavior detected.",
      evidence: match.text,
    });
  }

  const wsMatch = content.match(/new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/);
  if (wsMatch) {
    const port = Number.parseInt(wsMatch[1] ?? "", 10);
    if (Number.isFinite(port) && !STANDARD_PORTS.has(port)) {
      const match = findFirstLine(content, /new\s+WebSocket\s*\(/);
      addFinding(findings, {
        code: REASON_CODES.SUSPICIOUS_NETWORK,
        severity: "warn",
        file: path,
        line: match.line,
        message: "WebSocket connection to non-standard port detected.",
        evidence: match.text,
      });
    }
  }

  const hasFileRead = /readFileSync|readFile/.test(content);
  const hasNetworkSend = /\bfetch\b|http\.request|\baxios\b/.test(content);
  if (hasFileRead && hasNetworkSend) {
    const match = findFirstLine(content, /readFileSync|readFile/);
    addFinding(findings, {
      code: REASON_CODES.EXFILTRATION,
      severity: "warn",
      file: path,
      line: match.line,
      message: "File read combined with network send (possible exfiltration).",
      evidence: match.text,
    });
  }

  const hasProcessEnv = /process\.env/.test(content);
  if (hasProcessEnv && hasNetworkSend) {
    const referencedEnvNames = collectReferencedEnvNames(content);
    const accessesOnlyDeclaredEnvNames =
      referencedEnvNames.size > 0 &&
      [...referencedEnvNames].every((name) => declaredEnvNames.has(name)) &&
      !hasBroadEnvAccess(content);

    if (!accessesOnlyDeclaredEnvNames) {
      const match = findFirstLine(content, /process\.env/);
      addFinding(findings, {
        code: REASON_CODES.CREDENTIAL_HARVEST,
        severity: "critical",
        file: path,
        line: match.line,
        message: "Environment variable access combined with network send.",
        evidence: match.text,
      });
    }
  }

  if (
    /(\\x[0-9a-fA-F]{2}){6,}/.test(content) ||
    /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/.test(content)
  ) {
    const match = findFirstLine(content, /(\\x[0-9a-fA-F]{2}){6,}|(?:atob|Buffer\.from)\s*\(/);
    addFinding(findings, {
      code: REASON_CODES.OBFUSCATED_CODE,
      severity: "warn",
      file: path,
      line: match.line,
      message: "Potential obfuscated payload detected.",
      evidence: match.text,
    });
  }
}

function scanMarkdownFile(path: string, content: string, findings: ModerationFinding[]) {
  if (!MARKDOWN_EXTENSION.test(path)) return;

  const credentialExposure = findCredentialExposureInstruction(content);
  if (credentialExposure) {
    addFinding(findings, {
      code: REASON_CODES.CREDENTIAL_EXPOSURE_INSTRUCTIONS,
      severity: "critical",
      file: path,
      line: credentialExposure.line,
      message: "Instructions expose credentials through shell, git config, or agent memory.",
      evidence: credentialExposure.text,
    });
  }

  if (hasMaliciousInstallPrompt(content)) {
    const match = findFirstLine(
      content,
      /installer-package\s*:|base64\s+-?[dD]|(?:curl|wget)\b|run\s+it\s+in\s+terminal/i,
    );
    addFinding(findings, {
      code: REASON_CODES.MALICIOUS_INSTALL_PROMPT,
      severity: "critical",
      file: path,
      line: match.line,
      message: "Install prompt contains an obfuscated terminal payload.",
      evidence: match.text,
    });
  }

  const destructiveDelete = findUnguardedDestructiveDelete(content);
  if (destructiveDelete) {
    addFinding(findings, {
      code: REASON_CODES.DESTRUCTIVE_DELETE_COMMAND,
      severity: "warn",
      file: path,
      line: destructiveDelete.line,
      message:
        "Documentation contains a destructive delete command without an explicit confirmation gate.",
      evidence: destructiveDelete.text,
    });
  }

  const unsafeBrowserTextInput = findUnsafeBrowserTextInput(content);
  if (unsafeBrowserTextInput) {
    addFinding(findings, {
      code: REASON_CODES.UNSAFE_BROWSER_TEXT_INPUT,
      severity: "warn",
      file: path,
      line: unsafeBrowserTextInput.line,
      message: "Shell positional input is typed into browser automation without validation.",
      evidence: unsafeBrowserTextInput.text,
    });
  }

  if (
    /ignore\s+(all\s+)?previous\s+instructions/i.test(content) ||
    /system\s*prompt\s*[:=]/i.test(content)
  ) {
    const match = findFirstLine(
      content,
      /ignore\s+(all\s+)?previous\s+instructions|system\s*prompt\s*[:=]/i,
    );
    addFinding(findings, {
      code: REASON_CODES.INJECTION_INSTRUCTIONS,
      severity: "warn",
      file: path,
      line: match.line,
      message: "Prompt-injection style instruction pattern detected.",
      evidence: match.text,
    });
  }

  if (
    GENERATED_SOURCE_PLACEHOLDER_PATTERN.test(content) &&
    GENERATED_SOURCE_CONTEXT_PATTERN.test(content)
  ) {
    const match = findFirstLine(content, GENERATED_SOURCE_PLACEHOLDER_PATTERN);
    addFinding(findings, {
      code: REASON_CODES.GENERATED_SOURCE_TEMPLATE,
      severity: "critical",
      file: path,
      line: match.line,
      message: "User-controlled placeholder is embedded directly into generated source code.",
      evidence: match.text,
    });
  }

  if (HARDCODED_CONNECTION_ID_PATTERN.test(content)) {
    const match = findFirstLine(content, HARDCODED_CONNECTION_ID_PATTERN);
    addFinding(findings, {
      code: REASON_CODES.EXPOSED_RESOURCE_IDENTIFIER,
      severity: "critical",
      file: path,
      line: match.line,
      message: "Example code exposes a concrete connection_id instead of a placeholder.",
      evidence: match.text,
    });
  }

  const spreadsheetUrlPattern = new RegExp(
    GOOGLE_SHEETS_SPREADSHEET_URL_PATTERN.source,
    `${GOOGLE_SHEETS_SPREADSHEET_URL_PATTERN.flags.replaceAll("g", "")}g`,
  );
  for (const spreadsheetUrlMatch of content.matchAll(spreadsheetUrlPattern)) {
    const spreadsheetId = spreadsheetUrlMatch[1];
    if (!spreadsheetId || looksLikePlaceholderIdentifier(spreadsheetId)) continue;

    const match = findLineAtIndex(content, spreadsheetUrlMatch.index ?? 0);
    addFinding(findings, {
      code: REASON_CODES.EXPOSED_RESOURCE_IDENTIFIER,
      severity: "critical",
      file: path,
      line: match.line,
      message:
        "Example code exposes a concrete Google Sheets spreadsheet ID instead of a placeholder.",
      evidence: match.text,
    });
    break;
  }
}

function scanManifestFile(path: string, content: string, findings: ModerationFinding[]) {
  if (!MANIFEST_EXTENSION.test(path)) return;

  if (
    /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\//i.test(content) ||
    RAW_IP_URL_PATTERN.test(content)
  ) {
    const match = findFirstLine(
      content,
      /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\/|https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i,
    );
    addFinding(findings, {
      code: REASON_CODES.SUSPICIOUS_INSTALL_SOURCE,
      severity: "warn",
      file: path,
      line: match.line,
      message: "Install source points to URL shortener or raw IP.",
      evidence: match.text,
    });
  }
}

function dedupeEvidence(evidence: ModerationFinding[]) {
  const seen = new Set<string>();
  const out: ModerationFinding[] = [];
  for (const item of evidence) {
    const key = `${item.code}:${item.file}:${item.line}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 40);
}

function isStaticScanClean(staticScan: StaticScanResult | undefined) {
  // Older moderation records can predate static scan persistence; absence means
  // there are no static findings available to corroborate an external signal.
  return !staticScan || staticScan.reasonCodes.length === 0 || staticScan.status === "clean";
}

function isAvEngineStatsClean(stats: VirusTotalEngineStats | undefined) {
  if (!stats) return false;
  return (stats.malicious ?? 0) === 0 && (stats.suspicious ?? 0) === 0;
}

function getVtEngineStats(analysis: VirusTotalAnalysis | undefined) {
  return analysis?.engineStats ?? analysis?.metadata?.stats;
}

function isUncorroboratedVtCodeInsightSuspicious(params: {
  vtAnalysis?: VirusTotalAnalysis;
  staticScan?: StaticScanResult;
  llmStatus?: string;
}) {
  if (params.vtAnalysis?.scanner !== "code_insight") return false;
  if (!isExternalScannerClean(params.llmStatus)) return false;
  if (!isStaticScanClean(params.staticScan)) return false;
  return isAvEngineStatsClean(getVtEngineStats(params.vtAnalysis));
}

function addScannerStatusReason(
  reasonCodes: string[],
  scanner: "vt" | "llm",
  status?: string,
  options: { suppressSuspicious?: boolean } = {},
) {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "malicious") {
    reasonCodes.push(`malicious.${scanner}_malicious`);
  } else if (normalized === "suspicious" && !options.suppressSuspicious) {
    reasonCodes.push(`suspicious.${scanner}_suspicious`);
  }
}

export function runStaticModerationScan(input: StaticScanInput): StaticScanResult {
  const findings: ModerationFinding[] = [];
  const files = [...input.fileContents].sort((a, b) => a.path.localeCompare(b.path));
  const declaredEnvNames = collectDeclaredEnvNames(input);

  for (const file of files) {
    scanSecretLiteralFile(file.path, file.content, findings);
    scanCodeFile(file.path, file.content, findings, declaredEnvNames);
    scanMarkdownFile(file.path, file.content, findings);
    scanManifestFile(file.path, file.content, findings);
  }

  const installJson = JSON.stringify(input.metadata ?? {});
  if (/https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\//i.test(installJson)) {
    addFinding(findings, {
      code: REASON_CODES.SUSPICIOUS_INSTALL_SOURCE,
      severity: "warn",
      file: "metadata",
      line: 1,
      message: "Install metadata references shortener URL.",
      evidence: installJson,
    });
  }

  const alwaysValue = input.frontmatter.always;
  if (alwaysValue === true || alwaysValue === "true") {
    addFinding(findings, {
      code: REASON_CODES.MANIFEST_PRIVILEGED_ALWAYS,
      severity: "warn",
      file: "SKILL.md",
      line: 1,
      message: "Skill is configured with always=true (persistent invocation).",
      evidence: "always: true",
    });
  }

  const identityText = `${input.slug}\n${input.displayName}\n${input.summary ?? ""}`;
  if (/keepcold131\/ClawdAuthenticatorTool|ClawdAuthenticatorTool/i.test(identityText)) {
    addFinding(findings, {
      code: REASON_CODES.KNOWN_BLOCKED_SIGNATURE,
      severity: "critical",
      file: "metadata",
      line: 1,
      message: "Matched a known blocked malware signature.",
      evidence: identityText,
    });
  }

  findings.sort((a, b) =>
    `${a.code}:${a.file}:${a.line}:${a.message}`.localeCompare(
      `${b.code}:${b.file}:${b.line}:${b.message}`,
    ),
  );

  const reasonCodes = normalizeReasonCodes(findings.map((finding) => finding.code));
  const status = verdictFromCodes(reasonCodes);
  return {
    status,
    reasonCodes,
    findings,
    summary: summarizeReasonCodes(reasonCodes),
    engineVersion: MODERATION_ENGINE_VERSION,
    checkedAt: Date.now(),
  };
}

function isExternalScannerClean(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized === "clean" || normalized === "benign";
}

export function buildModerationSnapshot(params: {
  staticScan?: StaticScanResult;
  vtAnalysis?: VirusTotalAnalysis;
  vtStatus?: string;
  llmStatus?: string;
  sourceVersionId?: Id<"skillVersions">;
}): ModerationSnapshot {
  let staticCodes = [...(params.staticScan?.reasonCodes ?? [])];
  const evidence = [...(params.staticScan?.findings ?? [])];

  // When both external scanners (VT + LLM) explicitly report clean/benign,
  // only suppress allowlisted false-positive static codes from the verdict calculation.
  // Everything else remains part of the moderation decision.
  const vtClean = isExternalScannerClean(params.vtStatus);
  const llmClean = isExternalScannerClean(params.llmStatus);
  if (vtClean && llmClean && staticCodes.length > 0) {
    staticCodes = staticCodes.filter((code) => !isExternallyClearableSuspiciousCode(code));
  }

  const reasonCodes = [...staticCodes];
  const vtStatus = params.vtStatus ?? params.vtAnalysis?.status;
  addScannerStatusReason(reasonCodes, "vt", vtStatus, {
    suppressSuspicious: isUncorroboratedVtCodeInsightSuspicious({
      vtAnalysis: params.vtAnalysis,
      staticScan: params.staticScan,
      llmStatus: params.llmStatus,
    }),
  });
  addScannerStatusReason(reasonCodes, "llm", params.llmStatus);

  const normalizedCodes = normalizeReasonCodes(reasonCodes);
  const verdict = verdictFromCodes(normalizedCodes);
  return {
    verdict,
    reasonCodes: normalizedCodes,
    evidence: dedupeEvidence(evidence),
    summary: summarizeReasonCodes(normalizedCodes),
    engineVersion: MODERATION_ENGINE_VERSION,
    evaluatedAt: Date.now(),
    sourceVersionId: params.sourceVersionId,
    legacyFlags: legacyFlagsFromVerdict(verdict),
  };
}

export function resolveSkillVerdict(
  skill: Pick<
    Doc<"skills">,
    "moderationVerdict" | "moderationFlags" | "moderationReason" | "moderationReasonCodes"
  >,
): ModerationVerdict {
  if (skill.moderationVerdict) return skill.moderationVerdict;
  if (skill.moderationFlags?.includes("blocked.malware")) return "malicious";
  if (skill.moderationFlags?.includes("flagged.suspicious")) return "suspicious";
  if (
    skill.moderationReason?.startsWith("scanner.") &&
    skill.moderationReason.endsWith(".malicious")
  ) {
    return "malicious";
  }
  if (
    skill.moderationReason?.startsWith("scanner.") &&
    skill.moderationReason.endsWith(".suspicious")
  ) {
    return "suspicious";
  }
  if ((skill.moderationReasonCodes ?? []).some((code) => code.startsWith("malicious."))) {
    return "malicious";
  }
  if ((skill.moderationReasonCodes ?? []).length > 0) return "suspicious";
  return "clean";
}
