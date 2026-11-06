import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const unit = z.number().finite().min(0).max(1);
const verdict = z.enum(["benign", "suspicious", "malicious"]);
const dimension = z.strictObject({ status: z.enum(["ok", "note", "concern"]), confidence: unit });
export const decisionDimensionLabels = {
  purpose_capability: "Purpose & Capability",
  instruction_scope: "Instruction Scope",
  install_mechanism: "Install Mechanism",
  environment_proportionality: "Credentials",
  persistence_privilege: "Persistence & Privilege",
};
const decisionSchema = z.strictObject({
  verdict,
  confidence: z.enum(["high", "medium", "low"]),
  dimensions: z.strictObject({
    purpose_capability: dimension,
    instruction_scope: dimension,
    install_mechanism: dimension,
    environment_proportionality: dimension,
    persistence_privilege: dimension,
  }),
  scan_findings_in_context: z.array(
    z.strictObject({
      ruleId: z.string(),
      scanner: z.string(),
      expected_for_purpose: z.boolean(),
      probability: unit,
    }),
  ),
  decision: z.strictObject({
    api: z.literal("decisions"),
    endpointHost: z.string().trim().min(1),
    requestedModel: z.string().trim().min(1),
    model: z.string().trim().min(1),
    latencyMs: z.number().int().nonnegative(),
    httpAttempts: z.number().int().positive(),
    usage: z.record(z.string(), z.unknown()),
    input: z.record(z.string(), z.unknown()),
    verdict: z.strictObject({
      choice: verdict,
      confidence: unit,
      probabilities: z.record(z.string(), unit),
    }),
    signals: z.record(z.string(), unit),
  }),
});
// The scanner-only Codex profile uses the same typed dimensions but never
// supplies Decisions probabilities/provenance or an artifact-inspection receipt.
const evidenceJudgeSchema = decisionSchema.omit({ decision: true });
export function isEvidenceOnlyCodexRun(run: Record<string, unknown>) {
  const judge = object(run.judge);
  const command = judge?.command;
  return (
    typeof command === "string" &&
    /\bcodex\s+exec\b/.test(command) &&
    command.includes("evidence-judge.schema.json")
  );
}
export function isTypedScannerJudgeRun(run: Record<string, unknown>) {
  return isDecisionsRun(run) || isEvidenceOnlyCodexRun(run);
}
const overviewSchema = z.strictObject({
  summary: z.string(),
  dimensions: z.strictObject({
    purpose_capability: z.string(),
    instruction_scope: z.string(),
    install_mechanism: z.string(),
    environment_proportionality: z.string(),
    persistence_privilege: z.string(),
  }),
  scan_findings_in_context: z.array(z.strictObject({ ruleId: z.string(), note: z.string() })),
  user_guidance: z.string(),
});
export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function isDecisionsRun(run: Record<string, unknown>) {
  return Object.hasOwn(object(object(run.judge)?.result) ?? {}, "decision");
}
function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
// Timestamps alone are not execution evidence. Injected --scanner-result entries
// and synthetic startedAt fields must not count as scanner invocations.
export function hasScannerExecution(value: unknown) {
  const scanner = object(value);
  return Boolean(
    scanner &&
    ["completed", "failed", "partial"].includes(String(scanner.status)) &&
    validTime(scanner.startedAt) &&
    validTime(scanner.completedAt) &&
    Date.parse(scanner.completedAt) >= Date.parse(scanner.startedAt) &&
    Number.isSafeInteger(scanner.durationMs) &&
    (scanner.durationMs as number) >= 0 &&
    Array.isArray(scanner.command) &&
    scanner.command.length > 0 &&
    scanner.command[0] !== "scanner-result" &&
    scanner.command.every((arg) => typeof arg === "string" && arg.length > 0) &&
    Number.isSafeInteger(scanner.exitCode) &&
    (scanner.exitCode as number) >= 0 &&
    (scanner.exitCode as number) <= 255,
  );
}
export function decisionsJudgeAccounting(run: Record<string, unknown>) {
  const judge = object(run.judge);
  if (
    !judge ||
    !Array.isArray(judge.attempts) ||
    !judge.attempts.length ||
    judge.attempts.length > 2
  )
    return;
  const attempts = judge.attempts.map(object);
  if (
    attempts.some(
      (attempt) =>
        !attempt ||
        (attempt.commandStarted !== undefined && typeof attempt.commandStarted !== "boolean") ||
        !["completed", "failed"].includes(String(attempt.status)) ||
        typeof attempt.error !== "string" ||
        !Object.hasOwn(attempt, "result") ||
        !Number.isSafeInteger(attempt.durationMs) ||
        (attempt.durationMs as number) < 0 ||
        (attempt.status === "completed" &&
          (attempt.commandStarted === false || attempt.error !== "" || !object(attempt.result))) ||
        (attempt.status === "failed" && !attempt.error.trim()),
    )
  )
    return;
  const last = attempts.at(-1)!;
  if (
    last.status !== judge.status ||
    last.error !== judge.error ||
    last.commandStarted !== judge.commandStarted ||
    !isDeepStrictEqual(last.result, judge.result)
  )
    return;
  if (
    attempts.length === 2 &&
    (attempts[0]!.status !== "failed" ||
      attempts[0]!.commandStarted === false ||
      !String(attempts[0]!.error).includes("JSON"))
  )
    return;
  // Native Docker deliberately omits positive shell-start flags. Completed
  // validated output proves an invocation; a failed unknown-start attempt does
  // not justify inventing execution/failure counts. Preserve that uncertainty.
  const unknownFailedStart = attempts.some(
    (attempt) => attempt!.status === "failed" && attempt!.commandStarted === undefined,
  );
  return {
    judgeInvocations: unknownFailedStart
      ? null
      : attempts.filter(
          (attempt) => attempt!.commandStarted === true || attempt!.status === "completed",
        ).length,
    judgeOperationalFailures: unknownFailedStart
      ? null
      : attempts.filter(
          (attempt) => attempt!.commandStarted === true && attempt!.status === "failed",
        ).length,
    recoveredReceiptRetries: 0,
  };
}
export function validateAigMcpReport(value: unknown) {
  const document = object(value);
  if (
    document?.version !== "2.1.0" ||
    !Array.isArray(document.runs) ||
    document.runs.length !== 1
  ) {
    throw new Error("ClawScan AIG MCP report must contain one SARIF run");
  }
  const run = object(document.runs[0]);
  const driver = object(object(run?.tool)?.driver);
  const properties = object(run?.properties);
  if (
    !run ||
    driver?.name !== "aig-mcp-scan" ||
    !Array.isArray(run.results) ||
    properties?.scanNote !== "complete" ||
    (run.invocations !== undefined &&
      (!Array.isArray(run.invocations) ||
        !run.invocations.length ||
        run.invocations.some((entry) => {
          const invocation = object(entry);
          return (
            !invocation ||
            invocation.executionSuccessful !== true ||
            Object.entries(invocation).some(
              ([key, value]) => key.toLowerCase() === "executionsuccessful" && value !== true,
            )
          );
        })))
  ) {
    throw new Error("ClawScan AIG MCP report lacked successful complete execution evidence");
  }
  // AIG MCP 0.2.0 does not emit invocations. If supplied, validate them strictly.
  // Native adapter success and the qualified image own provider/exhaustion and
  // confined ranged-read checks; no property-name guess substitutes for them.
  return document;
}
export function validateDecisionsRun(run: Record<string, unknown>, scannerSet: readonly string[]) {
  if (
    run.schemaVersion !== "clawscan-run-v1" ||
    run.profile !== "clawhub" ||
    run.status !== "completed" ||
    run.complete !== true ||
    run.configSource !== "built-in" ||
    !validTime(run.startedAt) ||
    !validTime(run.completedAt) ||
    Date.parse(run.completedAt) < Date.parse(run.startedAt)
  ) {
    throw new Error("ClawScan Decisions requires a valid completed native run");
  }
  const scanners = object(run.scanners);
  if (!scanners || !Object.values(scanners).some(hasScannerExecution)) {
    throw new Error("ClawScan Decisions has no actual scanner execution");
  }
  if (scannerSet.includes("aig-mcp") && Object.keys(scanners).some((id) => id !== "aig-mcp")) {
    throw new Error("ClawScan plugin scan must contain only aig-mcp");
  }
  for (const id of scannerSet) {
    const scanner = object(scanners[id]);
    if (
      !scanner ||
      scanner.status !== "completed" ||
      scanner.error !== "" ||
      scanner.exitCode !== 0 ||
      !hasScannerExecution(scanner) ||
      (id === "aig-mcp" &&
        (!Array.isArray(scanner.command) || scanner.command[0] !== "aig-mcp-scan")) ||
      !object(scanner.raw)
    ) {
      throw new Error("ClawScan scanner " + id + " did not complete with execution provenance");
    }
  }
  const judge = object(run.judge);
  const evidenceOnly = isEvidenceOnlyCodexRun(run);
  if (
    !judge ||
    judge.status !== "completed" ||
    judge.error !== "" ||
    judge.commandStarted === false ||
    typeof judge.command !== "string" ||
    (!evidenceOnly && !judge.command.includes("clawscan-decisions-judge")) ||
    !/^[a-f0-9]{64}$/.test(String(judge.outputSchemaSha256)) ||
    !/^[a-f0-9]{64}$/.test(String(judge.promptSha256)) ||
    !decisionsJudgeAccounting(run)
  ) {
    throw new Error("ClawScan Decisions judge completion/provenance was invalid");
  }
  const parsed = evidenceOnly
    ? evidenceJudgeSchema.safeParse(judge.result)
    : decisionSchema.safeParse(judge.result);
  if (!parsed.success) throw new Error("ClawScan Decisions judge result did not match its schema");
  const result = parsed.data;
  const decision = evidenceOnly ? undefined : decisionSchema.parse(judge.result).decision;
  if (decision) {
    const confidence = decision.verdict.confidence;
    if (
      result.verdict !== decision.verdict.choice ||
      result.confidence !== (confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low")
    ) {
      throw new Error("ClawScan Decisions verdict/confidence disagreed with decision evidence");
    }
  }
  const overview = object(run.overview);
  const prose =
    overview?.status === "completed" &&
    overview.error === "" &&
    (overview.commandStarted === undefined || overview.commandStarted === true)
      ? overviewSchema.safeParse(overview.result)
      : undefined;
  const details = prose?.success ? prose.data : undefined;
  return {
    status: result.verdict === "benign" ? "clean" : result.verdict,
    verdict: result.verdict,
    confidence: result.confidence,
    ...(decision
      ? { model: decision.model }
      : typeof judge.configuredModel === "string" && judge.configuredModel.trim()
        ? { model: judge.configuredModel }
        : {}),
    checkedAt: Date.parse(run.completedAt),
    ...(details ? { summary: details.summary, guidance: details.user_guidance } : {}),
    dimensions: Object.entries(decisionDimensionLabels).map(([name, label]) => ({
      name,
      label,
      rating: result.dimensions[name as keyof typeof result.dimensions].status,
      detail: details?.dimensions[name as keyof typeof details.dimensions] ?? "",
    })),
  };
}
