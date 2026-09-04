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
  return ["audit", ...IGNORED_ADVISORIES.flatMap((id) => ["--ignore", id])];
}

type AuditAttempt = { exitCode: number; output: string };

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
  return { exitCode: result.status ?? 1, output };
}

if (import.meta.main) {
  const exitCode = await runAuditWithRetry(
    runBunAudit,
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  process.exit(exitCode);
}
