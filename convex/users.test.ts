import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("./lib/access", async () => {
  const actual = await vi.importActual<typeof import("./lib/access")>("./lib/access");
  return { ...actual, requireUser: vi.fn() };
});

vi.mock("./skillStatEvents", () => ({
  insertStatEvent: vi.fn(),
}));

const { requireUser } = await import("./lib/access");
const { getAuthUserId } = await import("@convex-dev/auth/server");
const { insertStatEvent } = await import("./skillStatEvents");
const {
  ensureHandler,
  getByHandle,
  list,
  searchInternal,
  banUserInternal,
  me,
  placeUserUnderModerationInternal,
  reserveHandleInternal,
  syncGitHubProfileInternal,
} = await import("./users");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const meHandler = (me as unknown as WrappedHandler<Record<string, never>, unknown>)._handler;
const getByHandleHandler = (
  getByHandle as unknown as WrappedHandler<{ handle: string }, unknown>
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
        withIndex: (name: string, cb?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
          if (name !== "handle") throw new Error(`Unexpected users index ${name}`);
          let handle = "";
          cb?.({
            eq: (field: string, value: string) => {
              if (field === "handle") handle = value;
              return {};
            },
          });
          return { unique: vi.fn(async () => users.find((user) => user.handle === handle) ?? null) };
        },
      };
    }
    if (table === "publishers") {
      return {
        withIndex: (name: string, cb?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
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

function makeBanCtx() {
  const patch = vi.fn();
  const insert = vi.fn();
  const get = vi.fn();
  const runMutation = vi.fn();
  const apiTokens = [{ _id: "apiTokens:1", revokedAt: undefined }];
  const userComments = [
    {
      _id: "comments:active",
      userId: "users:target",
      skillId: "skills:1",
      softDeletedAt: undefined,
    },
    {
      _id: "comments:already-deleted",
      userId: "users:target",
      skillId: "skills:1",
      softDeletedAt: 123,
    },
  ];
  const soulComments = [
    {
      _id: "soulComments:active",
      userId: "users:target",
      soulId: "souls:1",
      softDeletedAt: undefined,
    },
  ];

  const query = vi.fn((table: string) => ({
    withIndex: (_index: string, _cb: unknown) => {
      if (table === "apiTokens") return { collect: vi.fn().mockResolvedValue(apiTokens) };
      if (table === "comments") return { collect: vi.fn().mockResolvedValue(userComments) };
      if (table === "soulComments") return { collect: vi.fn().mockResolvedValue(soulComments) };
      throw new Error(`Unexpected table ${table}`);
    },
  }));

  const ctx = { db: { patch, insert, get, query, normalizeId: vi.fn() }, runMutation } as never;
  return { ctx, patch, insert, get, runMutation };
}

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
          withIndex: (name: string, builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
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
          withIndex: (name: string, builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
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

describe("users.syncGitHubProfileInternal", () => {
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
          withIndex: (name: string, builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
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
    vi.mocked(insertStatEvent).mockReset();
    vi.restoreAllMocks();
  });

  it("soft-deletes target user comments (skill + soul) during ban", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, patch, insert, runMutation } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "moderator" };
      if (id === "users:target") return { _id: "users:target", role: "user" };
      if (id === "souls:1") return { _id: "souls:1", stats: { comments: 3 } };
      return null;
    });

    runMutation
      .mockResolvedValueOnce({ hiddenCount: 2, scheduled: false })
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
      deletedComments: { skillComments: number; soulComments: number };
    };

    expect(result).toMatchObject({
      ok: true,
      alreadyBanned: false,
      deletedComments: { skillComments: 1, soulComments: 1 },
    });

    expect(patch).toHaveBeenCalledWith("comments:active", {
      softDeletedAt: 1_700_000_000_000,
      deletedBy: "users:actor",
    });
    expect(patch).toHaveBeenCalledWith("soulComments:active", {
      softDeletedAt: 1_700_000_000_000,
      deletedBy: "users:actor",
    });
    expect(patch).toHaveBeenCalledWith("souls:1", {
      stats: { comments: 2 },
      updatedAt: 1_700_000_000_000,
    });

    expect(insertStatEvent).toHaveBeenCalledWith(expect.anything(), {
      skillId: "skills:1",
      kind: "uncomment",
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "user.ban",
        metadata: expect.objectContaining({
          deletedSkillComments: 1,
          deletedSoulComments: 1,
        }),
      }),
    );
  });

  it("re-ban of already banned user still cleans lingering comments", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { ctx, get, patch, runMutation } = makeBanCtx();

    get.mockImplementation(async (id: string) => {
      if (id === "users:actor") return { _id: "users:actor", role: "moderator" };
      if (id === "users:target")
        return { _id: "users:target", role: "user", deletedAt: 1_600_000_000_000 };
      if (id === "souls:1") return { _id: "souls:1", stats: { comments: 3 } };
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
      deletedComments: { skillComments: number; soulComments: number };
      deletedSkills: number;
    };

    expect(result).toEqual({
      ok: true,
      alreadyBanned: true,
      deletedSkills: 0,
      deletedComments: { skillComments: 1, soulComments: 1 },
    });
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("comments:active", {
      softDeletedAt: 1_600_000_000_000,
      deletedBy: "users:actor",
    });
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
