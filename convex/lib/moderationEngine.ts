import type { Doc, Id } from "../_generated/dataModel";
import {
  legacyFlagsFromVerdict,
  MODERATION_ENGINE_VERSION,
  normalizeReasonCodes,
  type ModerationFinding,
  REASON_CODES,
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
  status: ModerationVerdict;
  reasonCodes: string[];
  findings: ModerationFinding[];
  summary: string;
  engineVersion: string;
  checkedAt: number;
};

export type ModerationSnapshot = {
  verdict: ModerationVerdict;
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

function truncateEvidence(evidence: string, maxLen = 160) {
  if (evidence.length <= maxLen) return evidence;
  return `${evidence.slice(0, maxLen)}…`;
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
  if (hasChildProcess) {
    const match = findFirstLine(
      content,
      /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    );
    if (match.text) {
      addFinding(findings, {
        code: REASON_CODES.DANGEROUS_EXEC,
        severity: "critical",
        file: path,
        line: match.line,
        message: "Shell command execution detected (child_process).",
        evidence: match.text,
      });
    }
  }

  const dynamicCodeMatch = findFirstLine(content, /\beval\s*\(|new\s+Function\s*\(/);
  if (dynamicCodeMatch.text && /\beval\s*\(|new\s+Function\s*\(/.test(content)) {
    addFinding(findings, {
      code: REASON_CODES.DYNAMIC_CODE,
      severity: "critical",
      file: path,
      line: dynamicCodeMatch.line,
      message: "Dynamic code execution detected.",
      evidence: dynamicCodeMatch.text,
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
  if (
    /ignore\s+(all\s+)?previous\s+instructions/i.test(content) ||
    /system\s*prompt\s*[:=]/i.test(content) ||
    /you\s+are\s+now\s+(a|an)\b/i.test(content)
  ) {
    const match = findFirstLine(
      content,
      /ignore\s+(all\s+)?previous\s+instructions|system\s*prompt\s*[:=]|you\s+are\s+now\s+(a|an)\b/i,
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
    /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i.test(content)
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

  const reasonCodes = normalizeReasonCodes(findings.map((f) => f.code));
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

export function buildModerationSnapshot(params: {
  staticScan?: StaticScanResult;
  vtStatus?: string;
  llmStatus?: string;
  existingReasonCodes?: string[];
  existingEvidence?: ModerationFinding[];
  sourceVersionId?: Id<"skillVersions">;
}): ModerationSnapshot {
  const reasonCodes = [...(params.existingReasonCodes ?? [])];
  const evidence = [...(params.existingEvidence ?? [])];

  if (params.staticScan) {
    reasonCodes.push(...params.staticScan.reasonCodes);
    evidence.push(...params.staticScan.findings);
  }

  const vt = params.vtStatus?.trim().toLowerCase();
  if (vt === "malicious") reasonCodes.push("malicious.vt_malicious");
  if (vt === "suspicious") reasonCodes.push("suspicious.vt_suspicious");

  const llm = params.llmStatus?.trim().toLowerCase();
  if (llm === "malicious") reasonCodes.push("malicious.llm_malicious");
  if (llm === "suspicious") reasonCodes.push("suspicious.llm_suspicious");

  const normalizedCodes = normalizeReasonCodes(reasonCodes);
  const verdict = verdictFromCodes(normalizedCodes);
  const normalizedEvidence = dedupeEvidence(evidence);
  return {
    verdict,
    reasonCodes: normalizedCodes,
    evidence: normalizedEvidence,
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
