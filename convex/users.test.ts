import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("./lib/access", async () => {
  const actual = await vi.importActual<typeof import("./lib/access")>("./lib/access");
  return { ...actual, requireUser: vi.fn() };
});

const { requireUser } = await import("./lib/access");
const { getAuthUserId } = await import("@convex-dev/auth/server");
const {
  ensureHandler,
  getByHandle,
  getHoverStats,
  getBanAppealContextByGitHubProviderAccountIdInternal,
  list,
  searchInternal,
  banUserInternal,
  autobanMalwareAuthorInternal,
  autobanPublisherAbuseOwnerInternal,
  recordMaliciousArtifactFindingInternal,
  unbanUserForBanAppealServiceInternal,
  reclassifyBanInternal,
  me,
  placeUserUnderModerationInternal,
  liftModerationHoldInternal,
  purgeSelfDeletedAccountRecoveryBatchInternal,
  ensurePublisherHandleInternal,
  reserveHandleInternal,
  syncGitHubProfileInternal,
  updateProfile,
  deleteAccount,
  upsertDevPersonaInternal,
} = await import("./users");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const meHandler = (me as unknown as WrappedHandler<Record<string, never>, unknown>)._handler;
const getByHandleHandler = (getByHandle as unknown as WrappedHandler<{ handle: string }, unknown>)
  ._handler;
const getHoverStatsHandler = (
  getHoverStats as unknown as WrappedHandler<{ userId: string }, unknown>
)._handler;
const updateProfileHandler = (
  updateProfile as unknown as WrappedHandler<{ displayName: string; bio?: string }, void>
)._handler;
const deleteAccountHandler = (
  deleteAccount as unknown as WrappedHandler<Record<string, never>, void>
)._handler;
const purgeSelfDeletedAccountRecoveryBatchInternalHandler = (
  purgeSelfDeletedAccountRecoveryBatchInternal as unknown as WrappedHandler<
    { cursor?: string; limit?: number; dryRun?: boolean; mode?: "deactivated" | "legacyDeleted" },
    unknown
  >
)._handler;
const upsertDevPersonaInternalHandler = (
  upsertDevPersonaInternal as unknown as WrappedHandler<
    { persona: "owner" | "user" | "admin" | "officialOrgMember" | "abusePublisher" },
    unknown
  >
)._handler;
function makeCtx() {
  const patch = vi.fn();
  const publisherRows = new Map<string, Record<string, unknown>>();
  const publisherMembers: Array<Record<string, unknown>> = [];
  const get = vi.fn(async (id: string) => publisherRows.get(id) ?? null);
  const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
    if (table === "publishers") {
      const handle = typeof value.handle === "string" ? value.handle : "user";
      const id = `publishers:${handle}`;
      publisherRows.set(id, { _id: id, _creationTime: 1, ...value });
      return id;
    }
    if (table === "publisherMembers") {
      const id = `publisherMembers:${publisherMembers.length + 1}`;
      publisherMembers.push({ _id: id, ...value });
      return id;
    }
    if (table === "auditLogs") return "auditLogs:1";
    return `${table}:1`;
  });
  const query = vi.fn((table: string) => {
    if (table === "reservedHandles") {
      return {
        withIndex: (name: string) => {
          if (name !== "by_handle_active_updatedAt") {
            throw new Error(`Unexpected reservedHandles index ${name}`);
          }
          return { order: () => ({ take: vi.fn(async () => []) }) };
        },
      };
    }
    if (table === "users") {
      return {
        withIndex: (name: string) => {
          if (name !== "handle") throw new Error(`Unexpected users index ${name}`);
          return { unique: vi.fn(async () => null) };
        },
      };
    }
    if (table === "publishers") {
      return {
        withIndex: (name: string) => {
          if (name === "by_handle") {
            return { unique: vi.fn(async () => null) };
          }
          if (name === "by_linked_user") {
            return { unique: vi.fn(async () => null) };
          }
          throw new Error(`Unexpected publishers index ${name}`);
        },
      };
    }
    if (table === "publisherMembers") {
      return {
        withIndex: (name: string) => {
          if (name !== "by_publisher_user") {
            throw new Error(`Unexpected publisherMembers index ${name}`);
          }
          return { unique: vi.fn(async () => null) };
        },
      };
    }
    if (table === "packages" || table === "skills") {
      return {
        withIndex: (name: string) => {
          if (name !== "by_owner_publisher") {
            throw new Error(`Unexpected ${table} index ${name}`);
          }
          return { collect: vi.fn(async () => []) };
        },
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    ctx: { db: { patch, get, insert, query, normalizeId: vi.fn() } } as never,
    patch,
    get,
    insert,
    query,
  };
}

function makeDevPersonaCtx() {
  const users = new Map<string, Record<string, unknown>>();
  const publishers = new Map<string, Record<string, unknown>>();
  const publisherMembers: Array<Record<string, unknown>> = [];
  const officialPublishers: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
    const id = `${table}:${inserts.length + 1}`;
    const row = { _id: id, _creationTime: 1, ...value };
    inserts.push({ table, value: row });
    if (table === "users") users.set(id, row);
    if (table === "publishers") publishers.set(id, row);
    if (table === "publisherMembers") publisherMembers.push(row);
    if (table === "officialPublishers") officialPublishers.push(row);
    return id;
  });

  const get = vi.fn(async (...args: string[]) => {
    const id = args.length === 2 ? args[1] : args[0];
    return users.get(id) ?? publishers.get(id) ?? null;
  });

  const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
    patches.push({ id, value });
    const current = users.get(id) ?? publishers.get(id);
    if (current) Object.assign(current, value);
  });

  const query = vi.fn((table: string) => {
    if (table === "users") {
      return {
        withIndex: vi.fn((name: string, builder?: (q: unknown) => unknown) => {
          if (name !== "handle") throw new Error(`Unexpected users index ${name}`);
          let handle = "";
          const q = {
            eq: (field: string, value: string) => {
              if (field === "handle") handle = value;
              return q;
            },
          };
          builder?.(q);
          return {
            unique: vi.fn(
              async () => [...users.values()].find((user) => user.handle === handle) ?? null,
            ),
          };
        }),
      };
    }
    if (table === "publishers") {
      return {
        withIndex: vi.fn((name: string, builder?: (q: unknown) => unknown) => {
          let handle = "";
          let linkedUserId = "";
          const q = {
            eq: (field: string, value: string) => {
              if (field === "handle") handle = value;
              if (field === "linkedUserId") linkedUserId = value;
              return q;
            },
          };
          builder?.(q);
          if (name === "by_handle") {
            return {
              unique: vi.fn(
                async () =>
                  [...publishers.values()].find((publisher) => publisher.handle === handle) ?? null,
              ),
            };
          }
          if (name === "by_linked_user") {
            return {
              unique: vi.fn(
                async () =>
                  [...publishers.values()].find(
                    (publisher) => publisher.linkedUserId === linkedUserId,
                  ) ?? null,
              ),
            };
          }
          throw new Error(`Unexpected publishers index ${name}`);
        }),
      };
    }
    if (table === "publisherMembers") {
      return {
        withIndex: vi.fn((name: string, builder?: (q: unknown) => unknown) => {
          if (name !== "by_publisher_user") {
            throw new Error(`Unexpected publisherMembers index ${name}`);
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
          builder?.(q);
          return {
            unique: vi.fn(
              async () =>
                publisherMembers.find(
                  (member) => member.publisherId === publisherId && member.userId === userId,
                ) ?? null,
            ),
          };
        }),
      };
    }
    if (table === "reservedHandles") {
      return {
        withIndex: vi.fn((name: string) => {
          if (name !== "by_handle_active_updatedAt") {
            throw new Error(`Unexpected reservedHandles index ${name}`);
          }
          return { order: () => ({ take: vi.fn(async () => []) }) };
        }),
      };
    }
    if (table === "officialPublishers") {
      return {
        withIndex: vi.fn((name: string, builder?: (q: unknown) => unknown) => {
          if (name !== "by_publisher")
            throw new Error(`Unexpected officialPublishers index ${name}`);
          let publisherId = "";
          const q = {
            eq: (field: string, value: string) => {
              if (field === "publisherId") publisherId = value;
              return q;
            },
          };
          builder?.(q);
          return {
            unique: vi.fn(
              async () =>
                officialPublishers.find((entry) => entry.publisherId === publisherId) ?? null,
            ),
          };
        }),
      };
    }
    if (table === "auditLogs") {
      return {
        withIndex: vi.fn((name: string, builder?: (q: unknown) => unknown) => {
          if (name !== "by_target") throw new Error(`Unexpected auditLogs index ${name}`);
          let targetType = "";
          let targetId = "";
          const q = {
            eq: (field: string, value: string) => {
              if (field === "targetType") targetType = value;
              if (field === "targetId") targetId = value;
              return q;
            },
          };
          builder?.(q);
          return {
            collect: vi.fn(async () =>
              auditLogs.filter(
                (entry) => entry.targetType === targetType && entry.targetId === targetId,
              ),
            ),
          };
        }),
      };
    }
    if (table === "packages" || table === "skills") {
      return {
        withIndex: vi.fn((name: string) => {
          if (name !== "by_owner") throw new Error(`Unexpected ${table} index ${name}`);
          return {
            collect: vi.fn(async () => []),
            paginate: vi.fn(async () => ({
              page: [],
              continueCursor: null,
              isDone: true,
            })),
          };
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return {
    ctx: { db: { patch, get, insert, query, normalizeId: vi.fn() } } as never,
    auditLogs,
    inserts,
    patches,
    users,
  };
}

function makeListCtx(
  users: Array<Record<string, unknown>>,
  options?: {
    publishersByHandle?: Record<string, Record<string, unknown>>;
    usersById?: Record<string, Record<string, unknown> | null>;
  },
) {
  const take = vi.fn(async (n: number) => users.slice(0, n));
  const collect = vi.fn(async () => users);
  const order = vi.fn(() => ({ take, collect }));
  const publishersByHandle = options?.publishersByHandle ?? {};
  const usersById = options?.usersById ?? {};
  const query = vi.fn((table: string) => {
    if (table === "users") {
      return {
        order,
        withIndex: (
          name: string,
          cb?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
        ) => {
          if (name !== "handle") throw new Error(`Unexpected users index ${name}`);
          let handle = "";
          cb?.({
            eq: (field: string, value: string) => {
              if (field === "handle") handle = value;
              return {};
            },
          });
          return {
            unique: vi.fn(async () => users.find((user) => user.handle === handle) ?? null),
          };
        },
      };
    }
    if (table === "publishers") {
      return {
        withIndex: (
          name: string,
          cb?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
        ) => {
          if (name !== "by_handle") throw new Error(`Unexpected publishers index ${name}`);
          let handle = "";
          cb?.({
            eq: (field: string, value: string) => {
              if (field === "handle") handle = value;
              return {};
            },
          });
          return { unique: vi.fn(async () => publishersByHandle[handle] ?? null) };
        },
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  const get = vi.fn<(id: string) => Promise<Record<string, unknown> | null>>(
    async (id: string) => usersById[id] ?? null,
  );
  return {
    ctx: { db: { query, get, normalizeId: vi.fn() } } as never,
    take,
    collect,
    order,
    query,
    get,
  };
}

function makeBanCtx(
  options: {
    auditLogs?: Array<Record<string, unknown>>;
    officialPublisherIds?: string[];
    publisherMembers?: Array<Record<string, unknown>>;
  } = {},
) {
  const patch = vi.fn();
  const auditLogs = options.auditLogs ?? [];
  const officialPublisherIds = new Set(options.officialPublisherIds ?? []);
  const publisherMembers = options.publisherMembers ?? [];
  const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
    if (table === "auditLogs") auditLogs.unshift(value);
    return `${table}:inserted`;
  });
  const get = vi.fn();
  const runMutation = vi.fn();
  const runAfter = vi.fn();
  const apiTokens = [{ _id: "apiTokens:1", revokedAt: undefined }];
  const query = vi.fn((table: string) => ({
    withIndex: (
      _index: string,
      build?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      if (table === "auditLogs") {
        return { order: vi.fn(() => ({ take: vi.fn().mockResolvedValue(auditLogs) })) };
      }
      if (table === "apiTokens") return { collect: vi.fn().mockResolvedValue(apiTokens) };
      if (table === "officialPublishers") {
        const constraints: Record<string, unknown> = {};
        const q = {
          eq(field: string, value: unknown) {
            constraints[field] = value;
            return q;
          },
        };
        build?.(q);
        const publisherId =
          typeof constraints.publisherId === "string" ? constraints.publisherId : "";
        return {
          unique: vi
            .fn()
            .mockResolvedValue(
              officialPublisherIds.has(publisherId)
                ? { _id: `officialPublishers:${publisherId}`, publisherId }
                : null,
            ),
        };
      }
      if (table === "publisherMembers") {
        const constraints: Record<string, unknown> = {};
        const q = {
          eq(field: string, value: unknown) {
            constraints[field] = value;
            return q;
          },
        };
        build?.(q);
        const publisherId =
          typeof constraints.publisherId === "string" ? constraints.publisherId : "";
        const role = typeof constraints.role === "string" ? constraints.role : "";
        return {
          paginate: vi.fn(
            async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
              const members = publisherMembers.filter(
                (member) => member.publisherId === publisherId && member.role === role,
              );
              const offset = cursor ? Number(cursor) : 0;
              const page = members.slice(offset, offset + numItems);
              const nextOffset = offset + page.length;
              return {
                page,
                isDone: nextOffset >= members.length,
                continueCursor: String(nextOffset),
              };
            },
          ),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }));

  const ctx = {
    db: { patch, insert, get, query, normalizeId: vi.fn() },
    runMutation,
    scheduler: { runAfter },
  } as never;
  return { ctx, patch, insert, get, query, runMutation, runAfter };
}

function makeBanAppealContextCtx(options: {
  accounts: Array<Record<string, unknown>>;
  usersById: Record<string, Record<string, unknown>>;
  auditLogs?: Array<Record<string, unknown>>;
}) {
  const get = vi.fn(async (id: string) => options.usersById[id] ?? null);
  const query = vi.fn((table: string) => ({
    withIndex: (_index: string, _cb: unknown) => {
      if (table === "authAccounts") {
        return { take: vi.fn().mockResolvedValue(options.accounts) };
      }
      if (table === "auditLogs") {
        return {
          order: vi.fn(() => ({ take: vi.fn().mockResolvedValue(options.auditLogs ?? []) })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }));
  return { ctx: { db: { query, get } } as never, query, get };
}

describe("users.getBanAppealContextByGitHubProviderAccountIdInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects a currently banned user from duplicate GitHub auth accounts", async () => {
    const { ctx } = makeBanAppealContextCtx({
      accounts: [{ userId: "users:active" }, { userId: "users:banned" }],
      usersById: {
        "users:active": {
          _id: "users:active",
          handle: "active",
          deletedAt: undefined,
          deactivatedAt: undefined,
        },
        "users:banned": {
          _id: "users:banned",
          handle: "banned",
          displayName: "Banned User",
          deletedAt: 1_700_000_000_000,
          deactivatedAt: undefined,
          banReason: "policy",
        },
      },
      auditLogs: [
        {
          _id: "auditLogs:ban",
          action: "user.ban",
          actorUserId: "users:admin",
          targetType: "user",
          targetId: "users:banned",
          metadata: { reason: "audit policy" },
          createdAt: 1_700_000_000_000,
        },
      ],
    });

    const handler = (
      getBanAppealContextByGitHubProviderAccountIdInternal as unknown as WrappedHandler<
        { providerAccountId: string },
        unknown
      >
    )._handler;

    const result = (await handler(ctx, { providerAccountId: "123456" })) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      action: "banned",
      userId: "users:banned",
      handle: "banned",
      displayName: "Banned User",
      banReason: "policy",
      bannedAt: 1_700_000_000_000,
      auditAction: "user.ban",
      auditActorUserId: "users:admin",
    });
  });
});

describe("ensureHandler", () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(getAuthUserId).mockReset();
  });

  it("updates handle and display name when GitHub login changes", async () => {
    const { ctx, patch } = makeCtx();
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: {
        _creationTime: 1,
        handle: "old-handle",
        displayName: "old-handle",
        name: "new-handle",
        email: "old@example.com",
        role: "user",
        createdAt: 1,
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).toHaveBeenCalledWith("users:1", {
      handle: "new-handle",
      displayName: "new-handle",
      updatedAt: expect.any(Number),
    });
  });

  it("does not override a custom display name when syncing handle", async () => {
    const { ctx, patch } = makeCtx();
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:2",
      user: {
        _creationTime: 1,
        handle: "old-handle",
        displayName: "Custom Name",
        name: "new-handle",
        role: "user",
        createdAt: 1,
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).toHaveBeenCalledWith("users:2", {
      handle: "new-handle",
      updatedAt: expect.any(Number),
    });
  });

  it("fills display name from existing handle when missing", async () => {
    const { ctx, patch } = makeCtx();
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:3",
      user: {
        _creationTime: 1,
        handle: "steady-handle",
        displayName: undefined,
        name: undefined,
        email: undefined,
        role: "user",
        createdAt: 1,
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).toHaveBeenCalledWith("users:3", {
      displayName: "steady-handle",
      updatedAt: expect.any(Number),
    });
  });

  it("does not patch when user metadata is already normalized", async () => {
    const { ctx, patch, get } = makeCtx();
    get.mockResolvedValue({
      _id: "users:4",
      handle: "steady",
      displayName: "Steady Name",
      name: "steady",
      role: "user",
      _creationTime: 1,
      createdAt: 1,
    });
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:4",
      user: {
        _creationTime: 1,
        handle: "steady",
        displayName: "Steady Name",
        name: "steady",
        role: "user",
        createdAt: 1,
      },
    } as never);

    const result = await ensureHandler(ctx);

    expect(patch).not.toHaveBeenCalledWith(
      "users:4",
      expect.objectContaining({
        handle: expect.anything(),
        displayName: expect.anything(),
        role: expect.anything(),
      }),
    );
    expect(get).toHaveBeenCalledWith("users:4");
    expect(result).toMatchObject({ _id: "users:4" });
  });

  it("sets admin role when normalized handle is steipete and role is missing", async () => {
    const { ctx, patch } = makeCtx();
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: {
        _creationTime: 1,
        handle: "steipete",
        displayName: "steipete",
        name: "steipete",
        role: undefined,
        createdAt: 1,
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).toHaveBeenCalledWith("users:admin", {
      displayName: "steipete",
      role: "admin",
      updatedAt: expect.any(Number),
    });
  });

  it("derives handle/display name from email when missing", async () => {
    const { ctx, patch } = makeCtx();
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:email",
      user: {
        _creationTime: 1,
        handle: undefined,
        displayName: undefined,
        name: undefined,
        email: "owner@example.com",
        role: undefined,
        createdAt: undefined,
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).toHaveBeenCalledWith("users:email", {
      handle: "owner",
      displayName: "owner",
      role: "user",
      createdAt: 1,
      updatedAt: expect.any(Number),
    });
  });

  it.each(["docs", "skills"])(
    "skips public route owner handle %s when deriving a handle",
    async (handle) => {
      const { ctx, patch } = makeCtx();
      vi.mocked(requireUser).mockResolvedValue({
        userId: `users:${handle}`,
        user: {
          _creationTime: 1,
          handle: undefined,
          displayName: undefined,
          name: handle,
          email: undefined,
          role: "user",
          createdAt: 1,
        },
      } as never);

      await ensureHandler(ctx);

      expect(patch).toHaveBeenCalledWith(`users:${handle}`, {
        handle: `${handle}-2`,
        displayName: `${handle}-2`,
        updatedAt: expect.any(Number),
      });
    },
  );

  it("repairs an existing handle that is no longer claimable", async () => {
    const { ctx, patch, query } = makeCtx();
    query.mockImplementation(((table: string) => {
      if (table === "reservedHandles") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_handle_active_updatedAt") {
              throw new Error(`Unexpected reservedHandles index ${name}`);
            }
            return { order: () => ({ take: async () => [] }) };
          },
        };
      }
      if (table === "publishers") {
        return {
          withIndex: (
            name: string,
            builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
          ) => {
            let handle = "";
            let linkedUserId = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "handle") handle = value;
                if (field === "linkedUserId") linkedUserId = value;
                return q;
              },
            };
            builder?.(q);
            if (name === "by_handle") {
              return {
                unique: vi.fn(async () => {
                  if (handle === "openclaw") {
                    return {
                      _id: "publishers:openclaw",
                      kind: "org",
                      handle: "openclaw",
                      displayName: "OpenClaw",
                    };
                  }
                  return null;
                }),
              };
            }
            if (name === "by_linked_user") {
              return {
                unique: vi.fn(async () =>
                  linkedUserId === "users:owner"
                    ? {
                        _id: "publishers:openclaw-user",
                        kind: "user",
                        handle: "openclaw-user",
                        linkedUserId: "users:owner",
                        displayName: "OpenClaw User",
                      }
                    : null,
                ),
              };
            }
            throw new Error(`Unexpected publishers index ${name}`);
          },
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_publisher_user") {
              throw new Error(`Unexpected publisherMembers index ${name}`);
            }
            return { unique: vi.fn(async () => null) };
          },
        };
      }
      if (table === "packages" || table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_owner_publisher") {
              throw new Error(`Unexpected ${table} index ${name}`);
            }
            return { collect: vi.fn(async () => []) };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:owner",
      user: {
        _id: "users:owner",
        _creationTime: 1,
        handle: "openclaw",
        displayName: "openclaw",
        name: "openclaw",
        email: "owner@example.com",
        role: "user",
        createdAt: 1,
        personalPublisherId: "publishers:openclaw-user",
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).toHaveBeenCalledWith("users:owner", {
      handle: "openclaw-2",
      displayName: "openclaw-2",
      updatedAt: expect.any(Number),
    });
  });

  it("does not auto-claim a reserved handle for another user", async () => {
    const { ctx, patch, query } = makeCtx();
    query.mockImplementation(((table: string) => {
      if (table !== "reservedHandles") throw new Error(`Unexpected table ${table}`);
      return {
        withIndex: (name: string) => {
          if (name !== "by_handle_active_updatedAt") {
            throw new Error(`Unexpected reservedHandles index ${name}`);
          }
          return {
            order: () => ({
              take: async () => [
                {
                  _id: "reservedHandles:1",
                  handle: "openclaw",
                  rightfulOwnerUserId: "users:owner",
                  releasedAt: undefined,
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            }),
          };
        },
      };
    }) as never);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:other",
      user: {
        _id: "users:other",
        _creationTime: 1,
        handle: undefined,
        displayName: undefined,
        name: "openclaw",
        email: undefined,
        role: "user",
        createdAt: 1,
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).not.toHaveBeenCalled();
  });

  it("does not auto-claim a handle already owned by an org publisher", async () => {
    const { ctx, patch, query } = makeCtx();
    query.mockImplementation(((table: string) => {
      if (table === "reservedHandles") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_handle_active_updatedAt") {
              throw new Error(`Unexpected reservedHandles index ${name}`);
            }
            return { order: () => ({ take: async () => [] }) };
          },
        };
      }
      if (table === "publishers") {
        return {
          withIndex: (
            name: string,
            builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
          ) => {
            let handle = "";
            let linkedUserId = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "handle") handle = value;
                if (field === "linkedUserId") linkedUserId = value;
                return q;
              },
            };
            builder?.(q);
            if (name === "by_handle") {
              return {
                unique: vi.fn(async () =>
                  handle === "openclaw"
                    ? {
                        _id: "publishers:openclaw",
                        kind: "org",
                        handle: "openclaw",
                        displayName: "OpenClaw",
                      }
                    : null,
                ),
              };
            }
            if (name === "by_linked_user") {
              return {
                unique: vi.fn(async () =>
                  linkedUserId === "users:other"
                    ? {
                        _id: "publishers:openclaw-user",
                        kind: "user",
                        handle: "openclaw-user",
                        linkedUserId: "users:other",
                        displayName: "OpenClaw User",
                      }
                    : null,
                ),
              };
            }
            throw new Error(`Unexpected publishers index ${name}`);
          },
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_publisher_user") {
              throw new Error(`Unexpected publisherMembers index ${name}`);
            }
            return { unique: vi.fn(async () => null) };
          },
        };
      }
      if (table === "packages" || table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_owner_publisher") {
              throw new Error(`Unexpected ${table} index ${name}`);
            }
            return { collect: vi.fn(async () => []) };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:other",
      user: {
        _id: "users:other",
        _creationTime: 1,
        handle: undefined,
        displayName: undefined,
        name: "openclaw",
        email: undefined,
        role: "user",
        createdAt: 1,
      },
    } as never);

    await ensureHandler(ctx);

    expect(patch).not.toHaveBeenCalledWith(
      "users:other",
      expect.objectContaining({ handle: "openclaw" }),
    );
  });

  it("does not fail page/session ensure when personal publisher handle sync conflicts", async () => {
    const { ctx, insert, patch, query } = makeCtx();
    query.mockImplementation(((table: string) => {
      if (table === "reservedHandles") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_handle_active_updatedAt") {
              throw new Error(`Unexpected reservedHandles index ${name}`);
            }
            return { order: () => ({ take: vi.fn(async () => []) }) };
          },
        };
      }
      if (table === "publishers") {
        return {
          withIndex: (name: string) => {
            if (name === "by_linked_user") {
              return { unique: vi.fn(async () => null) };
            }
            if (name === "by_handle") {
              return {
                unique: vi.fn(async () => ({
                  _id: "publishers:claimed",
                  _creationTime: 1,
                  kind: "user",
                  handle: "claimed",
                  displayName: "Claimed",
                  linkedUserId: "users:other",
                  createdAt: 1,
                  updatedAt: 1,
                })),
              };
            }
            throw new Error(`Unexpected publishers index ${name}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:self",
      user: {
        _id: "users:self",
        _creationTime: 1,
        handle: "claimed",
        displayName: "Self",
        name: undefined,
        email: undefined,
        role: "user",
        createdAt: 1,
      },
    } as never);

    await expect(ensureHandler(ctx)).resolves.toBeNull();

    expect(patch).not.toHaveBeenCalledWith(
      "users:self",
      expect.objectContaining({ handle: expect.any(String) }),
    );
    expect(insert).not.toHaveBeenCalledWith("publishers", expect.anything());
  });
});

describe("users.upsertDevPersonaInternal", () => {
  it("rejects a dev persona sign-in when the persona is banned", async () => {
    process.env.DEV_AUTH_ENABLED = "1";
    process.env.CONVEX_DEPLOYMENT = "local:dev";
    process.env.CONVEX_SITE_URL = "http://localhost:3210";
    const { auditLogs, ctx, patches, users } = makeDevPersonaCtx();
    users.set("users:banned", {
      _id: "users:banned",
      _creationTime: 1,
      handle: "local-abuse",
      displayName: "Local Abuse Test Publisher",
      deletedAt: 1_700_000_000_000,
    });
    auditLogs.push({
      action: "user.autoban.malware",
      targetType: "user",
      targetId: "users:banned",
    });

    await expect(
      upsertDevPersonaInternalHandler(ctx, {
        persona: "abusePublisher",
      }),
    ).rejects.toThrow(/account has been banned/i);
    expect(patches).toEqual([]);
  });

  it("keeps the abuse persona auth name aligned with its stable handle", async () => {
    process.env.DEV_AUTH_ENABLED = "1";
    process.env.CONVEX_DEPLOYMENT = "local:dev";
    process.env.CONVEX_SITE_URL = "http://localhost:3210";
    const { ctx, inserts } = makeDevPersonaCtx();

    await upsertDevPersonaInternalHandler(ctx, {
      persona: "abusePublisher",
    });

    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "users",
        value: expect.objectContaining({
          handle: "local-abuse",
          name: "local-abuse",
          displayName: "Local Abuse Test Publisher",
        }),
      }),
    );
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "publishers",
        value: expect.objectContaining({
          handle: "local-abuse",
          displayName: "Local Abuse Test Publisher",
        }),
      }),
    );
  });

  it("seeds a non-platform-admin user who manages an official org", async () => {
    process.env.DEV_AUTH_ENABLED = "1";
    process.env.CONVEX_DEPLOYMENT = "local:dev";
    process.env.CONVEX_SITE_URL = "http://localhost:3210";
    const { ctx, inserts } = makeDevPersonaCtx();

    const userId = await upsertDevPersonaInternalHandler(ctx, {
      persona: "officialOrgMember",
    });

    expect(userId).toBe("users:1");
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "users",
        value: expect.objectContaining({
          handle: "local-official-member",
          displayName: "Local Official Org Member",
          role: "user",
        }),
      }),
    );
    const orgInsert = inserts.find(
      (entry) => entry.table === "publishers" && entry.value.handle === "local-official-org",
    );
    expect(orgInsert).toBeTruthy();
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "officialPublishers",
        value: expect.objectContaining({
          publisherId: orgInsert?.value._id,
          reason: "dev-persona.official-org-member",
        }),
      }),
    );
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "publisherMembers",
        value: expect.objectContaining({
          publisherId: orgInsert?.value._id,
          userId,
          role: "admin",
        }),
      }),
    );
  });
});

describe("me", () => {
  afterEach(() => {
    vi.mocked(getAuthUserId).mockReset();
  });

  it("returns null when auth resolution throws", async () => {
    vi.mocked(getAuthUserId).mockRejectedValue(new Error("stale session"));
    const get = vi.fn();

    const result = await meHandler({ db: { get } } as never, {});

    expect(result).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("returns null when auth resolves to an invalid user id", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:broken" as never);
    const get = vi.fn(async (id: string) => {
      if (id === "users:broken") throw new Error("Table mismatch");
      return null;
    });

    const result = await meHandler({ db: { get } } as never, {});

    expect(result).toBeNull();
    expect(get).toHaveBeenCalledWith("users:broken");
  });
});

describe("users.getByHandle", () => {
  it("normalizes the incoming handle before querying", async () => {
    const unique = vi.fn(async () => ({
      _id: "users:owner",
      _creationTime: 1,
      handle: "jaredforreal",
      name: "jaredforreal",
      displayName: "Jared",
      image: undefined,
      bio: undefined,
    }));

    const result = await getByHandleHandler(
      {
        db: {
          query: vi.fn((table: string) => {
            if (table !== "users") throw new Error(`Unexpected table ${table}`);
            return {
              withIndex: (
                name: string,
                builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
              ) => {
                if (name !== "handle") throw new Error(`Unexpected index ${name}`);
                let handle = "";
                const q = {
                  eq: (field: string, value: string) => {
                    if (field === "handle") handle = value;
                    return q;
                  },
                };
                builder?.(q);
                expect(handle).toBe("jaredforreal");
                return { unique };
              },
            };
          }),
          get: vi.fn(),
        },
      } as never,
      { handle: " @JaredForReal " },
    );

    expect(unique).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      _id: "users:owner",
      handle: "jaredforreal",
      displayName: "Jared",
    });
  });

  it("falls back to the linked user for a personal publisher handle", async () => {
    const userUnique = vi.fn(async () => null);
    const publisherUnique = vi.fn(async () => ({
      _id: "publishers:jaredforreal",
      kind: "user",
      handle: "jaredforreal",
      linkedUserId: "users:owner",
      displayName: "Jared",
    }));
    const get = vi.fn(async (id: string) =>
      id === "users:owner"
        ? {
            _id: "users:owner",
            _creationTime: 1,
            handle: "jared",
            name: "jaredforreal",
            displayName: "Jared",
            image: undefined,
            bio: "Profile",
          }
        : null,
    );

    const result = await getByHandleHandler(
      {
        db: {
          query: vi.fn((table: string) => {
            if (table === "users") {
              return {
                withIndex: (name: string) => {
                  if (name !== "handle") throw new Error(`Unexpected users index ${name}`);
                  return { unique: userUnique };
                },
              };
            }
            if (table === "publishers") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_handle") throw new Error(`Unexpected publishers index ${name}`);
                  return { unique: publisherUnique };
                },
              };
            }
            throw new Error(`Unexpected table ${table}`);
          }),
          get,
        },
      } as never,
      { handle: "jaredforreal" },
    );

    expect(userUnique).toHaveBeenCalledOnce();
    expect(publisherUnique).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("users:owner");
    expect(result).toMatchObject({
      _id: "users:owner",
      handle: "jared",
      name: "jaredforreal",
      displayName: "Jared",
      bio: "Profile",
    });
  });

  it("does not resolve a deleted personal publisher handle", async () => {
    const userUnique = vi.fn(async () => null);
    const publisherUnique = vi.fn(async () => ({
      _id: "publishers:jaredforreal",
      kind: "user",
      handle: "jaredforreal",
      linkedUserId: "users:owner",
      deletedAt: 1_700_000_000_000,
      displayName: "Jared",
    }));
    const get = vi.fn(async () => {
      throw new Error("linked user should not be loaded for inactive publishers");
    });

    const result = await getByHandleHandler(
      {
        db: {
          query: vi.fn((table: string) => {
            if (table === "users") {
              return {
                withIndex: (name: string) => {
                  if (name !== "handle") throw new Error(`Unexpected users index ${name}`);
                  return { unique: userUnique };
                },
              };
            }
            if (table === "publishers") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_handle") throw new Error(`Unexpected publishers index ${name}`);
                  return { unique: publisherUnique };
                },
              };
            }
            throw new Error(`Unexpected table ${table}`);
          }),
          get,
        },
      } as never,
      { handle: "jaredforreal" },
    );

    expect(userUnique).toHaveBeenCalledOnce();
    expect(publisherUnique).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe("users.getHoverStats", () => {
  it("uses install aggregates from a legacy personal publisher link", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "users:owner") {
        return {
          _id: "users:owner",
          _creationTime: 1,
          handle: "owner",
          displayName: "Owner",
          name: "Owner",
          email: "owner@example.com",
          role: "user",
          createdAt: 1,
          personalPublisherId: "publishers:owner",
        };
      }
      if (id === "publishers:owner") {
        return {
          _id: "publishers:owner",
          _creationTime: 1,
          kind: "user",
          handle: "owner",
          displayName: "Owner",
          publishedSkills: 4,
          totalStars: 5,
          totalDownloads: 91,
          totalInstalls: 37,
          createdAt: 1,
          updatedAt: 1,
        };
      }
      return null;
    });

    const result = await getHoverStatsHandler(
      {
        db: {
          get,
          query: vi.fn(() => {
            throw new Error("publisher lookup should use personalPublisherId");
          }),
        },
      },
      { userId: "users:owner" },
    );

    expect(result).toEqual({
      publishedSkills: 4,
      totalStars: 5,
      totalDownloads: 91,
      totalInstalls: 37,
    });
  });

  it("uses bounded legacy owner rows when a personal publisher aggregate is not backfilled", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "users:owner") {
        return {
          _id: "users:owner",
          _creationTime: 1,
          handle: "owner",
          displayName: "Owner",
          name: "Owner",
          email: "owner@example.com",
          role: "user",
          createdAt: 1,
          personalPublisherId: "publishers:owner",
        };
      }
      if (id === "publishers:owner") {
        return {
          _id: "publishers:owner",
          _creationTime: 1,
          kind: "user",
          handle: "owner",
          displayName: "Owner",
          publishedSkills: 1,
          totalStars: 2,
          totalDownloads: 30,
          createdAt: 1,
          updatedAt: 1,
        };
      }
      return null;
    });
    const takeLimits: number[] = [];
    const skill = {
      _id: "skills:demo",
      _creationTime: 1,
      ownerUserId: "users:owner",
      slug: "demo",
      stats: {
        downloads: 0,
        stars: 2,
        installsCurrent: 7,
        installsAllTime: 12,
        comments: 0,
        versions: 1,
      },
      statsInstallsAllTime: 12,
      createdAt: 1,
      updatedAt: 1,
    };
    const pkg = {
      _id: "packages:demo",
      _creationTime: 1,
      ownerUserId: "users:owner",
      stats: { downloads: 0, installs: 8, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    };
    const query = vi.fn((table: string) => ({
      withIndex: (indexName: string) => ({
        collect: async () => [],
        order: () => ({
          take: async (limit: number) => {
            takeLimits.push(limit);
            if (table === "skills" && indexName === "by_owner_active_updated") return [skill];
            if (table === "packages" && indexName === "by_owner") return [pkg];
            return [];
          },
        }),
      }),
    }));

    const result = await getHoverStatsHandler({ db: { get, query } }, { userId: "users:owner" });

    expect(result).toEqual({
      publishedSkills: 1,
      totalStars: 2,
      totalDownloads: 30,
      totalInstalls: 20,
    });
    expect(takeLimits).toHaveLength(4);
    expect(takeLimits.every((limit) => limit > 0 && limit <= 200)).toBe(true);
  });
});

describe("users.ensurePublisherHandleInternal", () => {
  it("rejects public route owner handles", async () => {
    const { ctx, get, insert } = makeCtx();
    get.mockResolvedValue({ _id: "users:admin", role: "admin" });
    const handler = (
      ensurePublisherHandleInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; handle: string; displayName?: string },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        actorUserId: "users:admin",
        handle: "docs",
        displayName: "Docs",
      }),
    ).rejects.toThrow('Handle "@docs" is reserved for ClawHub routes');
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("users.syncGitHubProfileInternal", () => {
  it("audits GitHub profile sync and resulting personal publisher creation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, insert } = makeCtx();
    get.mockResolvedValue({
      _id: "users:other",
      _creationTime: 1,
      handle: "old-handle",
      displayName: "old-handle",
      name: "old-handle",
      createdAt: 1,
    });

    const handler = (
      syncGitHubProfileInternal as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<void>;
      }
    )._handler;

    await handler(ctx, {
      userId: "users:other",
      name: "new-handle",
      image: "https://avatars.githubusercontent.com/u/1",
      syncedAt: 10,
    });

    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.profile.sync",
        actorUserId: "users:other",
        targetType: "user",
        targetId: "users:other",
        metadata: expect.objectContaining({
          source: "github",
          previous: expect.objectContaining({ handle: "old-handle" }),
          next: expect.objectContaining({ handle: "new-handle" }),
        }),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.personal.create",
        actorUserId: "users:other",
        targetType: "publisher",
        metadata: expect.objectContaining({
          source: "user.profile.sync",
          created: true,
        }),
      }),
    );
  });

  it("keeps a derived handle unchanged when the new login is reserved", async () => {
    const { ctx, get, patch, query } = makeCtx();
    get.mockResolvedValue({
      _id: "users:other",
      handle: "old-handle",
      displayName: "old-handle",
      name: "old-handle",
    });
    query.mockImplementation(((table: string) => {
      if (table !== "reservedHandles") throw new Error(`Unexpected table ${table}`);
      return {
        withIndex: (name: string) => {
          if (name !== "by_handle_active_updatedAt") {
            throw new Error(`Unexpected reservedHandles index ${name}`);
          }
          return {
            order: () => ({
              take: async () => [
                {
                  _id: "reservedHandles:1",
                  handle: "openclaw",
                  rightfulOwnerUserId: "users:owner",
                  releasedAt: undefined,
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            }),
          };
        },
      };
    }) as never);

    const handler = (
      syncGitHubProfileInternal as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<void>;
      }
    )._handler;

    await handler(ctx, {
      userId: "users:other",
      name: "openclaw",
      syncedAt: 10,
    });

    expect(patch).toHaveBeenCalledWith(
      "users:other",
      expect.objectContaining({
        githubProfileSyncedAt: 10,
        name: "openclaw",
      }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "users:other",
      expect.objectContaining({ handle: "openclaw" }),
    );
  });

  it("keeps a derived handle unchanged when the new login belongs to an org publisher", async () => {
    const { ctx, get, patch, query } = makeCtx();
    get.mockResolvedValue({
      _id: "users:other",
      handle: "old-handle",
      displayName: "old-handle",
      name: "old-handle",
    });
    query.mockImplementation(((table: string) => {
      if (table === "reservedHandles") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_handle_active_updatedAt") {
              throw new Error(`Unexpected reservedHandles index ${name}`);
            }
            return { order: () => ({ take: async () => [] }) };
          },
        };
      }
      if (table === "publishers") {
        return {
          withIndex: (
            name: string,
            builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
          ) => {
            let handle = "";
            let linkedUserId = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "handle") handle = value;
                if (field === "linkedUserId") linkedUserId = value;
                return q;
              },
            };
            builder?.(q);
            if (name === "by_handle") {
              return {
                unique: vi.fn(async () =>
                  handle === "openclaw"
                    ? {
                        _id: "publishers:openclaw",
                        kind: "org",
                        handle: "openclaw",
                        displayName: "OpenClaw",
                      }
                    : null,
                ),
              };
            }
            if (name === "by_linked_user") {
              return {
                unique: vi.fn(async () =>
                  linkedUserId === "users:other"
                    ? {
                        _id: "publishers:old-handle",
                        kind: "user",
                        handle: "old-handle",
                        linkedUserId: "users:other",
                        displayName: "Old Handle",
                      }
                    : null,
                ),
              };
            }
            throw new Error(`Unexpected publishers index ${name}`);
          },
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_publisher_user") {
              throw new Error(`Unexpected publisherMembers index ${name}`);
            }
            return { unique: vi.fn(async () => null) };
          },
        };
      }
      if (table === "packages" || table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_owner_publisher") {
              throw new Error(`Unexpected ${table} index ${name}`);
            }
            return { collect: vi.fn(async () => []) };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never);

    const handler = (
      syncGitHubProfileInternal as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<void>;
      }
    )._handler;

    await handler(ctx, {
      userId: "users:other",
      name: "openclaw",
      syncedAt: 10,
    });

    expect(patch).toHaveBeenCalledWith(
      "users:other",
      expect.objectContaining({
        githubProfileSyncedAt: 10,
        name: "openclaw",
      }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "users:other",
      expect.objectContaining({ handle: "openclaw" }),
    );
  });
});

describe("users profile audit logs", () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset();
  });

  it("audits self-service profile updates", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:self",
      user: { _id: "users:self" },
    } as never);
    const { ctx, get, insert } = makeCtx();
    get.mockResolvedValue({
      _id: "users:self",
      _creationTime: 1,
      handle: "self",
      displayName: "Old Name",
      bio: "Old bio",
      name: "self",
      createdAt: 1,
    });

    await updateProfileHandler(ctx, {
      displayName: "New Name",
      bio: "New bio",
    });

    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.profile.update",
        actorUserId: "users:self",
        targetType: "user",
        targetId: "users:self",
        metadata: {
          previous: { displayName: "Old Name", bio: "Old bio" },
          next: { displayName: "New Name", bio: "New bio" },
        },
      }),
    );
  });

  it("saves profile changes when personal publisher handle sync conflicts", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:self",
      user: { _id: "users:self" },
    } as never);
    const { ctx, get, insert, patch, query } = makeCtx();
    get.mockResolvedValue({
      _id: "users:self",
      _creationTime: 1,
      handle: "claimed",
      displayName: "Old Name",
      bio: "Old bio",
      name: "claimed",
      createdAt: 1,
    });
    query.mockImplementation(((table: string) => {
      if (table === "publishers") {
        return {
          withIndex: (name: string) => {
            if (name === "by_linked_user") {
              return { unique: vi.fn(async () => null) };
            }
            if (name === "by_handle") {
              return {
                unique: vi.fn(async () => ({
                  _id: "publishers:claimed",
                  _creationTime: 1,
                  kind: "user",
                  handle: "claimed",
                  displayName: "Other User",
                  linkedUserId: "users:other",
                  createdAt: 1,
                  updatedAt: 1,
                })),
              };
            }
            throw new Error(`Unexpected publishers index ${name}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never);

    await updateProfileHandler(ctx, {
      displayName: "New Name",
      bio: "New bio",
    });

    expect(patch).toHaveBeenCalledWith(
      "users:self",
      expect.objectContaining({
        displayName: "New Name",
        bio: "New bio",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({ action: "user.profile.update" }),
    );
    expect(insert).not.toHaveBeenCalledWith("publishers", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("publisherMembers", expect.anything());
  });

  it("audits self-service account deletion", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:self",
      user: { _id: "users:self" },
    } as never);
    const { ctx, get, insert, query } = makeCtx();
    const runMutation = vi.fn();
    (ctx as { runMutation?: typeof runMutation }).runMutation = runMutation;
    get.mockResolvedValue({
      _id: "users:self",
      handle: "self",
      displayName: "Self",
      name: "self",
      email: "self@example.com",
      personalPublisherId: "publishers:self",
    });
    query.mockImplementation(((table: string) => {
      if (table === "apiTokens") {
        return {
          withIndex: () => ({
            collect: vi.fn(async () => []),
          }),
        };
      }
      if (table === "authAccounts" || table === "authSessions") {
        return {
          withIndex: () => ({
            collect: vi.fn(async () => []),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never);

    await deleteAccountHandler(ctx, {});

    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.delete",
        actorUserId: "users:self",
        targetType: "user",
        targetId: "users:self",
        metadata: expect.objectContaining({
          previous: expect.objectContaining({
            handle: "self",
            emailPresent: true,
            personalPublisherId: "publishers:self",
          }),
        }),
      }),
    );
  });
});

describe("users.purgeSelfDeletedAccountRecoveryBatchInternal", () => {
  it("dry-runs eligible self-deleted account candidates with reviewable metadata", async () => {
    const users = [
      {
        _id: "users:self-deleted",
        _creationTime: 1,
        deactivatedAt: 1_700_000_000_000,
        purgedAt: 1_700_000_000_000,
        deletedAt: undefined,
        handle: undefined,
        displayName: undefined,
        email: undefined,
        personalPublisherId: "publishers:self-deleted",
      },
      {
        _id: "users:banned",
        _creationTime: 2,
        deactivatedAt: 1_700_000_000_001,
        purgedAt: 1_700_000_000_001,
        deletedAt: undefined,
        banReason: "bulk publishing spam",
      },
    ];
    const logsByUser = new Map([
      [
        "users:self-deleted",
        [
          {
            _id: "auditLogs:self-delete",
            _creationTime: 3,
            actorUserId: "users:self-deleted",
            action: "user.delete",
            targetType: "user",
            targetId: "users:self-deleted",
            createdAt: 1_700_000_000_000,
            metadata: {
              previous: {
                handle: "octo",
                displayName: "Octo User",
                emailPresent: true,
                personalPublisherId: "publishers:self-deleted",
              },
            },
          },
        ],
      ],
      [
        "users:banned",
        [
          {
            _id: "auditLogs:ban",
            actorUserId: "users:admin",
            action: "user.ban",
            targetType: "user",
            targetId: "users:banned",
          },
        ],
      ],
    ]);
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi.fn();
    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_deactivated_purged_at") {
              throw new Error(`Unexpected users index ${indexName}`);
            }
            return {
              paginate: vi.fn(async () => ({
                page: users,
                isDone: true,
                continueCursor: "",
              })),
            };
          }),
        };
      }
      if (table === "auditLogs") {
        return {
          withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, string> = {};
            const q = {
              eq: (field: string, value: string) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            return {
              collect: vi.fn(async () => logsByUser.get(fields.targetId) ?? []),
            };
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = (await purgeSelfDeletedAccountRecoveryBatchInternalHandler(
      {
        db: { query, patch, insert, delete: vi.fn(), get: vi.fn(), normalizeId: vi.fn() },
        runMutation,
      } as never,
      { dryRun: true, mode: "deactivated", limit: 10 },
    )) as {
      dryRun: boolean;
      eligible: number;
      purged: number;
      candidates: Array<Record<string, unknown>>;
      skipped: Array<Record<string, unknown>>;
    };

    expect(result).toMatchObject({
      dryRun: true,
      eligible: 1,
      purged: 0,
      candidates: [
        {
          userId: "users:self-deleted",
          handle: "octo",
          displayName: "Octo User",
          emailPresent: true,
          personalPublisherId: "publishers:self-deleted",
          deactivatedAt: 1_700_000_000_000,
          purgedAt: 1_700_000_000_000,
          selfDeleteAuditLogId: "auditLogs:self-delete",
        },
      ],
      skipped: [{ userId: "users:banned", reason: "not_self_deleted_or_security_blocked" }],
    });
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("skips already-cleaned self-delete tombstones without auth locks", async () => {
    const users = [
      {
        _id: "users:recovery-purged",
        _creationTime: 1,
        deactivatedAt: 1_700_000_000_000,
        purgedAt: 1_700_000_000_000,
        deletedAt: undefined,
        banReason: undefined,
        handle: undefined,
        displayName: undefined,
        name: undefined,
        email: undefined,
        personalPublisherId: undefined,
      },
      {
        _id: "users:modern-cleanup",
        _creationTime: 2,
        deactivatedAt: 1_700_000_000_001,
        purgedAt: 1_700_000_000_001,
        deletedAt: undefined,
        banReason: undefined,
        handle: undefined,
        displayName: undefined,
        name: undefined,
        email: undefined,
        personalPublisherId: undefined,
      },
    ];
    const logsByUser = new Map([
      [
        "users:recovery-purged",
        [
          {
            _id: "auditLogs:self-delete",
            actorUserId: "users:recovery-purged",
            action: "user.delete",
            targetType: "user",
            targetId: "users:recovery-purged",
            metadata: { previous: { handle: "gone" } },
          },
          {
            _id: "auditLogs:recovery-purge",
            actorUserId: "users:recovery-purged",
            action: "user.recovery_purge",
            targetType: "user",
            targetId: "users:recovery-purged",
            metadata: { source: "backfill" },
          },
        ],
      ],
      [
        "users:modern-cleanup",
        [
          {
            _id: "auditLogs:modern-delete",
            actorUserId: "users:modern-cleanup",
            action: "user.delete",
            targetType: "user",
            targetId: "users:modern-cleanup",
            metadata: { cleanup: { authAccounts: 1 } },
          },
        ],
      ],
    ]);
    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_deactivated_purged_at") {
              throw new Error(`Unexpected users index ${indexName}`);
            }
            return {
              paginate: vi.fn(async () => ({
                page: users,
                isDone: true,
                continueCursor: "",
              })),
            };
          }),
        };
      }
      if (table === "auditLogs") {
        return {
          withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, string> = {};
            const q = {
              eq: (field: string, value: string) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            return {
              collect: vi.fn(async () => logsByUser.get(fields.targetId) ?? []),
            };
          }),
        };
      }
      if (table === "authAccounts") {
        return {
          withIndex: vi.fn((_indexName: string) => ({
            collect: vi.fn(async () => []),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = (await purgeSelfDeletedAccountRecoveryBatchInternalHandler(
      {
        db: {
          query,
          patch: vi.fn(),
          insert: vi.fn(),
          delete: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
        },
        runMutation: vi.fn(),
      } as never,
      { dryRun: true, mode: "deactivated", limit: 10 },
    )) as {
      dryRun: boolean;
      eligible: number;
      candidates: Array<Record<string, unknown>>;
      skipped: Array<Record<string, unknown>>;
    };

    expect(result).toMatchObject({
      dryRun: true,
      eligible: 0,
      candidates: [],
      skipped: [
        { userId: "users:recovery-purged", reason: "not_self_deleted_or_security_blocked" },
        { userId: "users:modern-cleanup", reason: "not_self_deleted_or_security_blocked" },
      ],
    });
  });

  it("dry-runs auth-locked purged users without self-delete audit proof", async () => {
    const users = [
      {
        _id: "users:auth-locked",
        _creationTime: 1,
        deactivatedAt: 1_700_000_000_000,
        purgedAt: 1_700_000_000_000,
        deletedAt: undefined,
        banReason: undefined,
        handle: undefined,
        displayName: undefined,
        name: undefined,
        email: undefined,
        personalPublisherId: undefined,
      },
      {
        _id: "users:active-publisher",
        _creationTime: 2,
        deactivatedAt: 1_700_000_000_001,
        purgedAt: 1_700_000_000_001,
        deletedAt: undefined,
        banReason: undefined,
        handle: undefined,
        displayName: undefined,
        name: undefined,
        email: undefined,
        personalPublisherId: "publishers:active",
      },
    ];
    const authAccountsByUser = new Map([
      [
        "users:auth-locked",
        [
          {
            _id: "authAccounts:github",
            userId: "users:auth-locked",
            provider: "github",
            providerAccountId: "550978",
          },
        ],
      ],
      [
        "users:active-publisher",
        [
          {
            _id: "authAccounts:active-publisher",
            userId: "users:active-publisher",
            provider: "github",
            providerAccountId: "123",
          },
        ],
      ],
    ]);
    const patch = vi.fn();
    const insert = vi.fn();
    const runMutation = vi.fn();
    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_deactivated_purged_at") {
              throw new Error(`Unexpected users index ${indexName}`);
            }
            return {
              paginate: vi.fn(async () => ({
                page: users,
                isDone: true,
                continueCursor: "",
              })),
            };
          }),
        };
      }
      if (table === "auditLogs") {
        return {
          withIndex: vi.fn((_indexName: string) => ({
            collect: vi.fn(async () => []),
          })),
        };
      }
      if (table === "authAccounts") {
        return {
          withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, string> = {};
            const q = {
              eq: (field: string, value: string) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            return {
              collect: vi.fn(async () => authAccountsByUser.get(fields.userId) ?? []),
            };
          }),
        };
      }
      if (table === "publishers") {
        return {
          withIndex: vi.fn((_indexName: string) => ({
            unique: vi.fn(async () => null),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = (await purgeSelfDeletedAccountRecoveryBatchInternalHandler(
      {
        db: {
          query,
          patch,
          insert,
          delete: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
        },
        runMutation,
      } as never,
      { dryRun: true, mode: "deactivated", limit: 10 },
    )) as {
      dryRun: boolean;
      eligible: number;
      purged: number;
      candidates: Array<Record<string, unknown>>;
      skipped: Array<Record<string, unknown>>;
    };

    expect(result).toMatchObject({
      dryRun: true,
      eligible: 2,
      purged: 0,
      candidates: [
        {
          userId: "users:auth-locked",
          eligibilityReason: "auth_locked_purged_user",
          authAccountCount: 1,
          handle: null,
          displayName: null,
          emailPresent: false,
          personalPublisherId: null,
          deactivatedAt: 1_700_000_000_000,
          purgedAt: 1_700_000_000_000,
          selfDeleteAuditLogId: null,
        },
        {
          userId: "users:active-publisher",
          eligibilityReason: "auth_locked_purged_user",
          authAccountCount: 1,
          personalPublisherId: "publishers:active",
          deactivatedAt: 1_700_000_000_001,
          purgedAt: 1_700_000_000_001,
          selfDeleteAuditLogId: null,
        },
      ],
      skipped: [],
    });
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("dry-runs auth-locked legacy deleted users without ban evidence", async () => {
    const users = [
      {
        _id: "users:legacy-deleted",
        _creationTime: 1,
        deletedAt: 1_700_000_000_000,
        deactivatedAt: undefined,
        purgedAt: undefined,
        banReason: undefined,
        handle: "legacy-user",
        displayName: "Legacy User",
        name: "Legacy User",
        email: "legacy@example.test",
        personalPublisherId: undefined,
      },
      {
        _id: "users:legacy-banned",
        _creationTime: 2,
        deletedAt: 1_700_000_000_001,
        deactivatedAt: undefined,
        purgedAt: undefined,
        banReason: undefined,
        handle: "legacy-banned",
        displayName: "Legacy Banned",
        name: "Legacy Banned",
        email: "legacy-banned@example.test",
        personalPublisherId: undefined,
      },
    ];
    const logsByUser = new Map([
      [
        "users:legacy-banned",
        [
          {
            _id: "auditLogs:ban",
            actorUserId: "users:admin",
            action: "user.ban",
            targetType: "user",
            targetId: "users:legacy-banned",
          },
        ],
      ],
    ]);
    const authAccountsByUser = new Map([
      [
        "users:legacy-deleted",
        [
          {
            _id: "authAccounts:legacy",
            userId: "users:legacy-deleted",
            provider: "github",
            providerAccountId: "1175050",
          },
        ],
      ],
      [
        "users:legacy-banned",
        [
          {
            _id: "authAccounts:banned",
            userId: "users:legacy-banned",
            provider: "github",
            providerAccountId: "2",
          },
        ],
      ],
    ]);
    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_ban_reason_deleted_at") {
              throw new Error(`Unexpected users index ${indexName}`);
            }
            return {
              paginate: vi.fn(async () => ({
                page: users,
                isDone: true,
                continueCursor: "",
              })),
            };
          }),
        };
      }
      if (table === "auditLogs") {
        return {
          withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, string> = {};
            const q = {
              eq: (field: string, value: string) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            return {
              collect: vi.fn(async () => logsByUser.get(fields.targetId) ?? []),
            };
          }),
        };
      }
      if (table === "authAccounts") {
        return {
          withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, string> = {};
            const q = {
              eq: (field: string, value: string) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            return {
              collect: vi.fn(async () => authAccountsByUser.get(fields.userId) ?? []),
            };
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = (await purgeSelfDeletedAccountRecoveryBatchInternalHandler(
      {
        db: {
          query,
          patch: vi.fn(),
          insert: vi.fn(),
          delete: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
        },
        runMutation: vi.fn(),
      } as never,
      { dryRun: true, mode: "legacyDeleted", limit: 10 },
    )) as {
      dryRun: boolean;
      eligible: number;
      purged: number;
      candidates: Array<Record<string, unknown>>;
      skipped: Array<Record<string, unknown>>;
    };

    expect(result).toMatchObject({
      dryRun: true,
      eligible: 1,
      purged: 0,
      candidates: [
        {
          userId: "users:legacy-deleted",
          eligibilityReason: "auth_locked_legacy_deleted_user",
          authAccountCount: 1,
          handle: "legacy-user",
          displayName: "Legacy User",
          emailPresent: true,
          deletedAt: 1_700_000_000_000,
          selfDeleteAuditLogId: null,
        },
      ],
      skipped: [{ userId: "users:legacy-banned", reason: "not_self_deleted_or_security_blocked" }],
    });
  });
});

describe("users.list", () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset();
  });

  it("uses take(limit) without full collect when search is empty", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [
      { _id: "users:1", _creationTime: 3, handle: "alice", role: "user" },
      { _id: "users:2", _creationTime: 2, handle: "bob", role: "user" },
      { _id: "users:3", _creationTime: 1, handle: "carol", role: "user" },
    ];
    const { ctx, take, collect } = makeListCtx(users);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    const result = (await listHandler(ctx, { limit: 2 })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(take).toHaveBeenCalledWith(2);
    expect(collect).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it("uses bounded scan for search instead of full collect", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [
      { _id: "users:1", _creationTime: 3, handle: "alice", role: "user" },
      { _id: "users:2", _creationTime: 2, handle: "bob", role: "user" },
      { _id: "users:3", _creationTime: 1, handle: "carol", role: "user" },
    ];
    const { ctx, take, collect } = makeListCtx(users);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    const result = (await listHandler(ctx, { limit: 50, search: "ali" })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(take).toHaveBeenCalledWith(500);
    expect(collect).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.handle).toBe("alice");
  });

  it("includes an exact older handle match outside the bounded scan", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [
      ...Array.from({ length: 500 }, (_value, index) => ({
        _id: `users:recent-${index}`,
        _creationTime: 10_000 - index,
        handle: `recent-${index}`,
        role: "user",
      })),
      { _id: "users:older", _creationTime: 1, handle: "alice", role: "user" },
    ];
    const { ctx, take, collect } = makeListCtx(users);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    const result = (await listHandler(ctx, { limit: 50, search: "alice" })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(take).toHaveBeenCalledWith(500);
    expect(collect).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items[0]?._id).toBe("users:older");
  });

  it("includes an exact personal publisher handle match without a full collect", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [{ _id: "users:1", _creationTime: 2, handle: "alice", role: "user" }];
    const { ctx, take, collect } = makeListCtx(users, {
      publishersByHandle: {
        lmlukef: {
          _id: "publishers:lmlukef",
          kind: "user",
          handle: "lmlukef",
          linkedUserId: "users:owner",
        },
      },
      usersById: {
        "users:owner": {
          _id: "users:owner",
          _creationTime: 1,
          handle: "luke",
          name: "different-gh-login",
          displayName: "Luke",
          role: "user",
        },
      },
    });
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    const result = (await listHandler(ctx, { limit: 50, search: "lmLukeF" })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(take).toHaveBeenCalledWith(500);
    expect(collect).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      _id: "users:owner",
      handle: "luke",
      displayName: "Luke",
    });
  });

  it("clamps large limit and search scan size", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = Array.from({ length: 8_000 }, (_value, index) => ({
      _id: `users:${index}`,
      _creationTime: 10_000 - index,
      handle: `user-${index}`,
      role: "user",
    }));
    const { ctx, take } = makeListCtx(users);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    await listHandler(ctx, { limit: 999, search: "user" });

    expect(take).toHaveBeenCalledWith(2_000);
  });

  it("handles malformed legacy user fields without throwing", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [
      {
        _id: "users:legacy",
        _creationTime: 99,
        handle: 123,
        name: { broken: true },
        displayName: null,
        email: ["legacy@example.com"],
        role: "user",
      },
      {
        _id: "users:2",
        _creationTime: 98,
        handle: "carol",
        role: "user",
      },
    ];
    const { ctx } = makeListCtx(users);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    await expect(listHandler(ctx, { limit: 50, search: "car" })).resolves.toMatchObject({
      total: 1,
      items: [{ _id: "users:2" }],
    });
  });

  it("includes an exact publisher-handle match even when the linked user is banned", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [
      {
        _id: "users:1",
        _creationTime: 3,
        handle: "different-login",
        displayName: "ClawGrid",
        deletedAt: 123,
        role: "user",
      },
      { _id: "users:2", _creationTime: 2, handle: "alice", role: "user" },
    ];
    const { ctx } = makeListCtx(users, {
      publishersByHandle: {
        clawgrid: {
          _id: "publishers:clawgrid",
          handle: "clawgrid",
          kind: "user",
          linkedUserId: "users:1",
        },
      },
      usersById: {
        "users:1": users[0]!,
      },
    });
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    await expect(listHandler(ctx, { limit: 10, search: "clawgrid" })).resolves.toMatchObject({
      total: 1,
      items: [{ _id: "users:1", deletedAt: 123 }],
    });
  });

  it("treats whitespace search as empty search", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [
      { _id: "users:1", _creationTime: 2, handle: "alice", role: "user" },
      { _id: "users:2", _creationTime: 1, handle: "bob", role: "user" },
    ];
    const { ctx, take, collect } = makeListCtx(users);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    const result = (await listHandler(ctx, { limit: 50, search: "   " })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(take).toHaveBeenCalledWith(50);
    expect(collect).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
  });

  it("clamps non-positive limit to one", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const users = [
      { _id: "users:1", _creationTime: 2, handle: "alice", role: "user" },
      { _id: "users:2", _creationTime: 1, handle: "bob", role: "user" },
    ];
    const { ctx, take } = makeListCtx(users);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    const result = (await listHandler(ctx, { limit: 0 })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(take).toHaveBeenCalledWith(1);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it("rejects non-admin actors", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:basic",
      user: { _id: "users:basic", role: "user" },
    } as never);
    const { ctx } = makeListCtx([]);
    const listHandler = (
      list as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;

    await expect(listHandler(ctx, { limit: 10 })).rejects.toThrow("Forbidden");
  });
});

describe("users.searchInternal", () => {
  it("rejects missing actor", async () => {
    const { ctx, get } = makeListCtx([]);
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;
    get.mockResolvedValue(null);

    await expect(handler(ctx, { actorUserId: "users:missing" })).rejects.toThrow("Unauthorized");
  });

  it("uses bounded scan and returns mapped fields", async () => {
    const users = [
      { _id: "users:1", _creationTime: 2, handle: "alice", name: "alice", role: "user" },
      { _id: "users:2", _creationTime: 1, handle: "bob", name: "bob", role: "moderator" },
    ];
    const { ctx, take, collect, get } = makeListCtx(users);
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;
    get.mockResolvedValue({ _id: "users:admin", role: "admin" });

    const result = (await handler(ctx, {
      actorUserId: "users:admin",
      query: "ali",
      limit: 25,
    })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(take).toHaveBeenCalledWith(500);
    expect(collect).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        userId: "users:1",
        handle: "alice",
        displayName: null,
        name: "alice",
        role: "user",
      },
    ]);
  });

  it("includes an exact personal publisher handle match in admin search", async () => {
    const users = [
      { _id: "users:1", _creationTime: 2, handle: "alice", name: "alice", role: "user" },
    ];
    const { ctx, get } = makeListCtx(users, {
      publishersByHandle: {
        lmlukef: {
          _id: "publishers:lmlukef",
          kind: "user",
          handle: "lmlukef",
          linkedUserId: "users:owner",
        },
      },
      usersById: {
        "users:owner": {
          _id: "users:owner",
          _creationTime: 1,
          handle: "luke",
          name: "different-gh-login",
          displayName: "Luke",
          role: "user",
        },
      },
    });
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;
    get.mockImplementation(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:owner") {
        return {
          _id: "users:owner",
          _creationTime: 1,
          handle: "luke",
          name: "different-gh-login",
          displayName: "Luke",
          role: "user",
        };
      }
      return null;
    });

    const result = (await handler(ctx, {
      actorUserId: "users:admin",
      query: "lmLukeF",
      limit: 25,
    })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      userId: "users:owner",
      handle: "luke",
      displayName: "Luke",
      name: "different-gh-login",
      role: "user",
    });
  });

  it("does not double-count total when the fallback user already matched off-page", async () => {
    const users = [
      {
        _id: "users:1",
        _creationTime: 3,
        handle: "lmquery-top",
        name: "lmquery-top",
        role: "user",
      },
      {
        _id: "users:2",
        _creationTime: 2,
        handle: "lmquery-mid",
        name: "lmquery-mid",
        role: "user",
      },
      {
        _id: "users:owner",
        _creationTime: 1,
        handle: "owner-lmquery",
        name: "owner-lmquery",
        displayName: "Owner Lmquery",
        role: "user",
      },
    ];
    const { ctx, get } = makeListCtx(users, {
      publishersByHandle: {
        lmquery: {
          _id: "publishers:lmquery",
          kind: "user",
          handle: "lmquery",
          linkedUserId: "users:owner",
        },
      },
      usersById: {
        "users:owner": users[2] as Record<string, unknown>,
      },
    });
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;
    get.mockImplementation(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:owner") return users[2] as Record<string, unknown>;
      return null;
    });

    const result = (await handler(ctx, {
      actorUserId: "users:admin",
      query: "lmquery",
      limit: 2,
    })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.userId)).toEqual(["users:owner", "users:1"]);
  });

  it("rejects deactivated actors", async () => {
    const { ctx, get } = makeListCtx([]);
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;
    get.mockResolvedValue({ _id: "users:ghost", role: "admin", deactivatedAt: Date.now() });

    await expect(handler(ctx, { actorUserId: "users:ghost" })).rejects.toThrow("Unauthorized");
  });

  it("rejects non-admin actors", async () => {
    const { ctx, get } = makeListCtx([]);
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;
    get.mockResolvedValue({ _id: "users:mod", role: "moderator" });

    await expect(handler(ctx, { actorUserId: "users:mod", query: "a" })).rejects.toThrow(
      "Forbidden",
    );
  });

  it("still caps empty-query listing and uses non-search path", async () => {
    const users = Array.from({ length: 400 }, (_value, index) => ({
      _id: `users:${index}`,
      _creationTime: 1_000 - index,
      handle: `user-${index}`,
      role: "user",
    }));
    const { ctx, take, collect, get } = makeListCtx(users);
    const handler = (
      searchInternal as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler;
    get.mockResolvedValue({ _id: "users:admin", role: "admin" });

    const result = (await handler(ctx, {
      actorUserId: "users:admin",
      limit: 999,
      query: "   ",
    })) as { items: Array<Record<string, unknown>>; total: number };

    expect(take).toHaveBeenCalledWith(200);
    expect(collect).not.toHaveBeenCalled();
    expect(result.total).toBe(200);
    expect(result.items).toHaveLength(200);
  });
});

describe("users.banUserInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not query retired skill comments during ban", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, insert, runMutation } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "moderator" };
      if (id === "users:target") return { _id: "users:target", role: "user" };
      return null;
    });

    runMutation
      .mockResolvedValueOnce({ hiddenCount: 2, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 0, revokedTokenCount: 0, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      banUserInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; targetUserId: string; reason?: string },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = (await handler(ctx, {
      actorUserId: "users:actor",
      targetUserId: "users:target",
      reason: "spam",
    })) as {
      ok: boolean;
      alreadyBanned: boolean;
      deletedSkillComments: number;
    };

    expect(result).toMatchObject({
      ok: true,
      alreadyBanned: false,
      deletedSkillComments: 0,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.ban",
        metadata: expect.objectContaining({
          deletedSkillComments: 0,
        }),
      }),
    );
  });

  it("schedules a public-safe ban notification email when the target has email", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "moderator" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      return null;
    });

    runMutation
      .mockResolvedValueOnce({ hiddenCount: 2, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 0, revokedTokenCount: 0, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      banUserInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; targetUserId: string; reason?: string },
        ) => Promise<unknown>;
      }
    )._handler;

    await handler(ctx, {
      actorUserId: "users:actor",
      targetUserId: "users:target",
      reason: "rate limit triggered by automated CLI publishing",
    });

    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:target",
      bannedAt: 1_700_000_000_000,
      to: "target@example.com",
      handle: "target-user",
      source: "manual",
      reason: "rate limit triggered by automated CLI publishing",
      hiddenArtifacts: 2,
    });
  });

  it("does not query retired skill comments when re-banning a deleted user", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, query, runMutation } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "moderator" };
      if (id === "users:target")
        return { _id: "users:target", role: "user", deletedAt: 1_600_000_000_000 };
      return null;
    });

    const handler = (
      banUserInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; targetUserId: string; reason?: string },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = (await handler(ctx, {
      actorUserId: "users:actor",
      targetUserId: "users:target",
      reason: "cleanup",
    })) as {
      ok: boolean;
      alreadyBanned: boolean;
      deletedSkillComments: number;
      deletedSkills: number;
    };

    expect(result).toEqual({
      ok: true,
      alreadyBanned: true,
      deletedSkills: 0,
      deletedSkillComments: 0,
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerUserId: "users:target",
        bannedAt: 1_600_000_000_000,
        deletedBy: "users:actor",
        deletedByRole: "moderator",
      }),
    );
    expect(query).not.toHaveBeenCalledWith("comments");
  });
});

describe("users.autobanMalwareAuthorInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules a malicious skill notification with trigger context", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 1, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 0, revokedTokenCount: 0, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanMalwareAuthorInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            sha256hash?: string;
            slug: string;
            trigger?: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await handler(ctx, {
      ownerUserId: "users:target",
      sha256hash: "abc123",
      slug: "gingiris-launch",
      trigger: "malicious.llm_malicious",
    });

    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:target",
      bannedAt: 1_700_000_000_000,
      to: "target@example.com",
      handle: "target-user",
      source: "autoban",
      reason: "malicious.llm_malicious",
      trigger: "malicious.llm_malicious",
      artifact: { kind: "skill", name: "gingiris-launch" },
      hiddenArtifacts: 1,
    });
  });
});

describe("users.autobanPublisherAbuseOwnerInternal", () => {
  function publisherAbuseAutobanNomination(fields: Record<string, unknown> = {}) {
    return {
      _id: "publisherAbuseReviewNominations:candidate",
      ownerKey: "publisher:publishers:candidate",
      ownerPublisherId: "publishers:candidate",
      ownerUserId: "users:target",
      latestScoreId: "publisherAbuseScores:candidate",
      label: "potential_ban_candidate",
      status: "pending",
      ...fields,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bans publisher abuse candidates with appeal email and audit context", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, patch, insert, query, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return { _id: "publishers:candidate", linkedUserId: "users:target" };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 3, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 2, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 3,
    });

    expect(patch).toHaveBeenCalledWith("users:target", {
      deletedAt: 1_700_000_000_000,
      role: "user",
      updatedAt: 1_700_000_000_000,
      banReason: "publisher_abuse: potential ban candidate",
    });
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        status: "banned",
        reviewedAt: 1_700_000_000_000,
        notes: "publisher_abuse: potential ban candidate",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        actorUserId: "users:target",
        action: "user.autoban.publisher_abuse",
        targetType: "user",
        targetId: "users:target",
        metadata: expect.objectContaining({
          nominationId: "publisherAbuseReviewNominations:candidate",
          scoreId: "publisherAbuseScores:candidate",
          reason: "publisher_abuse: potential ban candidate",
          hiddenSkills: 3,
          deletedPackages: 2,
        }),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:candidate",
        ownerKey: "publisher:publishers:candidate",
        scoreId: "publisherAbuseScores:candidate",
        eventType: "triage_status_changed",
        previousStatus: "pending",
        nextStatus: "banned",
        notes: "publisher_abuse: potential ban candidate",
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:target",
      bannedAt: 1_700_000_000_000,
      to: "target@example.com",
      handle: "target-user",
      source: "autoban",
      reason: "publisher_abuse: potential ban candidate",
      trigger: "publisher_abuse",
      hiddenArtifacts: 5,
    });
    expect(query).toHaveBeenCalledWith("apiTokens");
    expect(patch).toHaveBeenCalledWith("apiTokens:1", { revokedAt: 1_700_000_000_000 });
  });

  it("does not ban protected staff accounts", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "moderator",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return { _id: "publishers:candidate", linkedUserId: "users:target" };
      }
      return null;
    });

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: false, reason: "protected_role" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not ban when the publisher abuse nomination was relinked to another user", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return { _id: "publishers:candidate", linkedUserId: "users:new-owner" };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 3, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 2, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not ban when the publisher became official before final autoban", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx({
      officialPublisherIds: ["publishers:candidate"],
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return {
          _id: "publishers:candidate",
          kind: "user",
          linkedUserId: "users:target",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 3, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 2, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not ban when an org publisher gained a staff manager before final autoban", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx({
      publisherMembers: [
        {
          _id: "publisherMembers:staff-owner",
          publisherId: "publishers:candidate",
          userId: "users:staff-owner",
          role: "owner",
        },
      ],
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "users:staff-owner") {
        return {
          _id: "users:staff-owner",
          role: "admin",
          handle: "staff-owner",
          email: "staff@example.com",
        };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return {
          _id: "publishers:candidate",
          kind: "org",
          linkedUserId: "users:target",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 3, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 2, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("bans large non-staff org publisher candidates", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx({
      publisherMembers: [
        ...Array.from({ length: 101 }, (_, index) => ({
          _id: `publisherMembers:community-publisher-${index}`,
          publisherId: "publishers:candidate",
          userId: `users:community-publisher-${index}`,
          role: "publisher",
        })),
        {
          _id: "publisherMembers:community-admin",
          publisherId: "publishers:candidate",
          userId: "users:community-admin",
          role: "admin",
        },
      ],
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "users:community-admin") {
        return { _id: id, role: "user" };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return {
          _id: "publishers:candidate",
          kind: "org",
          linkedUserId: "users:target",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 3, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 2, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 3,
    });

    expect(patch).toHaveBeenCalledWith("users:target", {
      deletedAt: 1_700_000_000_000,
      role: "user",
      updatedAt: 1_700_000_000_000,
      banReason: "publisher_abuse: potential ban candidate",
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.autoban.publisher_abuse",
        targetType: "user",
        targetId: "users:target",
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:target",
      bannedAt: 1_700_000_000_000,
      to: "target@example.com",
      handle: "target-user",
      source: "autoban",
      reason: "publisher_abuse: potential ban candidate",
      trigger: "publisher_abuse",
      hiddenArtifacts: 5,
    });
  });

  it("does not ban when a staff org publisher manager is on a later page", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx({
      publisherMembers: Array.from({ length: 101 }, (_, index) => ({
        _id: `publisherMembers:community-admin-${index}`,
        publisherId: "publishers:candidate",
        userId: `users:community-admin-${index}`,
        role: "admin",
      })),
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "users:community-admin-100") {
        return { _id: id, role: "moderator" };
      }
      if (id.startsWith("users:community-admin-")) {
        return { _id: id, role: "user" };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return {
          _id: "publishers:candidate",
          kind: "org",
          linkedUserId: "users:target",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 3, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 2, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not ban when final staff-manager scan exhausts its budget", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx({
      publisherMembers: Array.from({ length: 1_001 }, (_, index) => ({
        _id: `publisherMembers:community-admin-${index}`,
        publisherId: "publishers:candidate",
        userId: `users:community-admin-${index}`,
        role: "admin",
      })),
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id.startsWith("users:community-admin-")) {
        return { _id: id, role: "user" };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return {
          _id: "publishers:candidate",
          kind: "org",
          linkedUserId: "users:target",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ hiddenCount: 3, scheduled: false })
      .mockResolvedValueOnce({ deletedCount: 2, revokedTokenCount: 1, scheduled: false })
      .mockResolvedValueOnce(undefined);

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("reruns package cleanup for already-banned publisher abuse owners", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
          deletedAt: 1_650_000_000_000,
        };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination();
      }
      if (id === "publishers:candidate") {
        return { _id: "publishers:candidate", linkedUserId: "users:target" };
      }
      return null;
    });
    runMutation.mockResolvedValue({ deletedCount: 1, revokedTokenCount: 1, scheduled: false });

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: true, alreadyBanned: true });

    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "users:target",
      bannedAt: 1_650_000_000_000,
      deletedBy: "users:target",
      deletedByRole: "user",
      cursor: undefined,
    });
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:candidate",
      expect.objectContaining({
        status: "banned",
        reviewedAt: expect.any(Number),
        notes: "publisher_abuse: potential ban candidate",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseReviewEvents",
      expect.objectContaining({
        nominationId: "publisherAbuseReviewNominations:candidate",
        previousStatus: "pending",
        nextStatus: "banned",
      }),
    );
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not ban when the publisher abuse nomination is no longer pending", async () => {
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      if (id === "publisherAbuseReviewNominations:candidate") {
        return publisherAbuseAutobanNomination({ status: "reviewed_no_action" });
      }
      if (id === "publishers:candidate") {
        return { _id: "publishers:candidate", linkedUserId: "users:target" };
      }
      return null;
    });

    const handler = (
      autobanPublisherAbuseOwnerInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            nominationId: string;
            scoreId: string;
            reason: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        ownerUserId: "users:target",
        nominationId: "publisherAbuseReviewNominations:candidate",
        scoreId: "publisherAbuseScores:candidate",
        reason: "publisher_abuse: potential ban candidate",
      }),
    ).resolves.toEqual({ ok: false, reason: "nomination_not_actionable" });

    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });
});

describe("users.recordMaliciousArtifactFindingInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emails artifact-level remediation without banning on the first malicious finding", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, insert, runMutation, runAfter } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      return null;
    });

    const handler = (
      recordMaliciousArtifactFindingInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            artifactKind: "skill" | "plugin";
            artifactName: string;
            version?: string;
            trigger?: string;
            sha256hash?: string;
            findingSummary?: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      ownerUserId: "users:target",
      artifactKind: "skill",
      artifactName: "demo-skill",
      version: "1.0.0",
      trigger: "malicious.llm_malicious",
      sha256hash: "abc123",
      findingSummary: "Attempts to exfiltrate credentials.",
    });

    expect(result).toMatchObject({ ok: true, escalated: false });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        actorUserId: "users:target",
        action: "user.malicious_artifact.finding",
        targetType: "user",
        targetId: "users:target",
        metadata: expect.objectContaining({
          artifactKind: "skill",
          artifactName: "demo-skill",
          version: "1.0.0",
          trigger: "malicious.llm_malicious",
          sha256hash: "abc123",
          findingSummary: "Attempts to exfiltrate credentials.",
        }),
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:target",
      findingAt: 1_700_000_000_000,
      to: "target@example.com",
      handle: "target-user",
      artifact: { kind: "skill", name: "demo-skill" },
      version: "1.0.0",
      trigger: "malicious.llm_malicious",
      findingSummary: "Attempts to exfiltrate credentials.",
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("escalates to account ban on the third malicious attempt for one artifact", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, runMutation, runAfter } = makeBanCtx({
      auditLogs: [
        {
          action: "user.malicious_artifact.finding",
          targetType: "user",
          targetId: "users:target",
          metadata: { artifactKind: "skill", artifactName: "demo-skill" },
          createdAt: 1_699_999_000_000,
        },
        {
          action: "user.malicious_artifact.finding",
          targetType: "user",
          targetId: "users:target",
          metadata: { artifactKind: "skill", artifactName: "demo-skill" },
          createdAt: 1_699_998_000_000,
        },
      ],
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      return null;
    });
    runMutation.mockResolvedValue({ ok: true, alreadyBanned: false });

    const handler = (
      recordMaliciousArtifactFindingInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            artifactKind: "skill" | "plugin";
            artifactName: string;
            version?: string;
            trigger?: string;
            sha256hash?: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      ownerUserId: "users:target",
      artifactKind: "skill",
      artifactName: "demo-skill",
      version: "1.0.2",
      trigger: "malicious.llm_malicious",
    });

    expect(result).toMatchObject({ ok: true, escalated: true, reason: "attempt_threshold" });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "users:target",
      slug: "demo-skill",
      trigger: "malicious.llm_malicious",
      artifactKind: "skill",
      artifactName: "demo-skill",
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not escalate on the second malicious attempt for one artifact", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, runMutation } = makeBanCtx({
      auditLogs: [
        {
          action: "user.malicious_artifact.finding",
          targetType: "user",
          targetId: "users:target",
          metadata: { artifactKind: "skill", artifactName: "demo-skill" },
          createdAt: 1_699_999_000_000,
        },
      ],
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      return null;
    });

    const handler = (
      recordMaliciousArtifactFindingInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            artifactKind: "skill" | "plugin";
            artifactName: string;
            version?: string;
            trigger?: string;
            sha256hash?: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      ownerUserId: "users:target",
      artifactKind: "skill",
      artifactName: "demo-skill",
      version: "1.0.1",
      trigger: "malicious.llm_malicious",
    });

    expect(result).toMatchObject({ ok: true, escalated: false });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("escalates to account ban on the second distinct malicious artifact", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, runMutation, runAfter } = makeBanCtx({
      auditLogs: [
        {
          action: "user.malicious_artifact.finding",
          targetType: "user",
          targetId: "users:target",
          metadata: { artifactKind: "skill", artifactName: "first-skill" },
          createdAt: 1_699_999_000_000,
        },
      ],
    });

    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
        };
      }
      return null;
    });
    runMutation.mockResolvedValue({ ok: true, alreadyBanned: false });

    const handler = (
      recordMaliciousArtifactFindingInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            ownerUserId: string;
            artifactKind: "skill" | "plugin";
            artifactName: string;
            version?: string;
            trigger?: string;
            sha256hash?: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      ownerUserId: "users:target",
      artifactKind: "plugin",
      artifactName: "@scope/second-plugin",
      version: "1.0.0",
      trigger: "malicious.llm_malicious",
    });

    expect(result).toMatchObject({
      ok: true,
      escalated: true,
      reason: "distinct_artifact_threshold",
    });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "users:target",
      slug: "@scope/second-plugin",
      trigger: "malicious.llm_malicious",
      artifactKind: "plugin",
      artifactName: "@scope/second-plugin",
    });
    expect(runAfter).not.toHaveBeenCalled();
  });
});

describe("users.unbanUserForBanAppealServiceInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores ban-hidden skills and packages for accepted appeals", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx({
      auditLogs: [
        {
          _id: "auditLogs:ban",
          action: "user.ban",
          targetType: "user",
          targetId: "users:target",
          createdAt: 1_700_000_000_000,
        },
      ],
    });
    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
          deletedAt: 1_700_000_000_000,
          deactivatedAt: undefined,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ restoredCount: 5, scheduled: false })
      .mockResolvedValueOnce({ restoredCount: 2, scheduled: true });

    const handler = (
      unbanUserForBanAppealServiceInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { targetUserId: string; reason?: string; reviewerDiscordId: string },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      targetUserId: "users:target",
      reason: "appeal accepted",
      reviewerDiscordId: "discord-reviewer-1",
    });

    expect(patch).toHaveBeenCalledWith("users:target", {
      deletedAt: undefined,
      banReason: undefined,
      role: "user",
      updatedAt: 1_700_000_100_000,
    });
    expect(runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      ownerUserId: "users:target",
      bannedAt: 1_700_000_000_000,
      cursor: undefined,
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      ownerUserId: "users:target",
      bannedAt: 1_700_000_000_000,
      cursor: undefined,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.unban",
        targetType: "user",
        targetId: "users:target",
        metadata: expect.objectContaining({
          reason: "appeal accepted",
          restoredSkills: 5,
          restoredPackages: 2,
          scheduledPackages: true,
          source: "ban_appeal.service",
          reviewerDiscordId: "discord-reviewer-1",
        }),
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:target",
      restoredAt: 1_700_000_100_000,
      to: "target@example.com",
      handle: "target-user",
      restoredListings: undefined,
      skillsRestored: 5,
      packagesRestored: undefined,
    });
    expect(result).toEqual({
      ok: true,
      alreadyUnbanned: false,
      restoredSkills: 5,
      scheduledSkills: false,
      restoredPackages: 2,
      scheduledPackages: true,
    });
  });

  it("restores publisher-abuse autobans for accepted appeals", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const { ctx, get, patch, insert, runMutation, runAfter } = makeBanCtx({
      auditLogs: [
        {
          _id: "auditLogs:publisher-abuse-ban",
          action: "user.autoban.publisher_abuse",
          targetType: "user",
          targetId: "users:target",
          createdAt: 1_700_000_000_000,
        },
      ],
    });
    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "target-user",
          email: "target@example.com",
          deletedAt: 1_700_000_000_000,
          deactivatedAt: undefined,
          banReason: "publisher_abuse: potential ban candidate",
        };
      }
      return null;
    });
    runMutation
      .mockResolvedValueOnce({ restoredCount: 3, scheduled: false })
      .mockResolvedValueOnce({ restoredCount: 0, scheduled: false });

    const handler = (
      unbanUserForBanAppealServiceInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { targetUserId: string; reason?: string; reviewerDiscordId: string },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        targetUserId: "users:target",
        reason: "publisher abuse appeal accepted",
        reviewerDiscordId: "discord-reviewer-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyUnbanned: false,
      restoredSkills: 3,
    });
    expect(patch).toHaveBeenCalledWith("users:target", {
      deletedAt: undefined,
      banReason: undefined,
      role: "user",
      updatedAt: 1_700_000_100_000,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.unban",
        targetId: "users:target",
        metadata: expect.objectContaining({
          source: "ban_appeal.service",
          reason: "publisher abuse appeal accepted",
        }),
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      userId: "users:target",
      restoredAt: 1_700_000_100_000,
      to: "target@example.com",
      handle: "target-user",
      restoredListings: undefined,
      skillsRestored: 3,
      packagesRestored: 0,
    });
  });

  it("rejects deleted accounts without a matching ban audit", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const { ctx, get, patch, insert, runMutation } = makeBanCtx();
    get.mockImplementation(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          deletedAt: 1_700_000_000_000,
          deactivatedAt: undefined,
        };
      }
      return null;
    });

    const handler = (
      unbanUserForBanAppealServiceInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { targetUserId: string; reason?: string; reviewerDiscordId: string },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        targetUserId: "users:target",
        reason: "appeal accepted",
        reviewerDiscordId: "discord-reviewer-1",
      }),
    ).rejects.toThrow("Cannot unban account without a matching ban record");

    expect(patch).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("users.reclassifyBanInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-runs a ban reason reclassification without patching or auditing", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, patch, insert } = makeBanCtx();
    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "hanxueyuan",
          deletedAt: 1_600_000_000_000,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });

    const handler = (
      reclassifyBanInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            actorUserId: string;
            targetUserId: string;
            reason: string;
            dryRun?: boolean;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      actorUserId: "users:actor",
      targetUserId: "users:target",
      reason: "bulk publishing spam",
      dryRun: true,
    });

    expect(result).toEqual({
      ok: true,
      dryRun: true,
      userId: "users:target",
      handle: "hanxueyuan",
      previousReason: "malware auto-ban",
      nextReason: "bulk publishing spam",
      changed: true,
    });
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("applies a ban reason reclassification with an audit log", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, patch, insert } = makeBanCtx();
    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "hanxueyuan",
          deletedAt: 1_600_000_000_000,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });

    const handler = (
      reclassifyBanInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            actorUserId: string;
            targetUserId: string;
            reason: string;
            dryRun?: boolean;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      actorUserId: "users:actor",
      targetUserId: "users:target",
      reason: "bulk publishing spam",
      dryRun: false,
    });

    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      userId: "users:target",
      previousReason: "malware auto-ban",
      nextReason: "bulk publishing spam",
      changed: true,
    });
    expect(patch).toHaveBeenCalledWith("users:target", {
      banReason: "bulk publishing spam",
      updatedAt: 1_700_000_000_000,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.ban.reclassify",
        targetType: "user",
        targetId: "users:target",
        metadata: {
          previousReason: "malware auto-ban",
          nextReason: "bulk publishing spam",
        },
      }),
    );
  });

  it("rejects unbanned users", async () => {
    const { ctx, get } = makeBanCtx();
    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "admin" };
      if (id === "users:target") return { _id: "users:target", role: "user" };
      return null;
    });

    const handler = (
      reclassifyBanInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; targetUserId: string; reason: string },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        actorUserId: "users:actor",
        targetUserId: "users:target",
        reason: "bulk publishing spam",
      }),
    ).rejects.toThrow(/not currently banned/i);
  });
});

describe("users.placeUserUnderModerationInternal", () => {
  it("marks the user and hides owned skills", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const patch = vi.fn();
    const insert = vi.fn();
    const get = vi.fn(async (id: string) => {
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "badguy",
          deletedAt: undefined,
          deactivatedAt: undefined,
          requiresModerationAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn(async () => ({ hiddenCount: 3, scheduled: false }));

    const handler = (
      placeUserUnderModerationInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { ownerUserId: string; slug: string; reason: string },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = (await handler(
      {
        db: {
          get,
          patch,
          insert,
          delete: vi.fn(),
          replace: vi.fn(),
          query: vi.fn(),
          normalizeId: vi.fn(),
        },
        runMutation,
      } as never,
      {
        ownerUserId: "users:target",
        slug: "bad-skill",
        reason: "malicious.install_terminal_payload",
      },
    )) as {
      ok: boolean;
      alreadyModerated: boolean;
      hiddenSkills: number;
    };

    expect(result).toEqual({
      ok: true,
      alreadyModerated: false,
      hiddenSkills: 3,
      scheduledSkills: false,
    });
    expect(patch).toHaveBeenCalledWith("users:target", {
      requiresModerationAt: 1_700_000_000_000,
      requiresModerationReason:
        "Auto-held for moderation after malicious upload (malicious.install_terminal_payload)",
      updatedAt: 1_700_000_000_000,
    });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "users:target",
      hiddenAt: 1_700_000_000_000,
      cursor: undefined,
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.moderation.auto",
        metadata: expect.objectContaining({
          slug: "bad-skill",
          reason: "malicious.install_terminal_payload",
          hiddenSkills: 3,
        }),
      }),
    );
  });
});

describe("users.reserveHandleInternal", () => {
  it("reserves a handle for the rightful owner", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, insert, query } = makeCtx();
    get.mockImplementation(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:owner") return { _id: "users:owner", role: "user" };
      return null;
    });
    query.mockImplementation(((table: string) => {
      if (table === "reservedHandles") {
        return {
          withIndex: (name: string) => {
            if (name !== "by_handle_active_updatedAt") {
              throw new Error(`Unexpected reservedHandles index ${name}`);
            }
            return { order: () => ({ take: async () => [] }) };
          },
        };
      }
      if (table === "users") {
        return {
          withIndex: (name: string) => {
            if (name !== "handle") throw new Error(`Unexpected users index ${name}`);
            return { unique: vi.fn(async () => null) };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never);

    const handler = (
      reserveHandleInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            actorUserId: string;
            handle: string;
            rightfulOwnerUserId: string;
            reason?: string;
          },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(ctx, {
      actorUserId: "users:admin",
      handle: "OpenClaw",
      rightfulOwnerUserId: "users:owner",
      reason: "official org",
    });

    expect(result).toEqual({
      ok: true,
      handle: "openclaw",
      rightfulOwnerUserId: "users:owner",
    });
    expect(insert).toHaveBeenCalledWith(
      "reservedHandles",
      expect.objectContaining({
        handle: "openclaw",
        rightfulOwnerUserId: "users:owner",
        reason: "official org",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "handle.reserve",
        targetId: "openclaw",
      }),
    );
  });
});

describe("users.liftModerationHoldInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the moderation hold and restores skills", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const patch = vi.fn();
    const insert = vi.fn();
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") {
        return {
          _id: "users:admin",
          role: "admin",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "security-researcher",
          deletedAt: undefined,
          deactivatedAt: undefined,
          requiresModerationAt: 1_700_000_000_000,
          requiresModerationReason:
            "Auto-held for moderation after malicious upload (malicious.install_terminal_payload)",
        };
      }
      return null;
    });
    const runMutation = vi.fn(async () => ({ restoredCount: 5, scheduled: false }));

    const handler = (
      liftModerationHoldInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; targetUserId: string; reason?: string },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = (await handler(
      {
        db: {
          get,
          patch,
          insert,
          delete: vi.fn(),
          replace: vi.fn(),
          query: vi.fn(),
          normalizeId: vi.fn(),
        },
        runMutation,
      } as never,
      {
        actorUserId: "users:admin",
        targetUserId: "users:target",
        reason: "False positive from security tool scanning",
      },
    )) as {
      ok: boolean;
      alreadyCleared: boolean;
      restoredSkills: number;
      scheduledSkills: boolean;
    };

    expect(result).toEqual({
      ok: true,
      alreadyCleared: false,
      restoredSkills: 5,
      scheduledSkills: false,
    });

    // Verify hold was cleared
    expect(patch).toHaveBeenCalledWith("users:target", {
      requiresModerationAt: undefined,
      requiresModerationReason: undefined,
      updatedAt: 1_700_000_100_000,
    });

    // Verify skill restoration was triggered with holdPlacedAt for race-condition safety
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "users:target",
      holdPlacedAt: 1_700_000_000_000,
      cursor: undefined,
    });

    // Verify audit log
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        actorUserId: "users:admin",
        action: "user.moderation.lift",
        targetType: "user",
        targetId: "users:target",
        metadata: expect.objectContaining({
          reason: "False positive from security tool scanning",
          holdPlacedAt: 1_700_000_000_000,
          restoredSkills: 5,
        }),
      }),
    );
  });

  it("returns early when user has no moderation hold", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const patch = vi.fn();
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") {
        return {
          _id: "users:admin",
          role: "admin",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          deletedAt: undefined,
          deactivatedAt: undefined,
          requiresModerationAt: undefined,
        };
      }
      return null;
    });

    const handler = (
      liftModerationHoldInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; targetUserId: string },
        ) => Promise<unknown>;
      }
    )._handler;

    const result = (await handler(
      {
        db: {
          get,
          patch,
          insert: vi.fn(),
          delete: vi.fn(),
          replace: vi.fn(),
          query: vi.fn(),
          normalizeId: vi.fn(),
        },
        runMutation: vi.fn(),
      } as never,
      {
        actorUserId: "users:admin",
        targetUserId: "users:target",
      },
    )) as { ok: boolean; alreadyCleared: boolean };

    expect(result).toEqual({
      ok: true,
      alreadyCleared: true,
      restoredSkills: 0,
      scheduledSkills: false,
    });

    // Verify no patches were made
    expect(patch).not.toHaveBeenCalled();
  });

  it("throws when actor is not admin", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "users:mod") {
        return {
          _id: "users:mod",
          role: "moderator",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      return null;
    });

    const handler = (
      liftModerationHoldInternal as unknown as {
        _handler: (
          ctx: unknown,
          args: { actorUserId: string; targetUserId: string },
        ) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        {
          db: {
            get,
            patch: vi.fn(),
            insert: vi.fn(),
            delete: vi.fn(),
            replace: vi.fn(),
            query: vi.fn(),
            normalizeId: vi.fn(),
          },
          runMutation: vi.fn(),
        } as never,
        { actorUserId: "users:mod", targetUserId: "users:target" },
      ),
    ).rejects.toThrow();
  });
});
