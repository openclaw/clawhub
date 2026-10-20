import type { ClawManifest } from "clawhub-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationReasoning } from "./applicationModelPolicy";
import { __test as changelog } from "./changelog";
import { classifyClawCategories } from "./clawCategoryClassification";
import { classifyPluginCategories } from "./pluginCategoryClassification";
import { classifySearchIntent } from "./searchIntentClassifier";
import { generateSkillSummary } from "./skillSummary";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const cases = [
  {
    name: "summary",
    effort: "low",
    override: "OPENAI_SKILL_SUMMARY_MODEL",
    output: "Writes friendly greetings.",
    run: () =>
      generateSkillSummary({
        slug: "greeting",
        displayName: "Greeting",
        readmeText: "# Greeting\nWrite friendly greetings.",
      }),
  },
  {
    name: "changelog",
    effort: "low",
    override: "OPENAI_CHANGELOG_MODEL",
    output: "- Added friendly greetings.",
    run: () =>
      changelog.generateWithOpenAI({
        slug: "greeting",
        version: "1.0.0",
        oldReadme: null,
        nextReadme: "Write friendly greetings.",
        fileDiff: null,
      }),
  },
  {
    name: "plugin category",
    effort: "none",
    override: "OPENAI_PLUGIN_CATEGORY_MODEL",
    output: '{"categories":["developer-tools"],"evidence":"Reviews code."}',
    run: () =>
      classifyPluginCategories({ name: "code-review", documentation: "Reviews source code." }),
  },
  {
    name: "Claw category",
    effort: "none",
    override: "OPENAI_CLAW_CATEGORY_MODEL",
    output: '{"categories":["travel"]}',
    run: () =>
      classifyClawCategories({
        name: "trip-planner",
        manifest: {
          schemaVersion: 1,
          agent: { id: "trip-planner", name: "Trip planner", description: "Plan trips." },
        } as ClawManifest,
      }),
  },
  {
    name: "search intent",
    effort: "none",
    output:
      '{"rows":[{"query":"greetings","intentKind":"generic_capability","companyProductName":null,"confidence":0.9}]}',
    run: () =>
      classifySearchIntent(
        [{ query: "greetings", searches: 3, officialGaps: 3, topResults: [] }],
        "fixture-key",
      ),
  },
];

describe("application model request policy", () => {
  it.each(cases)("sends Luna $effort Standard for $name through Responses", async (sample) => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    const fetch = vi.fn(async () =>
      Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: sample.output }] }],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await sample.run();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    if (typeof init.body !== "string") throw new Error("Expected JSON request");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      reasoning: { effort: sample.effort },
      service_tier: "default",
    });
    if (sample.effort === "low") expect(body.max_output_tokens).toBeGreaterThanOrEqual(2_048);
  });
  it.each(
    cases
      .filter((sample) => sample.override)
      .flatMap((sample) =>
        ["gpt-6-luna-override", "gpt-5", "gpt-4.1"].map((model) => ({ ...sample, model })),
      ),
  )("preserves explicit $name $model overrides", async (sample) => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    vi.stubEnv(sample.override!, sample.model);
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected JSON request");
      body = JSON.parse(init.body);
      return Response.json({ output: [] });
    });
    await sample.run();
    expect(body.model).toBe(sample.model);
    if (sample.model === "gpt-5" || sample.model === "gpt-4.1")
      expect(body).not.toHaveProperty("reasoning");
  });
});

it("keeps pre-reasoning overrides usable and respects Sol's minimum effort", () => {
  expect(applicationReasoning("gpt-4.1-mini", "low")).toBeUndefined();
  expect(applicationReasoning("gpt-4.1", "none")).toBeUndefined();
  expect(applicationReasoning("gpt-6.1-sol", "none")).toEqual({ effort: "low" });
  expect(applicationReasoning("gpt-6-luna", "none")).toEqual({ effort: "none" });
  expect(applicationReasoning("gpt-5", "none")).toBeUndefined();
  expect(applicationReasoning("o3", "none")).toBeUndefined();
});
