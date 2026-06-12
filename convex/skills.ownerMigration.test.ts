import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { getSkillForPublishPreflightInternal, insertVersion } from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const insertVersionHandler = (insertVersion as unknown as WrappedHandler<Record<string, unknown>>)
  ._handler;
const getSkillForPublishPreflightHandler = (
  getSkillForPublishPreflightInternal as unknown as WrappedHandler<Record<string, unknown>>
)._handler;

const SENTINEL_BAIL_MESSAGE = "__owner_migration_sentinel_stop__";

function buildPublishArgs(overrides?: Partial<Record<string, unknown>>) {
  return {
    userId: "users:caller",
    ownerPublisherId: "publishers:org",
    slug: "nano",
    displayName: "Nano",
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

type PublisherMemberRecord = {
  _id: string;
  publisherId: string;
  userId: string;
  role: "owner" | "admin" | "publisher";
};

type OrgMigrationFixture = {
  db: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    normalizeId: ReturnType<typeof vi.fn>;
  };
  patchCalls: Array<{ id: string; value: Record<string, unknown> }>;
  insertCalls: Array<{ table: string; value: Record<string, unknown> }>;
};

type SkillSourceMode = "other-personal" | "caller-personal" | "source-org";

function createMigrationFixture(params: {
  sourceMemberships: PublisherMemberRecord[];
  /**
   * Which publisher owns the existing `skills:1` row in this fixture:
   *  - "other-personal": `publishers:personalSource` (linkedUser = users:sourceOwner),
   *    used to simulate an attacker publishing into someone else's slug.
   *  - "caller-personal": `publishers:personalCaller` (linkedUser = users:caller),
   *    used to simulate the real issue scenario: moving your own personal skill
   *    into an org you belong to.
   *  - "source-org": `publishers:sourceOrg` (kind = "org"), used to simulate
   *    moving a skill OUT of one org and into another publisher. The caller's
   *    authority on `publishers:sourceOrg` is parameterized via `sourceMemberships`.
   */
  skillSource?: SkillSourceMode;
  sourcePersonalLinkedUserId?: string | null;
  duplicateGlobalSlug?: boolean;
  destinationDuplicateSkill?: boolean;
  skillOverrides?: Record<string, unknown>;
}): OrgMigrationFixture {
  const now = Date.now();
  const patchCalls: Array<{ id: string; value: Record<string, unknown> }> = [];
  const insertCalls: Array<{ table: string; value: Record<string, unknown> }> = [];

  const db = {
    get: vi.fn(async (id: string) => {
      if (id === "users:caller") {
        return {
          _id: "users:caller",
          handle: "caller",
          name: "caller",
          deletedAt: undefined,
          deactivatedAt: undefined,
          personalPublisherId: "publishers:personalCaller",
          _creationTime: now,
        };
      }
      if (id === "publishers:personalCaller") {
        return {
          _id: "publishers:personalCaller",
          kind: "user",
          handle: "caller",
          displayName: "caller",
          linkedUserId:
            params.sourcePersonalLinkedUserId === undefined
              ? "users:caller"
              : params.sourcePersonalLinkedUserId,
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      if (id === "publishers:org") {
        return {
          _id: "publishers:org",
          kind: "org",
          handle: "casualsecurityinc",
          displayName: "Casual Security",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      if (id === "users:sourceOwner") {
        return {
          _id: "users:sourceOwner",
          handle: "cbrunnkvist",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      if (id === "publishers:personalSource") {
        return {
          _id: "publishers:personalSource",
          kind: "user",
          handle: "cbrunnkvist",
          displayName: "cbrunnkvist",
          linkedUserId: "users:sourceOwner",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      if (id === "publishers:sourceOrg") {
        return {
          _id: "publishers:sourceOrg",
          kind: "org",
          handle: "sourceorg",
          displayName: "Source Org",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      return null;
    }),
    query: vi.fn((table: string) => {
      if (table === "publishers") {
        return {
          withIndex: (_name: string, build: (q: unknown) => unknown) => {
            // Handle any publisher-handle lookup by returning the caller/source/org
            // as inert (not present) to keep ensurePersonalPublisherForUser happy.
            const q: Record<string, unknown> = {
              eq: (_field: string, _value: unknown) => q,
            };
            build?.(q);
            return { unique: async () => null };
          },
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: (
            name: string,
            build: (q: { eq: (field: string, value: string) => unknown }) => unknown,
          ) => {
            if (name !== "by_publisher_user") {
              throw new Error(`unexpected publisherMembers index ${name}`);
            }
            let publisherId = "";
            let userId = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "publisherId") publisherId = value;
                if (field === "userId") userId = value;
                return q;
              },
            };
            build(q);
            return {
              unique: async () => {
                // Caller's role on the target org defaults to "publisher" in
                // these tests (that's the precondition the first-pass
                // `requirePublisherRole(..., ["publisher"])` check expects).
                // Individual tests can upgrade this to admin/owner by passing
                // a matching entry in `sourceMemberships`, which we consult
                // FIRST so it can override the default. Source-publisher
                // membership is parameterized per-test the same way.
                const override = params.sourceMemberships.find(
                  (m) => m.publisherId === publisherId && m.userId === userId,
                );
                if (override) return override;
                if (publisherId === "publishers:personalCaller" && userId === "users:caller") {
                  return {
                    _id: "publisherMembers:personalCaller",
                    publisherId,
                    userId,
                    role: "owner",
                  };
                }
                if (publisherId === "publishers:org" && userId === "users:caller") {
                  return {
                    _id: "publisherMembers:orgCaller",
                    publisherId,
                    userId,
                    role: "publisher",
                  };
                }
                return null;
              },
            };
          },
        };
      }
      if (table === "skills") {
        return {
          withIndex: (
            name: string,
            build: ((q: { eq: (field: string, value: string) => unknown }) => unknown) | undefined,
          ) => {
            if (
              name === "by_slug" ||
              name === "by_owner_publisher_slug" ||
              name === "by_owner_slug"
            ) {
              const constraints: Record<string, string> = {};
              const q = {
                eq: (field: string, value: string) => {
                  constraints[field] = value;
                  return q;
                },
              };
              build?.(q);
              const mode: SkillSourceMode = params.skillSource ?? "other-personal";
              const ownerPublisherId =
                mode === "caller-personal"
                  ? "publishers:personalCaller"
                  : mode === "source-org"
                    ? "publishers:sourceOrg"
                    : "publishers:personalSource";
              const ownerUserId = mode === "caller-personal" ? "users:caller" : "users:sourceOwner";
              const skill = {
                _id: "skills:1",
                slug: "nano",
                ownerUserId,
                ownerPublisherId,
                softDeletedAt: undefined,
                moderationStatus: "active",
                moderationFlags: undefined,
                statsDownloads: 42,
                statsStars: 7,
                stats: {
                  downloads: 1,
                  stars: 2,
                  installsCurrent: 0,
                  installsAllTime: 0,
                  comments: 0,
                  versions: 1,
                },
                ...params.skillOverrides,
              };
              const unrelatedDuplicateSkill = {
                ...skill,
                _id: "skills:duplicate",
                ownerUserId: "users:duplicate",
                ownerPublisherId: "publishers:duplicate",
              };
              const destinationDuplicateSkill = {
                ...skill,
                _id: "skills:destination",
                ownerUserId: "users:caller",
                ownerPublisherId: "publishers:org",
              };
              const candidates = [
                skill,
                ...(params.destinationDuplicateSkill ? [destinationDuplicateSkill] : []),
              ];
              const matches = candidates.filter((candidate) => {
                const skillMatches =
                  constraints.slug === undefined || constraints.slug === candidate.slug;
                const ownerPublisherMatches =
                  constraints.ownerPublisherId === undefined ||
                  constraints.ownerPublisherId === candidate.ownerPublisherId;
                const ownerUserMatches =
                  constraints.ownerUserId === undefined ||
                  constraints.ownerUserId === candidate.ownerUserId;
                return skillMatches && ownerPublisherMatches && ownerUserMatches;
              });
              return {
                unique: async () => matches[0] ?? null,
                take: async () => {
                  if (
                    params.duplicateGlobalSlug &&
                    name === "by_slug" &&
                    constraints.ownerPublisherId === undefined &&
                    constraints.ownerUserId === undefined
                  ) {
                    return [...matches, unrelatedDuplicateSkill];
                  }
                  return matches;
                },
              };
            }
            // Any subsequent skill-table access means migration was allowed and
            // insertVersion proceeded to the "brand new skill" path. Bail out
            // with a sentinel so the test can assert patch/insert calls without
            // having to mock the entire downstream pipeline.
            throw new Error(SENTINEL_BAIL_MESSAGE);
          },
        };
      }
      if (table === "skillSlugAliases") {
        return {
          withIndex: (name: string) => {
            if (name === "by_skill") {
              return { collect: async () => [] };
            }
            if (name === "by_slug") {
              return { unique: async () => null, take: async () => [] };
            }
            if (name === "by_owner_publisher_slug" || name === "by_owner_slug") {
              return { unique: async () => null };
            }
            throw new Error(`unexpected skillSlugAliases index ${name}`);
          },
        };
      }
      if (table === "skillEmbeddings") {
        return {
          withIndex: (name: string) => {
            if (name === "by_skill") {
              // Single mock embedding for `skills:1` so the migration branch
              // exercises the embedding-ownerId reassignment loop. Older
              // `ownerId` is the source owner derived from the skill source
              // mode, mirroring how embeddings get written at publish time.
              const mode: SkillSourceMode = params.skillSource ?? "other-personal";
              const ownerId = mode === "caller-personal" ? "users:caller" : "users:sourceOwner";
              return {
                collect: async () => [
                  {
                    _id: "skillEmbeddings:1",
                    skillId: "skills:1",
                    ownerId,
                  },
                ],
              };
            }
            throw new Error(`unexpected skillEmbeddings index ${name}`);
          },
        };
      }
      if (table === "authAccounts") {
        return {
          withIndex: () => ({
            take: async () => [],
          }),
        };
      }
      // Any access to a downstream table means the migration branch completed
      // and insertVersion proceeded into the publish pipeline. Bail out with a
      // sentinel so the test can assert patch/insert side-effects without
      // having to mock the entire pipeline.
      throw new Error(SENTINEL_BAIL_MESSAGE);
    }),
    patch: vi.fn(async (id: string, value: Record<string, unknown>) => {
      patchCalls.push({ id, value });
    }),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      insertCalls.push({ table, value });
      return `${table}:inserted`;
    }),
    normalizeId: vi.fn(),
  };

  return { db, patchCalls, insertCalls };
}

describe("skills.insertVersion owner migration", () => {
  it("rejects slug migration when caller has no membership on the source publisher", async () => {
    const fixture = createMigrationFixture({ sourceMemberships: [] });

    // Pass `migrateOwner: true` so this test actually exercises the
    // source-authority check. Without the opt-in, the request would be
    // rejected by the explicit-intent gate instead and the authority check
    // below would never run.
    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow(/Slug is already taken/);

    // The skill row must NOT be patched when the caller is not a source member.
    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);

    // No migration audit log should be written on the rejection path.
    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });

  it("rejects migration from a linked personal publisher when ownerUserId is stale", async () => {
    const fixture = createMigrationFixture({
      skillSource: "other-personal",
      sourceMemberships: [
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
      skillOverrides: {
        ownerUserId: "users:caller",
      },
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow(/Slug is already taken/);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);

    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });

  it("rejects slug migration when caller is only a 'publisher' (not admin/owner) on the source org", async () => {
    // Regression guard for the privilege-escalation path: a plain publisher-role
    // member of the source org must NOT be able to walk skills out of that org
    // via a republish. Transferring ownership requires admin/owner-level
    // authority on the source, aligned with `transferPackage` in packages.ts.
    const fixture = createMigrationFixture({
      skillSource: "source-org",
      sourceMemberships: [
        {
          _id: "publisherMembers:sourcePublisher",
          publisherId: "publishers:sourceOrg",
          userId: "users:caller",
          role: "publisher",
        },
      ],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow(/Slug is already taken/);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);

    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });

  it("migrates ownership when caller is an admin on the source org", async () => {
    // Positive counterpart to the publisher-only rejection above: admin/owner
    // authority on the source publisher IS sufficient to move the skill, which
    // matches the transfer semantics in convex/packages.ts.
    const fixture = createMigrationFixture({
      skillSource: "source-org",
      sourceMemberships: [
        {
          _id: "publisherMembers:sourceAdmin",
          publisherId: "publishers:sourceOrg",
          userId: "users:caller",
          role: "admin",
        },
        // Destination admin role is also required on the migration path now
        // (matching transferPackage). Without this the migration would be
        // rejected even though the source side is satisfied.
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow(SENTINEL_BAIL_MESSAGE);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(1);
    expect(skillPatches[0]?.value).toMatchObject({
      ownerPublisherId: "publishers:org",
      ownerUserId: "users:caller",
    });

    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(1);
    const auditMetadata = migrationAudits[0]?.value.metadata as {
      from?: { ownerPublisherId?: string; ownerUserId?: string };
      to?: { ownerPublisherId?: string; ownerUserId?: string };
    };
    expect(auditMetadata.from).toEqual({
      ownerPublisherId: "publishers:sourceOrg",
      ownerUserId: "users:sourceOwner",
    });
    expect(auditMetadata.to).toEqual({
      ownerPublisherId: "publishers:org",
      ownerUserId: "users:caller",
    });

    // Cross-owner migration must also rebalance the per-user skill counters
    // (publishedSkills / totalStars / totalDownloads) so the previous owner
    // stops being credited for the skill. This mirrors the maintenance the
    // moderator `changeOwner` path performs via
    // `adjustUserSkillStatsForSkillChange`.
    const prevOwnerStatsPatch = fixture.patchCalls.find((p) => p.id === "users:sourceOwner");
    expect(prevOwnerStatsPatch?.value).toMatchObject({
      publishedSkills: 0,
      totalStars: 0,
      totalDownloads: 0,
    });
    const nextOwnerStatsPatch = fixture.patchCalls.find((p) => p.id === "users:caller");
    expect(nextOwnerStatsPatch?.value).toMatchObject({
      publishedSkills: 1,
      totalStars: 7,
      totalDownloads: 42,
    });

    // And the skill's embedding must be re-homed to the new owner so that
    // "authored by" queries don't keep resolving to the previous owner.
    const embeddingPatches = fixture.patchCalls.filter((p) => p.id === "skillEmbeddings:1");
    expect(embeddingPatches).toHaveLength(1);
    expect(embeddingPatches[0]?.value).toMatchObject({ ownerId: "users:caller" });
  });

  it("rejects owner migration for skills still blocked by legacy reason codes", async () => {
    const fixture = createMigrationFixture({
      skillSource: "source-org",
      sourceMemberships: [
        {
          _id: "publisherMembers:sourceAdmin",
          publisherId: "publishers:sourceOrg",
          userId: "users:caller",
          role: "admin",
        },
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
      skillOverrides: {
        moderationReasonCodes: ["malicious.crypto_mining"],
      },
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow("under moderation");

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);

    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });

  it("migrates ownership when caller moves their OWN personal skill into an org they belong to", async () => {
    // Real issue scenario: @cbrunnkvist owns `nano` under their personal
    // publisher and wants to republish under `@casualsecurityinc`.
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      sourceMemberships: [
        // ensurePersonalPublisherForUser already grants the caller an "owner"
        // membership on publishers:personalCaller, so the source side is
        // covered. The destination (the org) needs admin-level rights now
        // (matching transferPackage), so we grant that explicitly here.
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
    });

    // After the migration branch succeeds we bail out via a sentinel so we can
    // assert on the side-effects without fully mocking downstream pipeline.
    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow(SENTINEL_BAIL_MESSAGE);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(1);
    expect(skillPatches[0]?.value).toMatchObject({
      ownerPublisherId: "publishers:org",
      ownerUserId: "users:caller",
    });

    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(1);
    const auditMetadata = migrationAudits[0]?.value.metadata as {
      from?: { ownerPublisherId?: string; ownerUserId?: string };
      to?: { ownerPublisherId?: string; ownerUserId?: string };
    };
    expect(auditMetadata.from).toEqual({
      ownerPublisherId: "publishers:personalCaller",
      ownerUserId: "users:caller",
    });
    expect(auditMetadata.to).toEqual({
      ownerPublisherId: "publishers:org",
      ownerUserId: "users:caller",
    });

    // When the skill's `ownerUserId` doesn't actually change (personal → org
    // owned by the same user), the embedding's `ownerId` was already correct
    // and must not be rewritten. This exercises the early-continue branch in
    // the embedding reassignment loop and avoids a no-op patch storm.
    const embeddingPatches = fixture.patchCalls.filter((p) => p.id === "skillEmbeddings:1");
    expect(embeddingPatches).toHaveLength(0);
  });

  it("migrates caller-owned personal skills even when the legacy personal publisher link is missing", async () => {
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      sourcePersonalLinkedUserId: null,
      sourceMemberships: [
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow(SENTINEL_BAIL_MESSAGE);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(1);
    expect(skillPatches[0]?.value).toMatchObject({
      ownerPublisherId: "publishers:org",
      ownerUserId: "users:caller",
    });
  });

  it("migrates from the explicit source owner even when another publisher has the same slug", async () => {
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      duplicateGlobalSlug: true,
      sourceMemberships: [
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({
          migrateOwner: true,
          sourceOwnerPublisherId: "publishers:personalCaller",
        }) as never,
      ),
    ).rejects.toThrow(SENTINEL_BAIL_MESSAGE);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(1);
    expect(skillPatches[0]?.value).toMatchObject({
      ownerPublisherId: "publishers:org",
      ownerUserId: "users:caller",
    });
  });

  it("rejects explicit migration when the destination owner already has the slug", async () => {
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      destinationDuplicateSkill: true,
      sourceMemberships: [
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({
          migrateOwner: true,
          sourceOwnerPublisherId: "publishers:personalCaller",
        }) as never,
      ),
    ).rejects.toThrow(
      'Destination owner @casualsecurityinc already has skill "nano". Choose a different slug or publish without migrating ownership.',
    );

    expect(fixture.patchCalls.filter((p) => p.id === "skills:1")).toHaveLength(0);
    expect(fixture.patchCalls.filter((p) => p.id === "skills:destination")).toHaveLength(0);
    expect(fixture.insertCalls).not.toContainEqual(
      expect.objectContaining({
        table: "skillVersions",
      }),
    );
  });

  it("classifies explicit migrations as blocked when preflight sees a destination slug collision", async () => {
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      destinationDuplicateSkill: true,
      sourceMemberships: [],
    });

    await expect(
      getSkillForPublishPreflightHandler(
        { db: fixture.db } as never,
        {
          userId: "users:caller",
          slug: "nano",
          ownerPublisherId: "publishers:org",
          sourceOwnerPublisherId: "publishers:personalCaller",
          migrateOwner: true,
        } as never,
      ),
    ).rejects.toThrow(
      'Destination owner @casualsecurityinc already has skill "nano". Choose a different slug or publish without migrating ownership.',
    );
  });

  it("classifies default personal publishes as existing legacy personal rows", async () => {
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      sourceMemberships: [],
      skillOverrides: { ownerPublisherId: undefined },
    });

    const result = await getSkillForPublishPreflightHandler(
      { db: fixture.db } as never,
      {
        userId: "users:caller",
        slug: "nano",
        ownerPublisherId: "publishers:personalCaller",
      } as never,
    );

    expect(result).toMatchObject({
      _id: "skills:1",
      ownerUserId: "users:caller",
      ownerPublisherId: undefined,
    });
  });

  it("rejects an explicit migration when the source owner no longer has the slug", async () => {
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      sourceMemberships: [
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({
          migrateOwner: true,
          sourceOwnerPublisherId: "publishers:sourceOrg",
        }) as never,
      ),
    ).rejects.toThrow('Source owner @sourceorg does not have skill "nano".');

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);
    expect(fixture.insertCalls).not.toContainEqual(
      expect.objectContaining({
        table: "skills",
      }),
    );
  });

  it("rejects legacy publisher backfill for skills under moderation", async () => {
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      sourceMemberships: [],
      skillOverrides: {
        ownerPublisherId: undefined,
        moderationReason: "scanner.vt.malicious",
      },
    });

    await expect(
      insertVersionHandler({ db: fixture.db } as never, buildPublishArgs() as never),
    ).rejects.toThrow("under moderation");

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);
  });

  it("refuses to migrate a skill out of SOMEONE ELSE'S personal publisher even if caller happens to be a member", async () => {
    // Defense-in-depth: addMember currently doesn't forbid adding extra
    // members to a user-kind publisher. We must still refuse to let the
    // extra member move that user's skills away from them.
    const fixture = createMigrationFixture({
      skillSource: "other-personal",
      sourceMemberships: [
        {
          _id: "publisherMembers:sourceCaller",
          publisherId: "publishers:personalSource",
          userId: "users:caller",
          role: "publisher",
        },
      ],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow(/Slug is already taken/);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);
    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });

  it("does NOT migrate ownership when caller omits ownerPublisherId", async () => {
    const fixture = createMigrationFixture({
      sourceMemberships: [
        // Missing ownerPublisherId means the publish is scoped to the caller's
        // personal publisher. It must not migrate a same-slug skill from a
        // different owner namespace.
        {
          _id: "publisherMembers:sourceCaller",
          publisherId: "publishers:personalSource",
          userId: "users:caller",
          role: "publisher",
        },
      ],
    });

    const argsWithoutOwner = buildPublishArgs({ migrateOwner: true });
    delete (argsWithoutOwner as Record<string, unknown>).ownerPublisherId;

    await expect(
      insertVersionHandler({ db: fixture.db } as never, argsWithoutOwner as never),
    ).rejects.toThrow(SENTINEL_BAIL_MESSAGE);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);

    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });

  it("does NOT migrate ownership when caller omits migrateOwner:true", async () => {
    // Without migrateOwner, a same-slug publish into another owner namespace is
    // a scoped publish, not an ownership transfer.
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      sourceMemberships: [
        {
          _id: "publisherMembers:orgAdminCaller",
          publisherId: "publishers:org",
          userId: "users:caller",
          role: "admin",
        },
      ],
    });

    await expect(
      insertVersionHandler({ db: fixture.db } as never, buildPublishArgs() as never),
    ).rejects.toThrow(SENTINEL_BAIL_MESSAGE);

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);
    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });

  it("rejects migration when caller is only 'publisher' (not admin) on the DESTINATION org", async () => {
    // Destination authority check (aligned with transferPackage in
    // convex/packages.ts): publishing into an org only requires publisher
    // role, but *transferring ownership into* the org requires admin-level
    // rights on that destination too. A plain publisher on the destination
    // org must not be able to pull a skill into the org namespace via a
    // republish even if source-side authority is fully satisfied.
    const fixture = createMigrationFixture({
      skillSource: "caller-personal",
      // Grant NO admin role on publishers:org — the default fixture wiring
      // already gives the caller "publisher" role there, which is what we
      // want to test against.
      sourceMemberships: [],
    });

    await expect(
      insertVersionHandler(
        { db: fixture.db } as never,
        buildPublishArgs({ migrateOwner: true }) as never,
      ),
    ).rejects.toThrow();

    const skillPatches = fixture.patchCalls.filter((p) => p.id === "skills:1");
    expect(skillPatches).toHaveLength(0);
    const migrationAudits = fixture.insertCalls.filter(
      (call) => call.table === "auditLogs" && call.value.action === "skill.ownership.migrate",
    );
    expect(migrationAudits).toHaveLength(0);
  });
});
