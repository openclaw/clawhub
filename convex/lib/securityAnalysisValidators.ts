import { v } from "convex/values";
import {
  skillSpectorInspectionCaveatsValidator,
  skillSpectorReviewFields,
} from "./skillSpectorEvidence";

const vtEngineStatsValidator = v.object({
  malicious: v.optional(v.number()),
  suspicious: v.optional(v.number()),
  undetected: v.optional(v.number()),
  harmless: v.optional(v.number()),
});

export const vtAnalysisValidator = v.object({
  status: v.string(),
  verdict: v.optional(v.string()),
  analysis: v.optional(v.string()),
  source: v.optional(v.string()),
  scanner: v.optional(v.string()),
  engineStats: v.optional(vtEngineStatsValidator),
  checkedAt: v.number(),
});

const skillSpectorIssueValidator = v.object({
  ...skillSpectorReviewFields,
  issueId: v.string(),
  category: v.optional(v.string()),
  pattern: v.optional(v.string()),
  severity: v.string(),
  confidence: v.optional(v.number()),
  file: v.optional(v.string()),
  startLine: v.optional(v.number()),
  endLine: v.optional(v.number()),
  explanation: v.string(),
  remediation: v.optional(v.string()),
  finding: v.optional(v.string()),
  codeSnippet: v.optional(v.string()),
});

export const skillSpectorAnalysisValidator = v.object({
  inspectionCaveats: v.optional(skillSpectorInspectionCaveatsValidator),
  status: v.string(),
  inspectionStatus: v.optional(v.union(v.literal("completed"), v.literal("partial"))),
  score: v.optional(v.number()),
  severity: v.optional(v.string()),
  recommendation: v.optional(v.string()),
  issueCount: v.number(),
  // Scanner/action boundaries cap this array before storage; Convex validators cannot express max length.
  issues: v.array(skillSpectorIssueValidator),
  scannerVersion: v.optional(v.string()),
  summary: v.optional(v.string()),
  error: v.optional(v.string()),
  checkedAt: v.number(),
});

export const aigAnalysisValidator = v.object({
  status: v.string(),
  issueCount: v.number(),
  findings: v.array(
    v.object({
      ruleId: v.string(),
      level: v.string(),
      message: v.string(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      file: v.optional(v.string()),
      startLine: v.optional(v.number()),
      endLine: v.optional(v.number()),
      remediation: v.optional(v.string()),
    }),
  ),
  scannerVersion: v.optional(v.string()),
  summary: v.optional(v.string()),
  error: v.optional(v.string()),
  checkedAt: v.number(),
});

export const staticScanValidator = v.object({
  status: v.union(v.literal("clean"), v.literal("suspicious"), v.literal("malicious")),
  reasonCodes: v.array(v.string()),
  findings: v.array(
    v.object({
      code: v.string(),
      severity: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
      file: v.string(),
      line: v.number(),
      message: v.string(),
      evidence: v.string(),
    }),
  ),
  summary: v.string(),
  engineVersion: v.string(),
  checkedAt: v.number(),
});
