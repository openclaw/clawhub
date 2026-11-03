import { type Infer, v } from "convex/values";

const MAX_CAVEATS = 10;
const MAX_TAGS = 8;

export const skillSpectorReviewFields = {
  tags: v.optional(v.array(v.string())),
  reviewOutcome: v.optional(v.string()),
  reviewConfidence: v.optional(v.number()),
};

export const skillSpectorInspectionCaveatsValidator = v.object({
  status: v.literal("complete_with_caveats"),
  referenceCount: v.number(),
  references: v.array(
    v.object({
      sourcePath: v.optional(v.string()),
      line: v.optional(v.number()),
      column: v.optional(v.number()),
      evidence: v.optional(v.string()),
      targetPath: v.optional(v.string()),
      status: v.optional(v.string()),
      disposition: v.optional(v.string()),
      referenceKind: v.optional(v.string()),
    }),
  ),
  exceptionCount: v.number(),
  ledgerExceptions: v.array(
    v.object({
      phase: v.optional(v.string()),
      reasonCode: v.optional(v.string()),
      path: v.optional(v.string()),
      message: v.optional(v.string()),
    }),
  ),
});

export type SkillSpectorInspectionCaveats = Infer<typeof skillSpectorInspectionCaveatsValidator>;
export type SkillSpectorReviewContext = {
  tags?: string[];
  reviewOutcome?: string;
  reviewConfidence?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, limit = 512) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  // Worker summaries are capped again when stored. Preserve their bounded
  // marker instead of replacing the original omitted-character count.
  if (/^\n\.\.\.\[truncated [1-9][0-9]{0,15} chars\]$/.test(normalized.slice(limit)))
    return normalized;
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit)}\n...[truncated ${normalized.length - limit} chars]`;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeSkillSpectorReviewContext(input: unknown): SkillSpectorReviewContext {
  const row = record(input);
  const evidence = record(row.evidence);
  const tags = Array.isArray(row.tags)
    ? row.tags
        .map((tag) => text(tag, 128))
        .filter((tag): tag is string => tag !== undefined)
        .slice(0, MAX_TAGS)
    : [];
  const reviewOutcome = text(row.reviewOutcome ?? evidence.llm_review_outcome);
  const confidence = number(row.reviewConfidence ?? evidence.llm_review_confidence);
  return {
    ...(tags.length ? { tags } : {}),
    ...(reviewOutcome ? { reviewOutcome } : {}),
    ...(confidence !== undefined
      ? {
          reviewConfidence: Math.max(
            0,
            Math.min(1, confidence > 1 ? confidence / 100 : confidence),
          ),
        }
      : {}),
  };
}

// Counts disclose truncation. Unabridged evidence remains in scannerReportsStorageId.
export function capSkillSpectorInspectionCaveats(
  caveats: SkillSpectorInspectionCaveats,
): SkillSpectorInspectionCaveats {
  return {
    status: "complete_with_caveats",
    referenceCount: Math.max(number(caveats.referenceCount) ?? 0, caveats.references.length),
    references: caveats.references.slice(0, MAX_CAVEATS).map((row) => ({
      sourcePath: text(row.sourcePath),
      line: number(row.line),
      column: number(row.column),
      evidence: text(row.evidence),
      targetPath: text(row.targetPath),
      status: text(row.status),
      disposition: text(row.disposition),
      referenceKind: text(row.referenceKind),
    })),
    exceptionCount: Math.max(number(caveats.exceptionCount) ?? 0, caveats.ledgerExceptions.length),
    ledgerExceptions: caveats.ledgerExceptions.slice(0, MAX_CAVEATS).map((row) => ({
      phase: text(row.phase),
      reasonCode: text(row.reasonCode),
      path: text(row.path),
      message: text(row.message),
    })),
  };
}
