import type { Id } from "../_generated/dataModel";
import {
  legacyFlagsFromVerdict,
  MODERATION_ENGINE_VERSION,
  normalizeReasonCodes,
  type ModerationFinding,
  REASON_CODES,
  type ScannerModerationVerdict,
  summarizeReasonCodes,
  verdictFromCodes,
} from "./moderationReasonCodes";

// ClawScan is the only scanner that feeds the structured moderation snapshot.
// The deterministic static publish scan and VirusTotal telemetry were retired.

type LlmRiskFinding = {
  status?: string;
  severity?: string;
};

type LlmRiskSummaryBucket = {
  status?: string;
  highestSeverity?: string;
};

type LlmAnalysis = {
  status?: string;
  verdict?: string;
  agenticRiskFindings?: LlmRiskFinding[];
  riskSummary?: Record<string, LlmRiskSummaryBucket | undefined>;
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

function normalizedSeverityRank(severity: string | undefined) {
  switch (severity?.trim().toLowerCase()) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function highestLlmConcernSeverityRank(analysis: LlmAnalysis | undefined) {
  let rank = 0;
  for (const finding of analysis?.agenticRiskFindings ?? []) {
    if (finding.status !== "concern") continue;
    rank = Math.max(rank, normalizedSeverityRank(finding.severity));
  }
  for (const bucket of Object.values(analysis?.riskSummary ?? {})) {
    if (bucket?.status !== "concern") continue;
    rank = Math.max(rank, normalizedSeverityRank(bucket.highestSeverity));
  }
  return rank;
}

function addLlmStatusReason(reasonCodes: string[], status?: string, analysis?: LlmAnalysis) {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "malicious") {
    reasonCodes.push("malicious.llm_malicious");
    return;
  }
  if (normalized !== "suspicious") return;

  const concernRank = highestLlmConcernSeverityRank(analysis);
  if (concernRank >= normalizedSeverityRank("high")) {
    reasonCodes.push("suspicious.llm_suspicious");
  } else {
    reasonCodes.push(REASON_CODES.LLM_REVIEW);
  }
}

function completedCodexStatus(status?: string, analysis?: LlmAnalysis) {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "clean" || normalized === "suspicious" || normalized === "malicious") {
    return normalized;
  }
  const verdict = analysis?.verdict?.trim().toLowerCase();
  if (verdict === "benign") return "clean";
  if (verdict === "suspicious" || verdict === "malicious") return verdict;
  return undefined;
}

export function buildModerationSnapshot(params: {
  llmStatus?: string;
  llmAnalysis?: LlmAnalysis;
  sourceVersionId?: Id<"skillVersions">;
}): ModerationSnapshot {
  const llmStatus = params.llmStatus ?? params.llmAnalysis?.status;
  const codexStatus = completedCodexStatus(llmStatus, params.llmAnalysis);

  const reasonCodes: string[] = [];
  addLlmStatusReason(reasonCodes, codexStatus, params.llmAnalysis);

  const normalizedCodes = normalizeReasonCodes(reasonCodes);
  const verdict = verdictFromCodes(normalizedCodes);
  return {
    verdict,
    reasonCodes: normalizedCodes,
    evidence: [],
    summary: summarizeReasonCodes(normalizedCodes),
    engineVersion: MODERATION_ENGINE_VERSION,
    evaluatedAt: Date.now(),
    sourceVersionId: params.sourceVersionId,
    legacyFlags: legacyFlagsFromVerdict(verdict),
  };
}
