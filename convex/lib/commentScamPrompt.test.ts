/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  assembleCommentScamEvalUserMessage,
  buildCommentScamBanReason,
  isCertainScam,
  parseCommentScamEvalResponse,
} from "./commentScamPrompt";

describe("commentScamPrompt", () => {
  it("parses valid JSON response", () => {
    const parsed = parseCommentScamEvalResponse(
      JSON.stringify({
        verdict: "certain_scam",
        confidence: "high",
        explanation: "Comment instructs users to decode base64 and pipe to bash.",
        evidence: ["echo + base64 -D | bash", "fake update-service domain"],
      }),
    );

    expect(parsed).toEqual({
      verdict: "certain_scam",
      confidence: "high",
      explanation: "Comment instructs users to decode base64 and pipe to bash.",
      evidence: ["echo + base64 -D | bash", "fake update-service domain"],
    });
  });

  it("parses markdown-fenced JSON", () => {
    const parsed = parseCommentScamEvalResponse(`\`\`\`json
{"verdict":"likely_scam","confidence":"medium","explanation":"Suspicious terminal one-liner.","evidence":["curl | bash"]}
\`\`\``);

    expect(parsed).toMatchObject({
      verdict: "likely_scam",
      confidence: "medium",
    });
  });

  it("rejects invalid response payloads", () => {
    expect(parseCommentScamEvalResponse('{"verdict":"ban"}')).toBeNull();
    expect(parseCommentScamEvalResponse("not-json")).toBeNull();
  });

  it("builds bounded ban reason", () => {
    const reason = buildCommentScamBanReason({
      commentId: "comments:1",
      skillId: "skills:1",
      explanation: "A".repeat(700),
      evidence: ["B".repeat(300), "C".repeat(300), "D".repeat(300), "E".repeat(300)],
    });

    expect(reason.length).toBeLessThanOrEqual(500);
    expect(reason).toContain("commentId=comments:1");
    expect(reason).toContain("skillId=skills:1");
  });

  it("marks certainty only for high-confidence certain_scam", () => {
    expect(isCertainScam({ verdict: "certain_scam", confidence: "high" })).toBe(true);
    expect(isCertainScam({ verdict: "certain_scam", confidence: "medium" })).toBe(false);
    expect(isCertainScam({ verdict: "likely_scam", confidence: "high" })).toBe(false);
  });

  it("builds compact user message with context", () => {
    const message = assembleCommentScamEvalUserMessage({
      commentId: "comments:1",
      skillId: "skills:3",
      userId: "users:9",
      body: " test ",
    });

    expect(message).toContain("Comment ID: comments:1");
    expect(message).toContain("Skill ID: skills:3");
    expect(message).toContain("Author User ID: users:9");
    expect(message).toContain("test");
  });
});
