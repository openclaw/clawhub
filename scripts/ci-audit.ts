import { spawnSync } from "node:child_process";

// Advisories reviewed and accepted; keep this the single list for `bun audit`.
const IGNORED_ADVISORIES = [
  "GHSA-rmmr-r34h-pfm5",
  "GHSA-gv7w-rqvm-qjhr",
  "GHSA-g7r4-m6w7-qqqr",
  "GHSA-x4vx-rjvf-j5p4",
  "GHSA-76mc-f452-cxcm",
  "GHSA-hpcv-96wg-7vj8",
  "GHSA-r47g-fvhr-h676",
  "GHSA-vxr8-fq34-vvx9",
  "GHSA-gvmj-g25r-r7wr",
  "GHSA-rp9w-3fw7-7cwq",
  "GHSA-cmwh-pvxp-8882",
  "GHSA-vmh5-mc38-953g",
  "GHSA-pr7r-676h-xcf6",
];

// Budget fits the 5-minute `static` job: 3 attempts x 60s cap plus 5s/10s backoff.
const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 60_000;

// `bun audit` talks to the npm advisory endpoint; a dropped connection is not
// an advisory finding, so it gets retried instead of failing the static gate.
const TRANSIENT_FAILURE_PATTERNS = [
  /ConnectionClosed/i,
  /audit request failed/i,
  /fetch failed/i,
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE)\b/,
];

export function isTransientAuditFailure(output: string): boolean {
  return TRANSIENT_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

export function auditArgs(): string[] {
  return ["audit", "--json", ...IGNORED_ADVISORIES.flatMap((id) => ["--ignore", id])];
}

type Advisory = { title?: unknown; url?: unknown; severity?: unknown; cwe?: unknown };

function isExpectedAuditStderr(output: string): boolean {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, "").trim();
  return plain === "" || /^bun audit v\d+\.\d+\.\d+ \([0-9a-f]+\)$/.test(plain);
}

// Malware advisories carry CWE-506 or say the package itself is malware or was
// compromised ("Malware in x", "x have embedded malicious code", "briefly
// compromised with malware"). Vulnerabilities that merely mention malicious input
// ("crafted malicious code", "Malicious WebSocket ...") stay warnings.
const MALWARE_CWE = "CWE-506";
const MALWARE_TITLES = [
  /\bmalware\b/i,
  /\bcompromised\b/i,
  /^\s*malicious\s+(?:code|packages?|versions?)\s+in\b/i,
  /\b(?:embedded|contains?|has|have)\s+(?:embedded\s+)?malicious\s+code\b/i,
];

// Release policy: advisories never block CI or a deploy; they are recorded as
// warnings and patched through main. A known-malware package still blocks.
export function classifyAuditFindings(output: string) {
  const start = output.indexOf("{");
  if (start === -1) return null;
  let report: Record<string, Advisory[]>;
  try {
    report = JSON.parse(output.slice(start)) as Record<string, Advisory[]>;
  } catch {
    return null;
  }
  // `bun audit --json` returns the unfiltered response, so apply the reviewed list here.
  const ignored = (advisory: Advisory) =>
    typeof advisory.url === "string" &&
    IGNORED_ADVISORIES.some((id) => advisory.url === `https://github.com/advisories/${id}`);
  const findings = Object.entries(report).flatMap(([name, advisories]) =>
    (Array.isArray(advisories) ? advisories : [])
      .filter((advisory) => !ignored(advisory))
      .map((advisory) => ({
        name,
        title: typeof advisory.title === "string" ? advisory.title : "advisory",
        url: typeof advisory.url === "string" ? advisory.url : "",
        severity: typeof advisory.severity === "string" ? advisory.severity : "unknown",
        cwe: Array.isArray(advisory.cwe) ? advisory.cwe : [],
      })),
  );
  return {
    malware: findings.filter(
      (finding) =>
        finding.cwe.includes(MALWARE_CWE) ||
        MALWARE_TITLES.some((pattern) => pattern.test(finding.title)),
    ),
    advisories: findings,
  };
}

export function auditExitCode(
  attempt: AuditAttempt,
  log: (message: string) => void = (message) => console.log(message),
) {
  if (attempt.toolFailure || !isExpectedAuditStderr(attempt.stderr ?? "")) {
    return attempt.exitCode || 1;
  }
  if (attempt.exitCode === 0) return 0;
  // Bun 1.3.x writes its audit banner to stderr after the JSON on stdout.
  const findings = classifyAuditFindings(attempt.jsonOutput ?? attempt.output);
  // Unparseable output is a tool failure, not an advisory decision.
  if (!findings) return attempt.exitCode;
  for (const finding of findings.advisories) {
    const level = findings.malware.includes(finding) ? "error" : "warning";
    log(
      `::${level} title=Dependency ${level === "error" ? "malware" : "advisory"}::${finding.name} (${finding.severity}) ${finding.title} ${finding.url}`,
    );
  }
  return findings.malware.length > 0 ? 1 : 0;
}

type AuditAttempt = {
  exitCode: number;
  output: string;
  jsonOutput?: string;
  stderr?: string;
  toolFailure?: boolean;
};

export async function runAuditWithRetry(
  attempt: () => AuditAttempt,
  sleep: (ms: number) => Promise<void>,
  log: (message: string) => void = (message) => console.warn(message),
): Promise<number> {
  for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
    const result = attempt();
    if (result.exitCode === 0) return 0;
    if (!isTransientAuditFailure(result.output) || n === MAX_ATTEMPTS) return result.exitCode;
    const delayMs = n * 5_000;
    log(
      `[ci-audit] transient registry failure (attempt ${n}/${MAX_ATTEMPTS}); retrying in ${delayMs / 1_000}s`,
    );
    await sleep(delayMs);
  }
  return 1;
}

function runBunAudit(): AuditAttempt {
  const result = spawnSync("bun", auditArgs(), { encoding: "utf8", timeout: ATTEMPT_TIMEOUT_MS });
  // A hung advisory request surfaces as a killed child; report it as ETIMEDOUT
  // so the retry classifier treats it like any other dropped connection.
  const timedOut = result.error !== undefined || result.signal !== null;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${timedOut ? "\n[ci-audit] ETIMEDOUT: bun audit exceeded 60s\n" : ""}`;
  process.stdout.write(output);
  return {
    exitCode: result.status ?? 1,
    output,
    jsonOutput: result.stdout ?? "",
    stderr: result.stderr ?? "",
    toolFailure: timedOut,
  };
}

if (import.meta.main) {
  let last: AuditAttempt = { exitCode: 1, output: "" };
  const exitCode = await runAuditWithRetry(
    () => (last = runBunAudit()),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  process.exit(exitCode === 0 ? 0 : auditExitCode(last));
}
