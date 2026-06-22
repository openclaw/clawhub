import { describe, expect, it, vi } from "vitest";
import { hashSkillFiles } from "./lib/skills";
import { resolveVersionByHash } from "./skills";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const resolveHandler = (
  resolveVersionByHash as unknown as WrappedHandler<
    { slug: string; hash: string },
    { match: { version: string } | null; latestVersion: { version: string } | null } | null
  >
)._handler;

function chain<T>(value: T) {
  const q = {
    eq: vi.fn(() => q),
  };
  return {
    withIndex: vi.fn((_name: string, build: (query: typeof q) => unknown) => {
      build(q);
      return value;
    }),
  };
}

describe("resolveVersionByHash", () => {
  it("matches generated bundle fingerprints for installed bundles that include skill-card.md", async () => {
    const sourceSha = "a".repeat(64);
    const cardSha = "b".repeat(64);
    const bundleFingerprint = await hashSkillFiles([
      { path: "SKILL.md", sha256: sourceSha },
      { path: "skill-card.md", sha256: cardSha },
    ]);

    const skill = {
      _id: "skills:demo",
      slug: "demo",
      latestVersionId: "skillVersions:latest",
    };
    const latestVersion = {
      _id: "skillVersions:latest",
      skillId: skill._id,
      version: "2.0.0",
      softDeletedAt: undefined,
    };
    const matchedVersion = {
      _id: "skillVersions:1",
      skillId: skill._id,
      version: "1.0.0",
      softDeletedAt: undefined,
    };
    const fingerprintEntry = {
      versionId: matchedVersion._id,
      fingerprint: bundleFingerprint,
      kind: "generated-bundle",
      createdAt: 10,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === latestVersion._id) return latestVersion;
        if (id === matchedVersion._id) return matchedVersion;
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return chain({ unique: vi.fn(async () => skill) });
        }
        if (table === "skillVersionFingerprints") {
          return chain({ take: vi.fn(async () => [fingerprintEntry]) });
        }
        if (table === "skillSlugAliases") {
          return chain({ take: vi.fn(async () => []) });
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await resolveHandler({ db }, { slug: "demo", hash: bundleFingerprint });

    expect(result).toEqual({
      match: { version: "1.0.0" },
      latestVersion: { version: "2.0.0" },
    });
    expect(db.query).toHaveBeenCalledWith("skillVersionFingerprints");
  });
});
