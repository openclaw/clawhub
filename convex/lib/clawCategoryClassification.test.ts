import type { ClawManifest } from "clawhub-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyClawCategories } from "./clawCategoryClassification";

const manifest: ClawManifest = {
  schemaVersion: 1,
  agent: { id: "travel-planner", name: "Travel planner", description: "Plan a trip." },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("classifyClawCategories", () => {
  it("uses valid manifest declarations without calling the model", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await classifyClawCategories({
        name: "@openclaw/travel-planner",
        manifest: { ...manifest, categories: ["travel", "personal"] },
      }),
    ).toEqual(["travel", "personal"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a made-up category rather than silently reclassifying it", async () => {
    await expect(
      classifyClawCategories({
        name: "@openclaw/travel-planner",
        manifest: { ...manifest, categories: ["made-up"] },
      }),
    ).rejects.toThrow("current ClawHub taxonomy");
  });

  it("falls back to Other when the model is unavailable", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await classifyClawCategories({ name: "travel-planner", manifest })).toEqual(["other"]);
  });

  it("classifies undeclared categories with the fixed taxonomy", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"categories":["travel","personal"]}' }],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    expect(await classifyClawCategories({ name: "travel-planner", manifest })).toEqual([
      "travel",
      "personal",
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
