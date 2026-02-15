const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000]);

const CODES = {
  dangerousExec: "suspicious.dangerous_exec",
  dynamicCode: "suspicious.dynamic_code_execution",
  credentialHarvest: "malicious.env_harvesting",
  exfiltration: "suspicious.potential_exfiltration",
  obfuscatedCode: "suspicious.obfuscated_code",
  suspiciousNetwork: "suspicious.suspicious_network",
  cryptoMining: "malicious.crypto_mining",
  injectionInstructions: "suspicious.prompt_injection_instructions",
  installSource: "suspicious.install_untrusted_source",
  privilegedAlways: "suspicious.privileged_always",
  knownSignature: "malicious.known_blocked_signature",
} as const;

export type LocalScanFinding = {
  code: string;
  severity: "info" | "warn" | "critical";
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type LocalStaticScanResult = {
  reasonCodes: string[];
  findings: LocalScanFinding[];
};

function firstLine(content: string, pattern: RegExp) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) return { line: i + 1, text: lines[i] };
  }
  return { line: 1, text: lines[0] ?? "" };
}

function pushFinding(findings: LocalScanFinding[], finding: LocalScanFinding) {
  findings.push({
    ...finding,
    evidence: finding.evidence.trim().slice(0, 140),
  });
}

function scanContent(path: string, content: string, findings: LocalScanFinding[]) {
  if (/\.(js|ts|mjs|cjs|mts|cts|jsx|tsx|py|sh|bash|zsh|rb|go)$/i.test(path)) {
    if (
      /child_process/.test(content) &&
      /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/.test(content)
    ) {
      const match = firstLine(
        content,
        /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
      );
      pushFinding(findings, {
        code: CODES.dangerousExec,
        severity: "critical",
        file: path,
        line: match.line,
        message: "Shell command execution detected (child_process).",
        evidence: match.text,
      });
    }
    if (/\beval\s*\(|new\s+Function\s*\(/.test(content)) {
      const match = firstLine(content, /\beval\s*\(|new\s+Function\s*\(/);
      pushFinding(findings, {
        code: CODES.dynamicCode,
        severity: "critical",
        file: path,
        line: match.line,
        message: "Dynamic code execution detected.",
        evidence: match.text,
      });
    }
    if (/stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i.test(content)) {
      const match = firstLine(content, /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i);
      pushFinding(findings, {
        code: CODES.cryptoMining,
        severity: "critical",
        file: path,
        line: match.line,
        message: "Possible crypto mining behavior detected.",
        evidence: match.text,
      });
    }
    const ws = content.match(/new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/);
    if (ws) {
      const port = Number.parseInt(ws[1] ?? "", 10);
      if (Number.isFinite(port) && !STANDARD_PORTS.has(port)) {
        const match = firstLine(content, /new\s+WebSocket\s*\(/);
        pushFinding(findings, {
          code: CODES.suspiciousNetwork,
          severity: "warn",
          file: path,
          line: match.line,
          message: "WebSocket connection to non-standard port detected.",
          evidence: match.text,
        });
      }
    }
    if (
      /readFileSync|readFile/.test(content) &&
      /\bfetch\b|http\.request|\baxios\b/.test(content)
    ) {
      const match = firstLine(content, /readFileSync|readFile/);
      pushFinding(findings, {
        code: CODES.exfiltration,
        severity: "warn",
        file: path,
        line: match.line,
        message: "File read combined with network send (possible exfiltration).",
        evidence: match.text,
      });
    }
    if (/process\.env/.test(content) && /\bfetch\b|http\.request|\baxios\b/.test(content)) {
      const match = firstLine(content, /process\.env/);
      pushFinding(findings, {
        code: CODES.credentialHarvest,
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
      const match = firstLine(content, /(\\x[0-9a-fA-F]{2}){6,}|(?:atob|Buffer\.from)\s*\(/);
      pushFinding(findings, {
        code: CODES.obfuscatedCode,
        severity: "warn",
        file: path,
        line: match.line,
        message: "Potential obfuscated payload detected.",
        evidence: match.text,
      });
    }
  }

  if (/\.(md|markdown|mdx)$/i.test(path)) {
    if (
      /ignore\s+(all\s+)?previous\s+instructions/i.test(content) ||
      /system\s*prompt\s*[:=]/i.test(content) ||
      /you\s+are\s+now\s+(a|an)\b/i.test(content)
    ) {
      const match = firstLine(
        content,
        /ignore\s+(all\s+)?previous\s+instructions|system\s*prompt\s*[:=]|you\s+are\s+now\s+(a|an)\b/i,
      );
      pushFinding(findings, {
        code: CODES.injectionInstructions,
        severity: "warn",
        file: path,
        line: match.line,
        message: "Prompt-injection style instruction pattern detected.",
        evidence: match.text,
      });
    }

    if (/^\s*always\s*:\s*true\b/im.test(content)) {
      const match = firstLine(content, /^\s*always\s*:\s*true\b/im);
      pushFinding(findings, {
        code: CODES.privilegedAlways,
        severity: "warn",
        file: path,
        line: match.line,
        message: "Skill sets always=true (persistent invocation).",
        evidence: match.text,
      });
    }
  }

  if (/\.(json|yaml|yml|toml)$/i.test(path)) {
    if (
      /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\//i.test(content) ||
      /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i.test(content)
    ) {
      const match = firstLine(
        content,
        /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\/|https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i,
      );
      pushFinding(findings, {
        code: CODES.installSource,
        severity: "warn",
        file: path,
        line: match.line,
        message: "Install source points to URL shortener or raw IP.",
        evidence: match.text,
      });
    }
  }

  if (/keepcold131\/ClawdAuthenticatorTool|ClawdAuthenticatorTool/i.test(content)) {
    const match = firstLine(content, /keepcold131\/ClawdAuthenticatorTool|ClawdAuthenticatorTool/i);
    pushFinding(findings, {
      code: CODES.knownSignature,
      severity: "critical",
      file: path,
      line: match.line,
      message: "Matched known blocked malware signature.",
      evidence: match.text,
    });
  }
}

export function scanLocalSkillFiles(
  files: Array<{ relPath: string; bytes: Uint8Array }>,
): LocalStaticScanResult {
  const decoder = new TextDecoder();
  const findings: LocalScanFinding[] = [];
  for (const file of files) {
    const content = decoder.decode(file.bytes);
    scanContent(file.relPath, content, findings);
  }
  findings.sort((a, b) =>
    `${a.code}:${a.file}:${a.line}:${a.message}`.localeCompare(
      `${b.code}:${b.file}:${b.line}:${b.message}`,
    ),
  );
  const reasonCodes = Array.from(new Set(findings.map((f) => f.code))).sort((a, b) =>
    a.localeCompare(b),
  );
  return { reasonCodes, findings };
}
