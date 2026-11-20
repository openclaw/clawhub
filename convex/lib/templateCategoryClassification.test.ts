/* @vitest-environment node */

import type { TemplateManifest } from "clawhub-schema";
import { TEMPLATE_CATEGORY_DEFINITIONS } from "clawhub-schema/catalogMetadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyTemplateCategories } from "./templateCategoryClassification";

const manifest: TemplateManifest = {
  schemaVersion: 1,
  agent: { id: "travel-planner", name: "Travel planner", description: "Plan a trip." },
};

function modelAnswering(text: string) {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
    }),
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("classifyTemplateCategories", () => {
  it.each([
    { declared: ["travel"], expected: ["travel"] },
    { declared: ["engineering", "operations"], expected: ["engineering"] },
    { declared: ["travel", "personal"], expected: ["travel"] },
    { declared: ["household", "made-up", "other"], expected: ["household"] },
  ])(
    "uses the first declared category of $declared without calling the model",
    async ({ declared, expected }) => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect(
        await classifyTemplateCategories({
          name: "@openclaw/travel-planner",
          manifest: { ...manifest, categories: declared },
        }),
      ).toEqual(expected);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { declared: ["personal", "productivity"] },
    { declared: ["governance"] },
    { declared: ["finance", "sales"] },
    { declared: ["people"] },
    { declared: ["made-up", "travel"] },
    { declared: ["other"] },
    { declared: [] },
    { declared: undefined },
  ])(
    "classifies instead of rejecting or using a later category when $declared comes first",
    async ({ declared }) => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      const fetch = modelAnswering('{"category":"household"}');
      expect(
        await classifyTemplateCategories({
          name: "meal-planner",
          manifest: { ...manifest, categories: declared },
        }),
      ).toEqual(["household"]);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { declared: ["personal", "productivity"] },
    { declared: ["made-up"] },
    { declared: undefined },
  ])("falls back to Other for $declared when the model is unavailable", async ({ declared }) => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await classifyTemplateCategories({
        name: "travel-planner",
        manifest: { ...manifest, categories: declared },
      }),
    ).toEqual(["other"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to Other when the model request fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await classifyTemplateCategories({ name: "travel-planner", manifest })).toEqual([
      "other",
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await classifyTemplateCategories({ name: "travel-planner", manifest })).toEqual([
      "other",
    ]);
  });

  it.each([
    '{"category":"personal"}',
    '{"category":"made-up"}',
    '{"category":"other"}',
    '{"category":["travel"]}',
    '{"categories":["travel","household"]}',
    "not json",
  ])("falls back to Other when the model answers %s", async (text) => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    modelAnswering(text);
    expect(await classifyTemplateCategories({ name: "travel-planner", manifest })).toEqual([
      "other",
    ]);
  });

  it("asks the model for exactly one category from the current taxonomy", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetch = modelAnswering('{"category":"travel"}');
    expect(await classifyTemplateCategories({ name: "travel-planner", manifest })).toEqual([
      "travel",
    ]);
    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string);
    const current = TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug }) => slug);
    expect(body.text.format.schema.properties.category).toEqual({ type: "string", enum: current });
    expect(body.text.format.schema.required).toEqual(["category"]);
    for (const { slug, description } of TEMPLATE_CATEGORY_DEFINITIONS) {
      expect(body.instructions).toContain(`${slug}: ${description}`);
    }
    // Removed categories and the internal bucket are never offered to the model.
    for (const slug of ["personal", "governance", "finance", "people", "other"]) {
      expect(current).not.toContain(slug);
      expect(body.instructions).not.toMatch(new RegExp(`^${slug}:`, "m"));
    }
  });
});
