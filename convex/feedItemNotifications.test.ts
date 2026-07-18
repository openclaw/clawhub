/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pruneRef: Symbol("prune-feed-notification-inbox"),
  deleteAccountStateRef: Symbol("delete-account-feed-notification-state"),
  processCatalogMaterializationRef: Symbol("process-catalog-materialization"),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    feedItemNotifications: {
      pruneExpiredInboxInternal: mocks.pruneRef,
      deleteAccountNotificationStateInternal: mocks.deleteAccountStateRef,
      processCatalogMaterializationInternal: mocks.processCatalogMaterializationRef,
    },
  },
}));

vi.mock("./functions", () => ({
  internalMutation: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
  internalQuery: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
  mutation: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
  query: (definition: { handler: unknown }) => ({ _handler: definition.handler }),
}));

const {
  acknowledgeInboxItemInternal,
  deleteAccountNotificationStateInternal,
  listInboxInternal,
  pruneExpiredInboxInternal,
  processCatalogMaterializationInternal,
  recordInboxEventInternal,
  watchItemInternal,
} = await import("./feedItemNotifications");

type Handler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const watchHandler = (
  watchItemInternal as unknown as Handler<
    {
      userId: string;
      feedId: string;
      representation: "catalog" | "publisher";
      itemKind: "plugin" | "skill";
      itemId: string;
      source: "explicit" | "installed-sync";
    },
    { created: boolean; source: string }
  >
)._handler;

const recordHandler = (
  recordInboxEventInternal as unknown as Handler<
    {
      userId: string;
      eventId: string;
      feedId: string;
      representation: "catalog" | "publisher";
      itemKind: "plugin" | "skill";
      itemId: string;
      sequence: number;
      reason: "updated" | "removed" | "blocked" | "security-state-changed";
      signedStateUrl: string;
      createdAt: number;
    },
    { created: boolean; reason?: string; notificationId?: string }
  >
)._handler;

const acknowledgeHandler = (
  acknowledgeInboxItemInternal as unknown as Handler<
    { userId: string; notificationId: string; action: "read" | "dismiss" },
    { ok: boolean }
  >
)._handler;

const deleteAccountStateHandler = (
  deleteAccountNotificationStateInternal as unknown as Handler<
    { userId: string; watchCursor?: string; inboxCursor?: string },
    { feedItemWatches: number; feedNotificationInbox: number; scheduled: boolean }
  >
)._handler;

const pruneHandler = (
  pruneExpiredInboxInternal as unknown as Handler<
    { now?: number },
    { deleted: number; materializationsDeleted: number; scheduled: boolean }
  >
)._handler;

const processCatalogMaterializationHandler = (
  processCatalogMaterializationInternal as unknown as Handler<
    { materializationId: string },
    { status: string; created?: number }
  >
)._handler;

const listInboxHandler = (
  listInboxInternal as unknown as Handler<
    { userId: string; cursor?: string | null; limit?: number },
    { items: Array<Record<string, unknown>>; nextCursor: string | null }
  >
)._handler;

function chain() {
  const value = { eq: vi.fn(), lt: vi.fn() };
  value.eq.mockReturnValue(value);
  value.lt.mockReturnValue(value);
  return value;
}

const identity = {
  feedId: "clawhub-official",
  representation: "catalog" as const,
  itemKind: "plugin" as const,
  itemId: "@openclaw/demo",
};

describe("feed item watches and notification inbox", () => {
  it("creates a private explicit watch and audit record", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce("feedItemWatches:1")
      .mockResolvedValueOnce("auditLogs:1");
    const query = vi.fn((table: string) => ({
      withIndex: (index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
        build(chain());
        if (table !== "feedItemWatches") throw new Error(`unexpected table ${table}`);
        if (index === "by_user_feed_representation_kind_item") {
          return { unique: async () => null };
        }
        if (index === "by_user_and_updatedAt") return { take: async () => [] };
        throw new Error(`unexpected index ${index}`);
      },
    }));
    const ctx = { db: { query, insert, patch: vi.fn() } };

    const result = await watchHandler(ctx, {
      userId: "users:viewer",
      ...identity,
      source: "explicit",
    });

    expect(result).toMatchObject({ created: true, source: "explicit" });
    expect(insert).toHaveBeenCalledWith(
      "feedItemWatches",
      expect.objectContaining({ userId: "users:viewer", ...identity, source: "explicit" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({ action: "feed.item-watch.create", actorUserId: "users:viewer" }),
    );
  });

  it("upgrades an installed-sync watch to explicit without duplicating it", async () => {
    const existing = {
      _id: "feedItemWatches:1",
      userId: "users:viewer",
      ...identity,
      source: "installed-sync",
      createdAt: 1,
      updatedAt: 1,
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        query: () => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            return { unique: async () => existing };
          },
        }),
        patch,
      },
    };

    const result = await watchHandler(ctx, {
      userId: "users:viewer",
      ...identity,
      source: "explicit",
    });

    expect(result).toMatchObject({ created: false, source: "explicit" });
    expect(patch).toHaveBeenCalledWith(
      "feedItemWatches:1",
      expect.objectContaining({ source: "explicit" }),
    );
  });

  it("records an idempotent inbox event only for a watched item", async () => {
    const insert = vi.fn().mockResolvedValue("feedNotificationInbox:1");
    const query = vi.fn((table: string) => ({
      withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
        build(chain());
        return {
          unique: async () =>
            table === "feedItemWatches" ? { _id: "feedItemWatches:1", createdAt: 0 } : null,
          order: () => ({ take: async () => [] }),
        };
      },
    }));
    const ctx = { db: { query, insert, patch: vi.fn() } };
    const event = {
      userId: "users:viewer",
      eventId: "  clawhub-official:42:@openclaw/demo  ",
      ...identity,
      sequence: 42,
      reason: "updated" as const,
      signedStateUrl: "https://clawhub.ai/v1/feeds/plugins/changes?fromSequence=41",
      createdAt: Date.now(),
    };

    const result = await recordHandler(ctx, event);

    expect(result).toMatchObject({ created: true, notificationId: "feedNotificationInbox:1" });
    expect(insert).toHaveBeenCalledWith(
      "feedNotificationInbox",
      expect.objectContaining({
        eventId: event.eventId.trim(),
        sequence: 42,
        reason: "updated",
        archived: false,
        signedStateUrl: event.signedStateUrl,
      }),
    );

    const duplicateCtx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            return {
              unique: async () =>
                table === "feedItemWatches"
                  ? { _id: "feedItemWatches:1", createdAt: 0 }
                  : { _id: "feedNotificationInbox:existing" },
            };
          },
        })),
        insert: vi.fn(),
      },
    };
    await expect(recordHandler(duplicateCtx, event)).resolves.toMatchObject({
      created: false,
      reason: "duplicate",
    });
    expect(duplicateCtx.db.insert).not.toHaveBeenCalled();
  });

  it("does not create inbox rows for unwatched items", async () => {
    const insert = vi.fn();
    const ctx = {
      db: {
        query: () => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            return { unique: async () => null };
          },
        }),
        insert,
      },
    };

    await expect(
      recordHandler(ctx, {
        userId: "users:viewer",
        eventId: "event:1",
        ...identity,
        sequence: 1,
        reason: "updated",
        signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
        createdAt: Date.now(),
      }),
    ).resolves.toMatchObject({ created: false, reason: "not-watched" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not backfill events that occurred before the watch", async () => {
    const insert = vi.fn();
    const now = Date.now();
    const ctx = {
      db: {
        query: () => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            return { unique: async () => ({ _id: "watch:1", createdAt: now }) };
          },
        }),
        insert,
      },
    };

    await expect(
      recordHandler(ctx, {
        userId: "users:viewer",
        eventId: "event:before-watch",
        ...identity,
        sequence: 1,
        reason: "updated",
        signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
        createdAt: now - 1,
      }),
    ).resolves.toMatchObject({ created: false, reason: "before-watch" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("archives the oldest active row before exceeding the inbox bound", async () => {
    const active = Array.from({ length: 200 }, (_, index) => ({
      _id: `feedNotificationInbox:${index}`,
      createdAt: 200 - index,
    }));
    const patch = vi.fn();
    const insert = vi.fn().mockResolvedValue("feedNotificationInbox:new");
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            if (table === "feedItemWatches") {
              return { unique: async () => ({ _id: "watch:1", createdAt: 0 }) };
            }
            if (index === "by_user_and_eventId") return { unique: async () => null };
            return { order: () => ({ take: async () => active }) };
          },
        }),
        patch,
        insert,
      },
    };

    await recordHandler(ctx, {
      userId: "users:viewer",
      eventId: "event:new",
      ...identity,
      sequence: 2,
      reason: "updated",
      signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
      createdAt: Date.now(),
    });

    expect(patch).toHaveBeenCalledWith(
      "feedNotificationInbox:199",
      expect.objectContaining({ archived: true }),
    );
    expect(insert).toHaveBeenCalledWith(
      "feedNotificationInbox",
      expect.objectContaining({ eventId: "event:new", archived: false }),
    );
  });

  it("archives a delayed event instead of displacing a newer active row", async () => {
    const now = Date.now();
    const active = Array.from({ length: 200 }, (_, index) => ({
      _id: `feedNotificationInbox:${index}`,
      createdAt: now - index,
    }));
    const patch = vi.fn();
    const insert = vi.fn().mockResolvedValue("feedNotificationInbox:delayed");
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            if (table === "feedItemWatches") {
              return { unique: async () => ({ _id: "watch:1", createdAt: 0 }) };
            }
            if (index === "by_user_and_eventId") return { unique: async () => null };
            return { order: () => ({ take: async () => active }) };
          },
        }),
        patch,
        insert,
      },
    };

    await recordHandler(ctx, {
      userId: "users:viewer",
      eventId: "event:delayed",
      ...identity,
      sequence: 1,
      reason: "updated",
      signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
      createdAt: now - 1_000,
    });

    expect(patch).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      "feedNotificationInbox",
      expect.objectContaining({ eventId: "event:delayed", archived: true }),
    );
  });

  it("projects only the strict public inbox fields", async () => {
    const row = {
      _id: "feedNotificationInbox:1",
      _creationTime: 999,
      userId: "users:viewer",
      eventId: "event:1",
      ...identity,
      sequence: 2,
      reason: "updated",
      signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 2,
    };
    const ctx = {
      db: {
        query: () => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            return {
              order: () => ({
                paginate: async () => ({ page: [row], isDone: true, continueCursor: "" }),
              }),
            };
          },
        }),
      },
    };

    const result = await listInboxHandler(ctx, { userId: "users:viewer" });

    expect(result.items[0]).toEqual({
      notificationId: "feedNotificationInbox:1",
      eventId: "event:1",
      ...identity,
      sequence: 2,
      reason: "updated",
      signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 2,
    });
    expect(result.items[0]).not.toHaveProperty("_creationTime");
    expect(result.items[0]).not.toHaveProperty("userId");
  });

  it("marks dismissal as read and archived while enforcing ownership", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        normalizeId: vi.fn((_table: string, id: string) => id),
        get: vi.fn(async () => ({
          _id: "feedNotificationInbox:1",
          userId: "users:viewer",
          readAt: undefined,
        })),
        patch,
      },
    };

    await acknowledgeHandler(ctx, {
      userId: "users:viewer",
      notificationId: "feedNotificationInbox:1",
      action: "dismiss",
    });
    expect(patch).toHaveBeenCalledWith(
      "feedNotificationInbox:1",
      expect.objectContaining({
        archived: true,
        readAt: expect.any(Number),
        dismissedAt: expect.any(Number),
      }),
    );

    await expect(
      acknowledgeHandler(
        {
          db: {
            normalizeId: vi.fn((_table: string, id: string) => id),
            get: vi.fn(async () => ({ _id: "feedNotificationInbox:1", userId: "users:other" })),
          },
        },
        {
          userId: "users:viewer",
          notificationId: "feedNotificationInbox:1",
          action: "read",
        },
      ),
    ).rejects.toThrow("Notification not found");
  });

  it("rejects malformed notification ids before reading inbox state", async () => {
    const get = vi.fn();
    await expect(
      acknowledgeHandler(
        { db: { normalizeId: vi.fn(() => null), get } },
        { userId: "users:viewer", notificationId: "not-an-id", action: "read" },
      ),
    ).rejects.toThrow("Invalid notification id");
    expect(get).not.toHaveBeenCalled();
  });

  it("does not rewrite acknowledgement timestamps on retries", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        normalizeId: vi.fn((_table: string, id: string) => id),
        get: vi.fn(async () => ({
          _id: "feedNotificationInbox:1",
          userId: "users:viewer",
          readAt: 10,
          dismissedAt: 11,
          archived: true,
          updatedAt: 11,
        })),
        patch,
      },
    };

    await expect(
      acknowledgeHandler(ctx, {
        userId: "users:viewer",
        notificationId: "feedNotificationInbox:1",
        action: "read",
      }),
    ).resolves.toMatchObject({ ok: true, action: "read" });
    await expect(
      acknowledgeHandler(ctx, {
        userId: "users:viewer",
        notificationId: "feedNotificationInbox:1",
        action: "dismiss",
      }),
    ).resolves.toMatchObject({ ok: true, action: "dismiss" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("deletes private watch and inbox state in bounded account-purge batches", async () => {
    const watches = [{ _id: "watch:1" }, { _id: "watch:2" }];
    const inbox = [{ _id: "inbox:1" }];
    const deleteDoc = vi.fn();
    const runAfter = vi.fn();
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            return {
              paginate: async () =>
                table === "feedItemWatches"
                  ? { page: watches, isDone: false, continueCursor: "next-watches" }
                  : { page: inbox, isDone: true, continueCursor: "" },
            };
          },
        }),
        delete: deleteDoc,
      },
      scheduler: { runAfter },
    };

    await expect(deleteAccountStateHandler(ctx, { userId: "users:viewer" })).resolves.toEqual({
      feedItemWatches: 2,
      feedNotificationInbox: 1,
      scheduled: true,
    });
    expect(deleteDoc).toHaveBeenCalledTimes(3);
    expect(runAfter).toHaveBeenCalledWith(0, mocks.deleteAccountStateRef, {
      userId: "users:viewer",
      watchCursor: "next-watches",
    });
  });

  it("fans a committed catalog change out to current watchers", async () => {
    const createdAt = Date.now();
    const materialization = {
      _id: "feedNotificationMaterializations:1",
      feedId: "clawhub-official",
      sequence: 9,
      itemKind: "plugin",
      signedStateUrl: "https://clawhub.ai/v1/feeds/plugins",
      changes: [{ itemId: "@openclaw/demo", reason: "updated" }],
      nextChangeIndex: 0,
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + 10_000,
    };
    const watches = [
      { _id: "watch:1", userId: "users:1", createdAt: createdAt - 10 },
      { _id: "watch:2", userId: "users:2", createdAt: createdAt - 5 },
    ];
    const insert = vi.fn(async (_table: string, value: { userId: string }) =>
      value.userId === "users:1" ? "inbox:1" : "inbox:2",
    );
    const deleteDoc = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => materialization),
        query: (table: string) => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            if (table === "feedItemWatches") {
              return {
                paginate: async () => ({ page: watches, isDone: true, continueCursor: "" }),
              };
            }
            return {
              unique: async () => null,
              order: () => ({ take: async () => [] }),
            };
          },
        }),
        insert,
        patch: vi.fn(),
        delete: deleteDoc,
      },
      scheduler: { runAfter: vi.fn() },
    };

    await expect(
      processCatalogMaterializationHandler(ctx, {
        materializationId: "feedNotificationMaterializations:1",
      }),
    ).resolves.toEqual({ ok: true, status: "complete", created: 2 });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith(
      "feedNotificationInbox",
      expect.objectContaining({
        userId: "users:1",
        eventId: "catalog:clawhub-official:9:0",
        sequence: 9,
        reason: "updated",
      }),
    );
    expect(deleteDoc).toHaveBeenCalledWith("feedNotificationMaterializations:1");
  });

  it("prunes bounded expiry batches and schedules continuation", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ _id: `inbox:${index}` }));
    const deleteDoc = vi.fn();
    const runAfter = vi.fn();
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, build: (q: ReturnType<typeof chain>) => unknown) => {
            build(chain());
            return { take: async () => (table === "feedNotificationInbox" ? rows : []) };
          },
        }),
        delete: deleteDoc,
      },
      scheduler: { runAfter },
    };

    await expect(pruneHandler(ctx, { now: 123 })).resolves.toEqual({
      deleted: 200,
      materializationsDeleted: 0,
      scheduled: true,
    });
    expect(deleteDoc).toHaveBeenCalledTimes(200);
    expect(runAfter).toHaveBeenCalledWith(0, mocks.pruneRef, { now: 123 });
  });
});
