export type CommentScamVerdict = "not_scam" | "likely_scam" | "certain_scam";
export type CommentScamConfidence = "low" | "medium" | "high";

export type CommentScamEvalResponse = {
  verdict: CommentScamVerdict;
  confidence: CommentScamConfidence;
  explanation: string;
  evidence: string[];
};

export const COMMENT_SCAM_EVAL_MAX_OUTPUT_TOKENS = 1200;
const MAX_COMMENT_CHARS = 4000;
const MAX_EXPLANATION_CHARS = 1200;
const MAX_EVIDENCE_ITEMS = 5;
const MAX_EVIDENCE_ITEM_CHARS = 160;
const MAX_BAN_REASON_CHARS = 500;

const VALID_VERDICTS = new Set<CommentScamVerdict>(["not_scam", "likely_scam", "certain_scam"]);
const VALID_CONFIDENCES = new Set<CommentScamConfidence>(["low", "medium", "high"]);

export const COMMENT_SCAM_EVALUATOR_SYSTEM_PROMPT = `You are a trust and safety classifier for user comments on a software registry.

Goal: detect comment scams with high precision.

A "certain_scam" verdict is only allowed when the comment clearly attempts fraud, credential theft, malware delivery, or social-engineering abuse.

High-confidence scam patterns include:
- Instructing users to run suspicious shell commands (especially obfuscated/base64/piped-to-bash/curl installer tricks).
- Fake support/update instructions pointing to unknown domains, executables, or terminal one-liners.
- Requests for private keys, seed phrases, passwords, API keys, session tokens, or wallet recovery data.
- Impersonation or urgent pressure language to bypass trust checks.
- Known scam payload structure (e.g. echo+base64+decode+bash, hidden downloader chains).

Important anti-false-positive rules:
- Do NOT mark legitimate troubleshooting or normal install instructions as "certain_scam" unless the malicious intent is explicit.
- If suspicious but ambiguous, use "likely_scam".
- If benign/unclear, use "not_scam".

Output JSON only:
{
  "verdict": "not_scam" | "likely_scam" | "certain_scam",
  "confidence": "low" | "medium" | "high",
  "explanation": "short plain-language rationale",
  "evidence": ["short concrete signal", "..."]
}`;

export function getCommentScamEvalModel(): string {
  return process.env.OPENAI_COMMENT_EVAL_MODEL ?? process.env.OPENAI_EVAL_MODEL ?? "gpt-5-mini";
}

export function assembleCommentScamEvalUserMessage(args: {
  commentId: string;
  skillId: string;
  userId: string;
  body: string;
}): string {
  const trimmed = args.body.trim();
  const body =
    trimmed.length > MAX_COMMENT_CHARS
      ? `${trimmed.slice(0, MAX_COMMENT_CHARS)}\n…[truncated]`
      : trimmed;

  return [
    `Comment ID: ${args.commentId}`,
    `Skill ID: ${args.skillId}`,
    `Author User ID: ${args.userId}`,
    "Comment body:",
    "```",
    body,
    "```",
    "Respond with a single JSON object.",
  ].join("\n");
}

function stripCodeFence(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("```")) return text;
  const firstNewline = text.indexOf("\n");
  if (firstNewline === -1) return text;
  const withoutOpening = text.slice(firstNewline + 1);
  const lastFence = withoutOpening.lastIndexOf("```");
  if (lastFence === -1) return withoutOpening.trim();
  return withoutOpening.slice(0, lastFence).trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  return `${value.slice(0, max - 3)}...`;
}

export function parseCommentScamEvalResponse(raw: string): CommentScamEvalResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const verdict =
    typeof obj.verdict === "string" ? (obj.verdict.toLowerCase() as CommentScamVerdict) : null;
  if (!verdict || !VALID_VERDICTS.has(verdict)) return null;

  const confidence =
    typeof obj.confidence === "string"
      ? (obj.confidence.toLowerCase() as CommentScamConfidence)
      : null;
  if (!confidence || !VALID_CONFIDENCES.has(confidence)) return null;

  const rawExplanation = typeof obj.explanation === "string" ? obj.explanation.trim() : "";
  if (!rawExplanation) return null;

  const rawEvidence = Array.isArray(obj.evidence) ? obj.evidence : [];
  const evidence = rawEvidence
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((item) => truncate(item, MAX_EVIDENCE_ITEM_CHARS));

  return {
    verdict,
    confidence,
    explanation: truncate(rawExplanation, MAX_EXPLANATION_CHARS),
    evidence,
  };
}

export function isCertainScam(result: {
  verdict: CommentScamVerdict;
  confidence: CommentScamConfidence;
}): boolean {
  return result.verdict === "certain_scam" && result.confidence === "high";
}

export function buildCommentScamBanReason(args: {
  commentId: string;
  skillId: string;
  explanation: string;
  evidence: string[];
}): string {
  const explanation = args.explanation.trim();
  const evidence = args.evidence
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  const suffix = ` commentId=${args.commentId} skillId=${args.skillId}`;
  const evidenceSegment = evidence.length > 0 ? ` evidence: ${evidence.join("; ")}.` : "";
  const core = `comment scam auto-ban. ${explanation}.${evidenceSegment}`;
  const maxCoreChars = Math.max(0, MAX_BAN_REASON_CHARS - suffix.length);
  return `${truncate(core, maxCoreChars)}${suffix}`;
}
