/* @vitest-environment node */
import { describe, expect, it } from "vitest";

const { retiredLlmEvalHandler } = await import("./llmEval");

describe("LLM eval drain", () => {
  it("keeps legacy scheduled jobs harmless after the evaluator is retired", async () => {
    await expect(retiredLlmEvalHandler()).resolves.toEqual({
      ok: true,
      retired: true,
    });
  });
});
