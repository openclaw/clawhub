import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import {
  approveSkillByHashInternal,
  clearOwnerSuspiciousFlagsInternal,
  escalateSkillByIdInternal,
  escalateByVtInternal,
  insertVersion,
} from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const insertVersionHandler = (insertVersion as unknown as WrappedHandler<Record<string, unknown>>)
  ._handler;
const approveSkillByHashHandler = (
  approveSkillByHashInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const escalateSkillByIdHandler = (
  escalateSkillByIdInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const escalateByVtHandler = (
  escalateByVtInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;
const clearOwnerSuspiciousFlagsHandler = (
  clearOwnerSuspiciousFlagsInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;

function buildGlobalStatsQuery(table: string) {
  if (table !== "globalStats") return null;
  return {
    withIndex: (name: string) => {
      if (name !== "by_key") throw new Error(`unexpected globalStats index ${name}`);
      return {
        unique: async () => ({
          _id: "globalStats:1",
          activeSkillsCount: 100,
        }),
      };
    },
  };
}

function buildDigestQuery(table: string) {
  if (table !== "skillSearchDigest") return null;
  return {
    withIndex: () => ({
      unique: async () => null,
    }),
  };
}

function createPublishArgs(overrides?: Partial<Record<string, unknown>>) {
  return {
    userId: "users:owner",
    slug: "spam-skill",
    displayName: "Spam Skill",
    version: "1.0.0",
    changelog: "Initial release",
    changelogSource: "user",
    tags: ["latest"],
    fingerprint: "f".repeat(64),
    files: [
      {
        path: "SKILL.md",
        size: 128,
        storageId: "_storage:1",
        sha256: "a".repeat(64),
        contentType: "text/markdown",
      },
    ],
    parsed: {
      frontmatter: { description: "test" },
      metadata: {},
      clawdis: {},
    },
    embedding: [0.1, 0.2],
    ...overrides,
  };
}

describe("skills anti-spam guards", () => {
  it("blocks low-trust users after hourly new-skill cap", async () => {
    const now = Date.now();
    const ownerSkills = Array.from({ length: 5 }, (_, i) => ({
      _id: `skills:${i}`,
      createdAt: now - i * 10_000,
    }));

    const db = {
      get: vi.fn(async () => ({
        _id: "users:owner",
        _creationTime: now - 2 * 24 * 60 * 60 * 1000,
        createdAt: now - 2 * 24 * 60 * 60 * 1000,
        deletedAt: undefined,
      })),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug") {
                return { unique: async () => null };
              }
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => ownerSkills,
                  }),
                };
              }
              throw new Error(`unexpected index ${name}`);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected index ${name}`);
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skillSlugAliases index ${name}`);
              return { unique: async () => null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      normalizeId: vi.fn(),
    };

    await expect(
      insertVersionHandler({ db } as never, createPublishArgs() as never),
    ).rejects.toThrow(/max 5 new skills per hour/i);
  });

  it("returns a user-facing slug-taken message when publishing to another owner slug", async () => {
    let authAccountLookupCount = 0;
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "users:caller") return { _id: "users:caller", deletedAt: undefined };
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  ownerUserId: "users:owner",
                  softDeletedAt: undefined,
                  moderationStatus: "active",
                  moderationFlags: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => {
                  authAccountLookupCount += 1;
                  return authAccountLookupCount === 1
                    ? { providerAccountId: "owner-gh" }
                    : { providerAccountId: "caller-gh" };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      normalizeId: vi.fn(),
    };

    await expect(
      insertVersionHandler(
        { db } as never,
        createPublishArgs({
          userId: "users:caller",
          slug: "taken-skill",
        }) as never,
      ),
    ).rejects.toThrow(
      "Slug is already taken. Choose a different slug. Existing skill: /alice/taken-skill",
    );
  });

  it("normalizes mixed-case slugs before checking skill ownership conflicts", async () => {
    let authAccountLookupCount = 0;
    let requestedSlug: string | null = null;
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "users:caller") return { _id: "users:caller", deletedAt: undefined };
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: undefined,
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (
              name: string,
              build:
                | ((q: { eq: (field: string, value: string) => unknown }) => unknown)
                | undefined,
            ) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              const q = {
                eq: (field: string, value: string) => {
                  if (field !== "slug") throw new Error(`unexpected field ${field}`);
                  requestedSlug = value;
                  return q;
                },
              };
              build?.(q);
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  ownerUserId: "users:owner",
                  softDeletedAt: undefined,
                  moderationStatus: "active",
                  moderationFlags: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => {
                  authAccountLookupCount += 1;
                  return authAccountLookupCount === 1
                    ? { providerAccountId: "owner-gh" }
                    : { providerAccountId: "caller-gh" };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      normalizeId: vi.fn(),
    };

    await expect(
      insertVersionHandler(
        { db } as never,
        createPublishArgs({
          userId: "users:caller",
          slug: "Taken-Skill",
        }) as never,
      ),
    ).rejects.toThrow(
      "Slug is already taken. Choose a different slug. Existing skill: /alice/taken-skill",
    );

    expect(requestedSlug).toBe("taken-skill");
  });

  it("does not include a URL in slug-taken message when conflicting owner is deleted", async () => {
    let authAccountLookupCount = 0;
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "users:caller") return { _id: "users:caller", deletedAt: undefined };
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: Date.now(),
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  ownerUserId: "users:owner",
                  softDeletedAt: undefined,
                  moderationStatus: "active",
                  moderationFlags: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => {
                  authAccountLookupCount += 1;
                  return authAccountLookupCount === 1
                    ? { providerAccountId: "owner-gh" }
                    : { providerAccountId: "caller-gh" };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      normalizeId: vi.fn(),
    };

    await expect(
      insertVersionHandler(
        { db } as never,
        createPublishArgs({
          userId: "users:caller",
          slug: "taken-skill",
        }) as never,
      ),
    ).rejects.toThrow(
      "This slug is locked to a deleted or banned account. " +
        "If you believe you are the rightful owner, please contact security@openclaw.ai to reclaim it.",
    );
  });

  it("heals ownership when conflicting owner is deleted but GitHub identity matches", async () => {
    let authAccountLookupCount = 0;
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async (table: string) => {
      if (table === "skillVersions") return "skillVersions:1";
      if (table === "skillEmbeddings") return "skillEmbeddings:1";
      if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
      if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
      throw new Error(`unexpected insert table ${table}`);
    });
    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "users:caller") {
          return {
            _id: "users:caller",
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: false,
            role: "user",
          };
        }
        if (id === "users:owner") {
          return {
            _id: "users:owner",
            handle: "alice",
            deletedAt: Date.now(),
            deactivatedAt: undefined,
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
              return {
                unique: async () => ({
                  _id: "skills:1",
                  slug: "taken-skill",
                  displayName: "Taken Skill",
                  summary: "Existing summary",
                  ownerUserId: "users:owner",
                  latestVersionId: undefined,
                  tags: {},
                  softDeletedAt: undefined,
                  badges: {
                    redactionApproved: undefined,
                    highlighted: undefined,
                    official: undefined,
                    deprecated: undefined,
                  },
                  moderationStatus: "active",
                  moderationReason: "pending.scan",
                  moderationNotes: undefined,
                  moderationVerdict: "clean",
                  moderationReasonCodes: undefined,
                  moderationEvidence: undefined,
                  moderationSummary: "Clean",
                  moderationEngineVersion: "test",
                  moderationEvaluatedAt: 1,
                  moderationSourceVersionId: undefined,
                  quality: undefined,
                  moderationFlags: undefined,
                  isSuspicious: false,
                  reportCount: 0,
                  lastReportedAt: undefined,
                  statsDownloads: 0,
                  statsStars: 0,
                  statsInstallsCurrent: 0,
                  statsInstallsAllTime: 0,
                  stats: {
                    downloads: 0,
                    installsCurrent: 0,
                    installsAllTime: 0,
                    stars: 0,
                    versions: 1,
                    comments: 0,
                  },
                  createdAt: 1,
                  updatedAt: 1,
                  manualOverride: undefined,
                }),
              };
            },
          };
        }
        if (table === "authAccounts") {
          return {
            withIndex: (name: string) => {
              if (name !== "userIdAndProvider") throw new Error(`unexpected auth index ${name}`);
              return {
                unique: async () => {
                  authAccountLookupCount += 1;
                  return authAccountLookupCount <= 2 ? { providerAccountId: "shared-gh" } : null;
                },
              };
            },
          };
        }
        if (table === "skillVersions") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill_version") {
                throw new Error(`unexpected skillVersions index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillBadges") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected skillBadges index ${name}`);
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_version") {
                throw new Error(`unexpected skillEmbeddings index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skillSlugAliases index ${name}`);
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skillSlugAliases index ${name}`);
              return {
                unique: async () => null,
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
      normalizeId: vi.fn(),
    };

    const result = await insertVersionHandler(
      { db } as never,
      createPublishArgs({
        userId: "users:caller",
        slug: "taken-skill",
      }) as never,
    );

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills:1",
      expect.objectContaining({
        ownerUserId: "users:caller",
      }),
    );
    expect(result).toEqual({
      skillId: "skills:1",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
  });

  it("keeps suspicious skills visible for low-trust publishers", async () => {
    const patch = vi.fn(async () => {});
    const version = { _id: "skillVersions:1", skillId: "skills:1" };
    const skill = {
      _id: "skills:1",
      slug: "spam-skill",
      ownerUserId: "users:owner",
      moderationFlags: undefined,
      moderationReason: undefined,
    };
    const owner = {
      _id: "users:owner",
      _creationTime: Date.now() - 2 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              throw new Error(`unexpected skills index ${name}`);
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "vt",
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.vt.suspicious",
        moderationFlags: ["flagged.suspicious"],
      }),
    );
  });

  it("hides static-malicious publishes and places the owner under moderation", async () => {
    const storedSkills = new Map<string, Record<string, unknown>>();
    const storedDigests = new Map<string, Record<string, unknown>>();
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (storedSkills.has(id)) {
        storedSkills.set(id, { ...storedSkills.get(id), ...value });
      }
      const digest = Array.from(storedDigests.values()).find((entry) => entry.skillId === id);
      if (digest) {
        Object.assign(digest, value);
      }
    });
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "skills") {
        storedSkills.set("skills:1", { _id: "skills:1", _creationTime: 1, ...value });
        return "skills:1";
      }
      if (table === "skillSearchDigest") {
        storedDigests.set("skillSearchDigest:1", { _id: "skillSearchDigest:1", ...value });
        return "skillSearchDigest:1";
      }
      if (table === "skillVersions") return "skillVersions:1";
      if (table === "skillEmbeddings") return "skillEmbeddings:1";
      if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
      if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
      throw new Error(`unexpected insert table ${table}`);
    });
    const runAfter = vi.fn();
    const db = {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const key = String(maybeId ?? tableOrId);
        if (storedSkills.has(key)) return storedSkills.get(key);
        if (key === "users:owner") {
          return {
            _id: "users:owner",
            _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
            createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: true,
            role: "user",
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug") return { unique: async () => null };
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              throw new Error(`unexpected skills index ${name}`);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected reservedSlugs index ${name}`);
            },
          };
        }
        if (table === "skillVersionFingerprints") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_fingerprint") {
                throw new Error(`unexpected skillVersionFingerprints index ${name}`);
              }
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillVersions") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill_version") {
                throw new Error(`unexpected skillVersions index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillBadges") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected skillBadges index ${name}`);
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_version") {
                throw new Error(`unexpected skillEmbeddings index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skillSlugAliases index ${name}`);
              return {
                unique: async () => null,
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
      normalizeId: vi.fn((tableName: string, id: string) =>
        String(id).startsWith(`${tableName}:`) ? id : null,
      ),
    };

    const result = await insertVersionHandler(
      { db, scheduler: { runAfter } } as never,
      createPublishArgs({
        staticScan: {
          status: "malicious",
          reasonCodes: ["malicious.install_terminal_payload"],
          findings: [
            {
              code: "malicious.install_terminal_payload",
              severity: "critical",
              file: "SKILL.md",
              line: 1,
              message: "Install prompt contains an obfuscated terminal payload.",
              evidence: "echo ... | base64 -D | bash",
            },
          ],
          summary: "Detected: malicious.install_terminal_payload",
          engineVersion: "v2.2.0",
          checkedAt: Date.now(),
        },
      }) as never,
    );

    expect(result).toEqual({
      skillId: "skills:1",
      versionId: "skillVersions:1",
      embeddingId: "skillEmbeddings:1",
    });
    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "scanner.static.malicious",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        ownerUserId: "users:owner",
        slug: "spam-skill",
        reason: "malicious.install_terminal_payload",
      }),
    );
  });

  it("keeps new publishes hidden while the uploader is under moderation", async () => {
    const storedSkills = new Map<string, Record<string, unknown>>();
    const storedDigests = new Map<string, Record<string, unknown>>();
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "skills") {
        storedSkills.set("skills:1", { _id: "skills:1", _creationTime: 1, ...value });
        return "skills:1";
      }
      if (table === "skillSearchDigest") {
        storedDigests.set("skillSearchDigest:1", { _id: "skillSearchDigest:1", ...value });
        return "skillSearchDigest:1";
      }
      if (table === "skillVersions") return "skillVersions:1";
      if (table === "skillEmbeddings") return "skillEmbeddings:1";
      if (table === "embeddingSkillMap") return "embeddingSkillMap:1";
      if (table === "skillVersionFingerprints") return "skillVersionFingerprints:1";
      throw new Error(`unexpected insert table ${table}`);
    });
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (storedSkills.has(id)) {
        storedSkills.set(id, { ...storedSkills.get(id), ...value });
      }
      const digest = Array.from(storedDigests.values()).find((entry) => entry.skillId === id);
      if (digest) {
        Object.assign(digest, value);
      }
    });
    const db = {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const key = String(maybeId ?? tableOrId);
        if (storedSkills.has(key)) return storedSkills.get(key);
        if (key === "users:owner") {
          return {
            _id: "users:owner",
            _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
            createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
            deletedAt: undefined,
            deactivatedAt: undefined,
            trustedPublisher: true,
            requiresModerationAt: Date.now() - 1_000,
            requiresModerationReason: "needs review",
            role: "user",
          };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug") return { unique: async () => null };
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              throw new Error(`unexpected skills index ${name}`);
            },
          };
        }
        if (table === "reservedSlugs") {
          return {
            withIndex: (name: string) => {
              if (name === "by_slug_active_deletedAt") {
                return { order: () => ({ take: async () => [] }) };
              }
              throw new Error(`unexpected reservedSlugs index ${name}`);
            },
          };
        }
        if (table === "skillVersionFingerprints") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_fingerprint") {
                throw new Error(`unexpected skillVersionFingerprints index ${name}`);
              }
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillVersions") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill_version") {
                throw new Error(`unexpected skillVersions index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillBadges") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_skill") throw new Error(`unexpected skillBadges index ${name}`);
              return {
                take: async () => [],
              };
            },
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_version") {
                throw new Error(`unexpected skillEmbeddings index ${name}`);
              }
              return {
                unique: async () => null,
              };
            },
          };
        }
        if (table === "skillSlugAliases") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_slug") throw new Error(`unexpected skillSlugAliases index ${name}`);
              return {
                unique: async () => null,
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
      normalizeId: vi.fn((tableName: string, id: string) =>
        String(id).startsWith(`${tableName}:`) ? id : null,
      ),
    };

    await insertVersionHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      createPublishArgs({
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "No suspicious patterns detected.",
          engineVersion: "v2.2.0",
          checkedAt: Date.now(),
        },
      }) as never,
    );

    expect(insert).toHaveBeenCalledWith(
      "skills",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "user.moderation",
        moderationNotes: "needs review",
      }),
    );
  });

  it("keeps admin-owned skills non-suspicious for suspicious scanner verdicts", async () => {
    const patch = vi.fn(async () => {});
    const version = { _id: "skillVersions:1", skillId: "skills:1" };
    const skill = {
      _id: "skills:1",
      slug: "trusted-skill",
      ownerUserId: "users:owner",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.vt.suspicious",
    };
    const owner = {
      _id: "users:owner",
      role: "admin",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              throw new Error(`unexpected skills index ${name}`);
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "llm",
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.llm.clean",
        moderationFlags: undefined,
      }),
    );
  });

  it("keeps skills hidden when aggregate verdict remains malicious after a clean scanner update", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "malicious",
        reasonCodes: ["malicious.crypto_mining"],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: { status: "malicious" },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "miner",
      ownerUserId: "users:owner",
      moderationFlags: undefined,
      moderationReason: "scanner.vt.pending",
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name === "by_owner") {
                return {
                  order: () => ({
                    take: async () => [],
                  }),
                };
              }
              throw new Error(`unexpected skills index ${name}`);
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await approveSkillByHashHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        scanner: "vt",
        status: "clean",
      } as never,
    );

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
      }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "globalStats:1",
      expect.objectContaining({
        activeSkillsCount: 99,
      }),
    );
  });

  it("vt suspicious escalation does not keep suspicious flags for admin owners", async () => {
    const patch = vi.fn(async () => {});
    const version = { _id: "skillVersions:1", skillId: "skills:1" };
    const skill = {
      _id: "skills:1",
      slug: "trusted-skill",
      ownerUserId: "users:owner",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.llm.suspicious",
    };
    const owner = {
      _id: "users:owner",
      role: "admin",
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skillVersions") {
          return {
            withIndex: () => ({
              unique: async () => version,
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await escalateByVtHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        sha256hash: "h".repeat(64),
        status: "suspicious",
      } as never,
    );

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationFlags: undefined,
        moderationReason: "scanner.llm.clean",
      }),
    );
  });

  it("rebuilds structured moderation state for legacy skillId escalation", async () => {
    const patch = vi.fn(async () => {});
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.dynamic_code_execution"],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: Date.now(),
      },
      vtAnalysis: { status: "malicious" },
      llmAnalysis: { status: "clean" },
    };
    const skill = {
      _id: "skills:1",
      slug: "legacy-bad",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      moderationFlags: undefined,
      moderationReason: "scanner.vt.pending",
      moderationStatus: "active",
    };
    const owner = {
      _id: "users:owner",
      role: "user",
      _creationTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      deletedAt: undefined,
    };

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "skills:1") return skill;
        if (id === "skillVersions:1") return version;
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    await escalateSkillByIdHandler(
      { db } as never,
      {
        skillId: "skills:1",
        moderationReason: "scanner.vt.malicious",
        moderationFlags: ["blocked.malware"],
        moderationStatus: "hidden",
      } as never,
    );

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.malicious",
        moderationFlags: ["blocked.malware"],
        moderationVerdict: "malicious",
        moderationReasonCodes: expect.arrayContaining([
          "malicious.vt_malicious",
          "suspicious.dynamic_code_execution",
        ]),
        moderationSourceVersionId: "skillVersions:1",
      }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "globalStats:1",
      expect.objectContaining({
        activeSkillsCount: 99,
      }),
    );
  });

  it("bulk-clears suspicious flags/reasons for privileged owner skills", async () => {
    const patch = vi.fn(async () => {});
    const owner = {
      _id: "users:owner",
      role: "admin",
      deletedAt: undefined,
    };
    const skills = [
      {
        _id: "skills:1",
        moderationFlags: ["flagged.suspicious"],
        moderationReason: "scanner.vt.suspicious",
        moderationStatus: "hidden",
        softDeletedAt: undefined,
      },
      {
        _id: "skills:2",
        moderationFlags: undefined,
        moderationReason: "scanner.llm.clean",
        moderationStatus: "active",
        softDeletedAt: undefined,
      },
    ];

    const db = {
      get: vi.fn(async (id: string) => {
        if (id === "users:owner") return owner;
        return null;
      }),
      query: vi.fn((table: string) => {
        const globalStatsQuery = buildGlobalStatsQuery(table);
        if (globalStatsQuery) return globalStatsQuery;
        const digestQuery = buildDigestQuery(table);
        if (digestQuery) return digestQuery;
        if (table === "skills") {
          return {
            withIndex: (name: string) => {
              if (name !== "by_owner") throw new Error(`unexpected skills index ${name}`);
              return {
                order: () => ({
                  take: async () => skills,
                }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert: vi.fn(),
      normalizeId: vi.fn(),
    };

    const result = await clearOwnerSuspiciousFlagsHandler(
      { db } as never,
      { ownerUserId: "users:owner", limit: 20 } as never,
    );

    expect(result).toEqual({ inspected: 2, updated: 1 });
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationFlags: undefined,
        moderationReason: "scanner.vt.clean",
        moderationStatus: "active",
      }),
    );
  });
});
