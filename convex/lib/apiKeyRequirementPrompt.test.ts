/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  API_KEY_REQUIREMENT_MAX_OUTPUT_TOKENS,
  API_KEY_REQUIREMENT_SYSTEM_PROMPT,
  assembleApiKeyRequirementUserMessage,
  getApiKeyRequirementModel,
  parseApiKeyRequirementResponse,
  toApiKeyRequiredBoolean,
} from "./apiKeyRequirementPrompt";

describe("apiKeyRequirementPrompt", () => {
  describe("constants and config", () => {
    it("exposes a sane output-token budget", () => {
      expect(API_KEY_REQUIREMENT_MAX_OUTPUT_TOKENS).toBe(600);
    });

    it("system prompt fixes the JSON-only output schema", () => {
      expect(API_KEY_REQUIREMENT_SYSTEM_PROMPT).toContain('"status"');
      expect(API_KEY_REQUIREMENT_SYSTEM_PROMPT).toContain('"envVars"');
      expect(API_KEY_REQUIREMENT_SYSTEM_PROMPT).toContain("QUOTED SOURCE MATERIAL");
    });

    it("model resolution prefers the dedicated env over the generic one", () => {
      const before = {
        dedicated: process.env.OPENAI_API_KEY_EVAL_MODEL,
        generic: process.env.OPENAI_EVAL_MODEL,
      };
      try {
        delete process.env.OPENAI_API_KEY_EVAL_MODEL;
        delete process.env.OPENAI_EVAL_MODEL;
        expect(getApiKeyRequirementModel()).toBe("gpt-4.1-mini");

        process.env.OPENAI_EVAL_MODEL = "fallback-model";
        expect(getApiKeyRequirementModel()).toBe("fallback-model");

        process.env.OPENAI_API_KEY_EVAL_MODEL = "preferred-model";
        expect(getApiKeyRequirementModel()).toBe("preferred-model");
      } finally {
        if (before.dedicated === undefined) {
          delete process.env.OPENAI_API_KEY_EVAL_MODEL;
        } else {
          process.env.OPENAI_API_KEY_EVAL_MODEL = before.dedicated;
        }
        if (before.generic === undefined) {
          delete process.env.OPENAI_EVAL_MODEL;
        } else {
          process.env.OPENAI_EVAL_MODEL = before.generic;
        }
      }
    });
  });

  describe("assembleApiKeyRequirementUserMessage", () => {
    it("packs frontmatter, file manifest and fenced SKILL.md", () => {
      const message = assembleApiKeyRequirementUserMessage({
        slug: "stripe-helper",
        skillMd: "---\nname: stripe-helper\n---\n# Stripe helper\n",
        requiresEnv: ["STRIPE_API_KEY"],
        primaryEnv: "STRIPE_API_KEY",
        envVars: [
          { name: "STRIPE_API_KEY", required: true, description: "Live secret key" },
          { name: "STRIPE_WEBHOOK_SECRET", required: false },
        ],
        filePaths: ["SKILL.md", "scripts/charge.ts"],
      });

      expect(message).toContain("Skill slug: stripe-helper");
      expect(message).toContain("STRIPE_API_KEY (required)");
      expect(message).toContain("STRIPE_WEBHOOK_SECRET (optional)");
      expect(message).toContain("Frontmatter — primaryEnv: STRIPE_API_KEY");
      expect(message).toContain("- SKILL.md");
      expect(message).toContain("- scripts/charge.ts");
      expect(message).toContain("```markdown");
      expect(message).toContain("# Stripe helper");
    });

    it("renders sensible placeholders when frontmatter / files are missing", () => {
      const message = assembleApiKeyRequirementUserMessage({
        slug: "local-only",
        skillMd: "Local skill, no secrets.",
      });

      expect(message).toContain("Frontmatter — requires.env:\n(none)");
      expect(message).toContain("Frontmatter — primaryEnv: (none)");
      expect(message).toContain("Frontmatter — envVars:\n(none declared)");
      expect(message).toContain("File manifest (paths only):\n(no files)");
    });

    it("truncates an oversize SKILL.md and marks the truncation", () => {
      const huge = "x".repeat(20_000);
      const message = assembleApiKeyRequirementUserMessage({
        slug: "huge",
        skillMd: huge,
      });

      expect(message).toContain("…[truncated]");
      // ensure we did NOT emit the full 20k payload
      expect(message.length).toBeLessThan(huge.length);
    });
  });

  describe("parseApiKeyRequirementResponse", () => {
    it("parses a clean JSON response", () => {
      const parsed = parseApiKeyRequirementResponse(
        JSON.stringify({
          status: "required",
          rationale: "Skill needs STRIPE_API_KEY to make live charges.",
          envVars: ["STRIPE_API_KEY"],
        }),
      );

      expect(parsed).toEqual({
        status: "required",
        rationale: "Skill needs STRIPE_API_KEY to make live charges.",
        envVars: ["STRIPE_API_KEY"],
      });
    });

    it("strips ```json fences before parsing", () => {
      const parsed = parseApiKeyRequirementResponse(
        "```json\n" +
          JSON.stringify({
            status: "not_required",
            rationale: "Pure local utility.",
            envVars: [],
          }) +
          "\n```",
      );

      expect(parsed).toMatchObject({
        status: "not_required",
        rationale: "Pure local utility.",
        envVars: [],
      });
    });

    it("returns null on invalid JSON", () => {
      expect(parseApiKeyRequirementResponse("not-json")).toBeNull();
    });

    it("rejects responses missing required fields", () => {
      expect(parseApiKeyRequirementResponse('{"status":"required"}')).toBeNull();
      expect(
        parseApiKeyRequirementResponse(
          JSON.stringify({ rationale: "no status field", envVars: [] }),
        ),
      ).toBeNull();
      expect(
        parseApiKeyRequirementResponse(
          JSON.stringify({ status: "required", rationale: "  ", envVars: [] }),
        ),
      ).toBeNull();
    });

    it("rejects responses with a non-whitelisted status", () => {
      expect(
        parseApiKeyRequirementResponse(
          JSON.stringify({
            status: "definitely_yes",
            rationale: "model improvised a status",
            envVars: [],
          }),
        ),
      ).toBeNull();
    });

    it("clips oversize envVars arrays and drops invalid names", () => {
      const parsed = parseApiKeyRequirementResponse(
        JSON.stringify({
          status: "required",
          rationale: "many envs",
          envVars: [
            "VALID_KEY_1",
            "VALID_KEY_2",
            "VALID_KEY_3",
            "VALID_KEY_4",
            "VALID_KEY_5",
            "VALID_KEY_6",
            "VALID_KEY_7",
            "VALID_KEY_8",
            "VALID_KEY_9", // beyond MAX_ENV_VAR_ITEMS=8
            "lower_case_should_drop",
            "1_LEADING_DIGIT",
            "BAD-CHAR",
            "VALID_KEY_1", // duplicate
            "",
          ],
        }),
      );

      expect(parsed?.envVars).toEqual([
        "VALID_KEY_1",
        "VALID_KEY_2",
        "VALID_KEY_3",
        "VALID_KEY_4",
        "VALID_KEY_5",
        "VALID_KEY_6",
        "VALID_KEY_7",
        "VALID_KEY_8",
      ]);
    });

    it("forces envVars empty when status is not_required or unknown", () => {
      const notRequired = parseApiKeyRequirementResponse(
        JSON.stringify({
          status: "not_required",
          rationale: "Local only.",
          envVars: ["SOMETHING_LEAKED"],
        }),
      );
      expect(notRequired?.envVars).toEqual([]);

      const unknown = parseApiKeyRequirementResponse(
        JSON.stringify({
          status: "unknown",
          rationale: "Cannot tell.",
          envVars: ["MAYBE_KEY"],
        }),
      );
      expect(unknown?.envVars).toEqual([]);
    });

    it("truncates an oversize rationale", () => {
      const parsed = parseApiKeyRequirementResponse(
        JSON.stringify({
          status: "required",
          rationale: "A".repeat(2000),
          envVars: ["FOO"],
        }),
      );

      expect(parsed?.rationale.length).toBeLessThanOrEqual(600);
      expect(parsed?.rationale.endsWith("...")).toBe(true);
    });
  });

  describe("toApiKeyRequiredBoolean", () => {
    it("maps the tri-state correctly", () => {
      expect(
        toApiKeyRequiredBoolean({
          status: "required",
          rationale: "x",
          envVars: ["X"],
        }),
      ).toBe(true);

      expect(
        toApiKeyRequiredBoolean({
          status: "not_required",
          rationale: "x",
          envVars: [],
        }),
      ).toBe(false);

      expect(
        toApiKeyRequiredBoolean({
          status: "unknown",
          rationale: "x",
          envVars: [],
        }),
      ).toBeUndefined();

      expect(toApiKeyRequiredBoolean(null)).toBeUndefined();
    });
  });
});
