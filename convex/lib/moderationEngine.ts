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

function scanCodeFile(path: string, content: string, findings: ModerationFinding[]) {
  if (!CODE_EXTENSION.test(path)) return;

  const hasChildProcess = /child_process/.test(content);
  const execPattern = /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/;
  if (hasChildProcess && execPattern.test(content)) {
    const match = findFirstLine(content, execPattern);
    addFinding(findings, {
      code: REASON_CODES.DANGEROUS_EXEC,
      severity: "critical",
      file: path,
      line: match.line,
      message: "Shell command execution detected (child_process).",
      evidence: match.text,
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

function addScannerStatusReason(reasonCodes: string[], scanner: "vt" | "llm", status?: string) {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "malicious") {
    reasonCodes.push(`malicious.${scanner}_malicious`);
  } else if (normalized === "suspicious") {
    reasonCodes.push(`suspicious.${scanner}_suspicious`);
  }
}

export function runStaticModerationScan(input: StaticScanInput): StaticScanResult {
  const findings: ModerationFinding[] = [];
  const files = [...input.fileContents].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of files) {
    scanCodeFile(file.path, file.content, findings);
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
  addScannerStatusReason(reasonCodes, "vt", params.vtStatus);
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
