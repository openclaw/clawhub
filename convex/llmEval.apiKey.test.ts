/* @vitest-environment node */

// ---------------------------------------------------------------------------
// Mock unit tests for the api-key-required evaluator (`evaluateApiKeyRequirement`).
//
// Scope: every decision branch in the evaluator —
//   Short-circuit A (frontmatter signal):
//     - shortcut_required
//   Short-circuit B (no sensitive keywords anywhere):
//     - shortcut_not_required
//   Storage gate:
//     - no_skill_md
//   LLM fallback (OpenAI fetch is mocked):
//     - llm_required
//     - llm_not_required
//     - llm_unknown
//     - llm_error (HTTP 500 fallthrough)
//     - llm_error (unparseable response body)
//     - llm_disabled (OPENAI_API_KEY unset, no fetch — environment opt-out,
//       distinct from `llm_error` so dashboards can separate "configuration
//       absent" from a genuine model failure)
//
// Each test crafts the minimum SkillVersion / Skill / SKILL.md needed to
// land in the target branch. The OpenAI HTTP call is replaced with a vi.fn()
// returning a hand-crafted `output[0].content[0].text` payload — exactly the
// shape `extractResponseText` knows how to read.
//
// This file is the long-lived regression net for the evaluator. It replaces
// the disposable `apieval-fixture-*` end-to-end probes that lived in
// `devSeedApiKeyFixtures.ts` / `devRunApiKeyEvalFixtures.ts`.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateApiKeyRequirement } from "./llmEval";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type ApiKeyEvalDecision =
  | "shortcut_required"
  | "shortcut_not_required"
  | "llm_required"
  | "llm_not_required"
  | "llm_unknown"
  | "llm_error"
  | "llm_disabled"
  | "no_skill_md";

type ApiKeyEvalResult = {
  ok: boolean;
  decision: ApiKeyEvalDecision;
  apiKeyRequired?: boolean;
  rationale?: string;
  envVars?: string[];
  model?: string;
  error?: string;
};

const evaluateApiKeyRequirementHandler = (
  evaluateApiKeyRequirement as unknown as WrappedHandler<{ versionId: string }, ApiKeyEvalResult>
)._handler;

// ---------------------------------------------------------------------------
// Test fixtures: a single LLM-bound skill version + matching skill record.
// The SKILL.md says "API key", so short-circuit B (no sensitive keywords) is
// skipped. The frontmatter declares no requires/primaryEnv/envVars[*].required,
// so short-circuit A (frontmatter signal) is also skipped. Result: the
// evaluator MUST call the LLM, which is exactly what we want to assert here.
// ---------------------------------------------------------------------------

const VERSION_ID = "skillVersions:llm-fixture";
const SKILL_ID = "skills:llm-fixture";

const SKILL_MD_CONTENT =
  "# Demo Skill\n\nUses an external API key to authenticate with a third party.\n";

type SkillVersionOverrides = {
  parsed?: unknown;
  files?: Array<{
    path: string;
    size: number;
    storageId: string;
    sha256: string;
    contentType: string;
  }>;
};

function makeSkillVersion(overrides: SkillVersionOverrides = {}) {
  return {
    _id: VERSION_ID,
    skillId: SKILL_ID,
    version: "1.0.0",
    createdAt: Date.UTC(2026, 0, 1),
    files: overrides.files ?? [
      {
        path: "SKILL.md",
        size: SKILL_MD_CONTENT.length,
        storageId: "_storage:skill-md",
        sha256: "a".repeat(64),
        contentType: "text/markdown",
      },
    ],
    parsed: overrides.parsed ?? {
      // No requires.env / primaryEnv / envVars[*].required → short-circuit A
      // is skipped, forcing the LLM call.
      frontmatter: { name: "llm-fixture", description: "LLM-bound fixture." },
    },
  };
}

function makeSkill() {
  return {
    _id: SKILL_ID,
    slug: "llm-fixture",
    displayName: "LLM Fixture",
    ownerUserId: "users:owner",
    summary: "Fixture for LLM tri-state coverage.",
  };
}

// ---------------------------------------------------------------------------
// Test ctx: minimal stub that satisfies the four ctx surfaces used by
// `evaluateApiKeyRequirement` — runQuery, runMutation, storage.get.
// ---------------------------------------------------------------------------

type CtxOverrides = {
  skillMd?: string | null;
  versionOverrides?: SkillVersionOverrides;
};

function makeEvalCtx(overrides: CtxOverrides = {}) {
  const skillMd = overrides.skillMd === undefined ? SKILL_MD_CONTENT : overrides.skillMd;
  const runMutation = vi.fn(async () => undefined);
  const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
    if (args.versionId === VERSION_ID) return makeSkillVersion(overrides.versionOverrides);
    if (args.skillId === SKILL_ID) return makeSkill();
    throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
  });
  const storageGet = vi.fn(async () => (skillMd === null ? null : new Blob([skillMd])));

  return {
    ctx: {
      runQuery,
      runMutation,
      storage: { get: storageGet },
    },
    runQuery,
    runMutation,
    storageGet,
  };
}

// ---------------------------------------------------------------------------
// OpenAI HTTP mocks. The evaluator goes through `fetch` in
// `callApiKeyRequirementLlm`, parses the response with `extractResponseText`,
// then runs the body through `parseApiKeyRequirementResponse`. So to drive a
// specific tri-state we just stuff the desired JSON object into
// `output[0].content[0].text`.
// ---------------------------------------------------------------------------

function mockOpenAiResponse(body: unknown) {
  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(body) }],
          },
        ],
      }),
      { status: 200 },
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mockOpenAiRawText(text: string) {
  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text }],
          },
        ],
      }),
      { status: 200 },
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mockOpenAiHttpError(status: number, body = "internal error") {
  // Always returns >=500 → evaluator's retry loop will exhaust 4 attempts
  // (initial + 3 retries) and surface an llm_error decision.
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalOpenAiApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateApiKeyRequirement — LLM tri-state branches", () => {
  it("decision=llm_required when LLM says status=required and patches apiKeyRequired=true", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    mockOpenAiResponse({
      status: "required",
      rationale: "The skill calls an external API.",
      envVars: ["DEMO_API_KEY"],
    });
    const { ctx, runMutation } = makeEvalCtx();

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("llm_required");
    expect(result.apiKeyRequired).toBe(true);
    expect(result.envVars).toEqual(["DEMO_API_KEY"]);
    expect(result.rationale).toBe("The skill calls an external API.");
    expect(runMutation).toHaveBeenCalledTimes(1);
    const patchArgs = runMutation.mock.calls[0]?.[1] as {
      versionId: string;
      apiKeyRequired: boolean;
    };
    expect(patchArgs).toEqual({ versionId: VERSION_ID, apiKeyRequired: true });
  });

  it("decision=llm_not_required when LLM says status=not_required and patches apiKeyRequired=false", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    mockOpenAiResponse({
      status: "not_required",
      rationale: "Runs entirely offline; the keyword reference is decorative.",
      envVars: [],
    });
    const { ctx, runMutation } = makeEvalCtx();

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("llm_not_required");
    expect(result.apiKeyRequired).toBe(false);
    expect(result.envVars).toEqual([]);
    expect(runMutation).toHaveBeenCalledTimes(1);
    const patchArgs = runMutation.mock.calls[0]?.[1] as {
      versionId: string;
      apiKeyRequired: boolean;
    };
    expect(patchArgs).toEqual({ versionId: VERSION_ID, apiKeyRequired: false });
  });

  it("decision=llm_unknown when LLM says status=unknown and leaves apiKeyRequired untouched", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    mockOpenAiResponse({
      status: "unknown",
      rationale: "Cannot tell from the SKILL.md whether the key is mandatory.",
      envVars: [],
    });
    const { ctx, runMutation } = makeEvalCtx();

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("llm_unknown");
    expect(result.apiKeyRequired).toBeUndefined();
    expect(result.envVars).toEqual([]);
    // The "unknown" branch must NOT write to the DB. This is the schema
    // contract: leave the boolean field unset rather than coerce a guess.
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("decision=llm_error when OpenAI returns HTTP 500 (after retry exhaustion)", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const fetchMock = mockOpenAiHttpError(500, "kaboom");
    const { ctx, runMutation } = makeEvalCtx();

    // The evaluator's retry loop sleeps 2s/4s/8s between attempts. Stub
    // setTimeout so those sleeps fire immediately — keeps the test under
    // 100ms instead of ~14s real wall time.
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutStub = ((cb: (...args: unknown[]) => void) => {
      cb();
      // The evaluator only ever awaits the returned promise, so the actual
      // timer handle is irrelevant — return any object to satisfy the type.
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.setTimeout = setTimeoutStub;
    try {
      const result = await evaluateApiKeyRequirementHandler(ctx, {
        versionId: VERSION_ID,
      });

      expect(result.ok).toBe(false);
      expect(result.decision).toBe("llm_error");
      expect(result.apiKeyRequired).toBeUndefined();
      expect(result.error).toMatch(/OpenAI API error \(500\)/);
      expect(runMutation).not.toHaveBeenCalled();
      // The retry loop fires 4 times total (initial + 3 retries) on >=500.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it("decision=llm_error when OpenAI returns an unparseable text body", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    mockOpenAiRawText("this is definitely not valid json");
    const { ctx, runMutation } = makeEvalCtx();

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(false);
    expect(result.decision).toBe("llm_error");
    expect(result.error).toBe("Failed to parse LLM response");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("decision=llm_disabled early-returns when OPENAI_API_KEY is unset (no fetch attempted)", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { ctx, runMutation } = makeEvalCtx();

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(false);
    expect(result.decision).toBe("llm_disabled");
    expect(result.error).toBe("OPENAI_API_KEY not configured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("evaluateApiKeyRequirement — deterministic short-circuit branches", () => {
  it("decision=shortcut_required when frontmatter declares requires.env (no LLM call)", async () => {
    // Trip short-circuit A via the canonical post-parse path:
    // parsed.clawdis.requires.env. `hasRequiredEnvSignal` returns true and
    // the evaluator must patch apiKeyRequired=true without ever calling fetch.
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { ctx, runMutation } = makeEvalCtx({
      versionOverrides: {
        parsed: {
          frontmatter: { name: "shortcut-required-fixture" },
          clawdis: { requires: { env: ["DEMO_API_KEY"] } },
        },
      },
    });

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("shortcut_required");
    expect(result.apiKeyRequired).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const patchArgs = runMutation.mock.calls[0]?.[1] as {
      versionId: string;
      apiKeyRequired: boolean;
    };
    expect(patchArgs).toEqual({ versionId: VERSION_ID, apiKeyRequired: true });
  });

  it("decision=shortcut_not_required when SKILL.md and file paths mention no sensitive keywords (no LLM call)", async () => {
    // Trip short-circuit B by removing every sensitive keyword from both
    // SKILL.md and the file manifest. The evaluator must patch
    // apiKeyRequired=false without ever calling fetch.
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const innocuousMd = "# Reverse Strings\n\nReverses inputs. Pure offline utility.\n";
    const { ctx, runMutation } = makeEvalCtx({
      skillMd: innocuousMd,
      versionOverrides: {
        files: [
          {
            path: "SKILL.md",
            size: innocuousMd.length,
            storageId: "_storage:skill-md",
            sha256: "a".repeat(64),
            contentType: "text/markdown",
          },
          {
            path: "scripts/reverse.sh",
            size: 16,
            storageId: "_storage:reverse",
            sha256: "b".repeat(64),
            contentType: "text/x-shellscript",
          },
        ],
        parsed: {
          frontmatter: { name: "shortcut-not-required-fixture" },
        },
      },
    });

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("shortcut_not_required");
    expect(result.apiKeyRequired).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const patchArgs = runMutation.mock.calls[0]?.[1] as {
      versionId: string;
      apiKeyRequired: boolean;
    };
    expect(patchArgs).toEqual({ versionId: VERSION_ID, apiKeyRequired: false });
  });

  it("decision=no_skill_md when version files contain no SKILL.md (no LLM call, no DB write)", async () => {
    // Drop SKILL.md from the manifest entirely. The evaluator must early-return
    // with no_skill_md before reaching any short-circuit, LLM call, or mutation.
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { ctx, runMutation, storageGet } = makeEvalCtx({
      versionOverrides: {
        files: [
          {
            path: "README.md",
            size: 32,
            storageId: "_storage:readme",
            sha256: "c".repeat(64),
            contentType: "text/markdown",
          },
        ],
      },
    });

    const result = await evaluateApiKeyRequirementHandler(ctx, { versionId: VERSION_ID });

    expect(result.ok).toBe(false);
    expect(result.decision).toBe("no_skill_md");
    expect(result.error).toBe("No SKILL.md content");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    // Without a SKILL.md entry the evaluator never asks storage for content.
    expect(storageGet).not.toHaveBeenCalled();
  });
});
