/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  type EnvVarDeclaration,
  extractEnvVarDeclarations,
  extractPrimaryEnvName,
  extractRequiresEnvList,
  hasRequiredEnvSignal,
} from "./parsedEnvSignals";

describe("parsedEnvSignals", () => {
  describe("extractRequiresEnvList", () => {
    it("returns [] for non-record / null / undefined inputs", () => {
      expect(extractRequiresEnvList(null)).toEqual([]);
      expect(extractRequiresEnvList(undefined)).toEqual([]);
      expect(extractRequiresEnvList("string")).toEqual([]);
      expect(extractRequiresEnvList([1, 2, 3])).toEqual([]);
    });

    it("reads parsed.clawdis.requires.env (canonical post-parse path)", () => {
      const parsed = {
        clawdis: { requires: { env: ["STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET"] } },
      };
      expect(extractRequiresEnvList(parsed)).toEqual(["STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET"]);
    });

    it("reads parsed.metadata.clawdbot.config.requiredEnv (mongo-shell style)", () => {
      const parsed = {
        frontmatter: { name: "mongo-shell" },
        metadata: {
          clawdbot: {
            config: { requiredEnv: ["MONGODB_URI"] },
          },
        },
      };
      expect(extractRequiresEnvList(parsed)).toEqual(["MONGODB_URI"]);
    });

    it("reads parsed.metadata.<ns>.requires.env across all three namespaces", () => {
      for (const ns of ["clawdbot", "clawdis", "openclaw"] as const) {
        const parsed = {
          metadata: { [ns]: { requires: { env: [`${ns.toUpperCase()}_KEY`] } } },
        };
        expect(extractRequiresEnvList(parsed)).toEqual([`${ns.toUpperCase()}_KEY`]);
      }
    });

    it("reads top-level frontmatter.requires.env (#522 fallback)", () => {
      const parsed = {
        frontmatter: { requires: { env: ["FALLBACK_TOKEN"] } },
      };
      expect(extractRequiresEnvList(parsed)).toEqual(["FALLBACK_TOKEN"]);
    });

    it("merges and deduplicates across multiple sources", () => {
      const parsed = {
        clawdis: { requires: { env: ["A", "B"] } },
        metadata: {
          clawdbot: { config: { requiredEnv: ["B", "C"] } },
        },
        frontmatter: { requires: { env: ["A", "D"] } },
      };
      expect(extractRequiresEnvList(parsed)).toEqual(["A", "B", "C", "D"]);
    });

    it("ignores empty / whitespace / non-string entries", () => {
      const parsed = {
        clawdis: { requires: { env: ["VALID", "  ", 123, "VALID", null, " TRIMMED "] } },
      };
      expect(extractRequiresEnvList(parsed)).toEqual(["VALID", "TRIMMED"]);
    });
  });

  describe("extractPrimaryEnvName", () => {
    it("returns undefined for empty / non-record inputs", () => {
      expect(extractPrimaryEnvName(null)).toBeUndefined();
      expect(extractPrimaryEnvName({})).toBeUndefined();
      expect(extractPrimaryEnvName({ primaryEnv: "" })).toBeUndefined();
      expect(extractPrimaryEnvName({ primaryEnv: "   " })).toBeUndefined();
    });

    it("prefers parsed.primaryEnv over fallbacks", () => {
      const parsed = {
        primaryEnv: "DIRECT",
        clawdis: { primaryEnv: "FROM_CLAWDIS" },
        metadata: { clawdbot: { primaryEnv: "FROM_METADATA" } },
        frontmatter: { primaryEnv: "FROM_FRONTMATTER" },
      };
      expect(extractPrimaryEnvName(parsed)).toBe("DIRECT");
    });

    it("falls back to clawdis.primaryEnv", () => {
      const parsed = {
        clawdis: { primaryEnv: "FROM_CLAWDIS" },
        metadata: { clawdbot: { primaryEnv: "FROM_METADATA" } },
      };
      expect(extractPrimaryEnvName(parsed)).toBe("FROM_CLAWDIS");
    });

    it("falls back to metadata.<ns>.primaryEnv", () => {
      const parsed = {
        metadata: { openclaw: { primaryEnv: "FROM_OPENCLAW" } },
        frontmatter: { primaryEnv: "FROM_FRONTMATTER" },
      };
      expect(extractPrimaryEnvName(parsed)).toBe("FROM_OPENCLAW");
    });

    it("finally falls back to frontmatter.primaryEnv", () => {
      const parsed = {
        frontmatter: { primaryEnv: "FROM_FRONTMATTER" },
      };
      expect(extractPrimaryEnvName(parsed)).toBe("FROM_FRONTMATTER");
    });

    it("trims whitespace", () => {
      expect(extractPrimaryEnvName({ primaryEnv: "  PADDED  " })).toBe("PADDED");
    });
  });

  describe("extractEnvVarDeclarations", () => {
    it("returns [] for non-record inputs", () => {
      expect(extractEnvVarDeclarations(null)).toEqual([]);
      expect(extractEnvVarDeclarations({})).toEqual([]);
    });

    it("reads parsed.clawdis.envVars (canonical)", () => {
      const parsed = {
        clawdis: {
          envVars: [
            { name: "STRIPE_API_KEY", required: true, description: "Live secret key" },
            { name: "STRIPE_WEBHOOK_SECRET" },
          ],
        },
      };
      expect(extractEnvVarDeclarations(parsed)).toEqual<EnvVarDeclaration[]>([
        { name: "STRIPE_API_KEY", required: true, description: "Live secret key" },
        { name: "STRIPE_WEBHOOK_SECRET" },
      ]);
    });

    it("reads parsed.metadata.<ns>.envVars", () => {
      const parsed = {
        metadata: {
          clawdbot: {
            envVars: [{ name: "GH_TOKEN", required: true }],
          },
        },
      };
      expect(extractEnvVarDeclarations(parsed)).toEqual<EnvVarDeclaration[]>([
        { name: "GH_TOKEN", required: true },
      ]);
    });

    it("treats top-level frontmatter.env: [string,...] as required envVars", () => {
      const parsed = {
        frontmatter: { env: ["FOO", "BAR"] },
      };
      expect(extractEnvVarDeclarations(parsed)).toEqual<EnvVarDeclaration[]>([
        { name: "FOO", required: true },
        { name: "BAR", required: true },
      ]);
    });

    it("dedupes by name, first occurrence wins", () => {
      const parsed = {
        clawdis: { envVars: [{ name: "DUPE", required: true, description: "first" }] },
        metadata: {
          clawdbot: { envVars: [{ name: "DUPE", required: false, description: "second" }] },
        },
      };
      expect(extractEnvVarDeclarations(parsed)).toEqual<EnvVarDeclaration[]>([
        { name: "DUPE", required: true, description: "first" },
      ]);
    });

    it("ignores malformed entries (no name / non-string name / non-objects)", () => {
      const parsed = {
        clawdis: {
          envVars: [
            null,
            "  ",
            { required: true }, // no name
            { name: 42 }, // wrong type
            { name: "VALID", required: false },
          ],
        },
      };
      expect(extractEnvVarDeclarations(parsed)).toEqual<EnvVarDeclaration[]>([
        { name: "VALID", required: false },
      ]);
    });
  });

  describe("hasRequiredEnvSignal", () => {
    it("returns true when requires.env is non-empty", () => {
      expect(hasRequiredEnvSignal({ clawdis: { requires: { env: ["X"] } } })).toBe(true);
    });

    it("returns true when primaryEnv is set anywhere", () => {
      expect(hasRequiredEnvSignal({ frontmatter: { primaryEnv: "Y" } })).toBe(true);
    });

    it("returns true when any envVars entry has required=true", () => {
      expect(
        hasRequiredEnvSignal({
          clawdis: { envVars: [{ name: "Z", required: true }] },
        }),
      ).toBe(true);
    });

    it("returns false when only optional envVars are declared", () => {
      expect(
        hasRequiredEnvSignal({
          clawdis: { envVars: [{ name: "OPT", required: false }] },
        }),
      ).toBe(false);
    });

    it("returns false for an empty parsed blob", () => {
      expect(hasRequiredEnvSignal({})).toBe(false);
      expect(hasRequiredEnvSignal({ frontmatter: {}, clawdis: {} })).toBe(false);
    });

    it("matches the real mongo-shell shape (mongo-shell regression)", () => {
      // This shape is exactly what we observe in the local convex deployment
      // for the seeded `mongo-shell` skill — sourced from
      // `bunx convex run skills:getSkillBySlugInternal '{"slug":"mongo-shell"}'`.
      const parsed = {
        frontmatter: { name: "mongo-shell", description: "Query MongoDB" },
        metadata: {
          clawdbot: {
            nix: { plugin: "github:example/mongo-shell" },
            config: { requiredEnv: ["MONGODB_URI"] },
            cliHelp: "...",
          },
        },
        clawdis: {
          nix: { plugin: "github:example/mongo-shell" },
          config: { requiredEnv: ["MONGODB_URI"] },
          cliHelp: "...",
        },
      };
      expect(extractRequiresEnvList(parsed)).toEqual(["MONGODB_URI"]);
      expect(hasRequiredEnvSignal(parsed)).toBe(true);
    });
  });
});
