/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watchRef: Symbol("watch-item"),
  unwatchRef: Symbol("unwatch-item"),
  listWatchesRef: Symbol("list-watches"),
  listInboxRef: Symbol("list-inbox"),
  acknowledgeRef: Symbol("acknowledge-inbox"),
  applyRateLimit: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    feedItemNotifications: {
      watchItemInternal: mocks.watchRef,
      unwatchItemInternal: mocks.unwatchRef,
      listWatchesInternal: mocks.listWatchesRef,
      listInboxInternal: mocks.listInboxRef,
      acknowledgeInboxItemInternal: mocks.acknowledgeRef,
    },
  },
}));

vi.mock("./lib/httpRateLimit", () => ({ applyRateLimit: mocks.applyRateLimit }));

vi.mock("./httpApiV1/shared", () => ({
  requireApiTokenUserOrResponse: mocks.requireAuth,
  parseJsonPayload: async (request: Request) => ({ ok: true, payload: await request.json() }),
  json: (value: unknown, status: number, headers?: HeadersInit) =>
    Response.json(value, { status, headers }),
  text: (value: string, status: number, headers?: HeadersInit) =>
    new Response(value, { status, headers }),
  formatUserFacingErrorMessage: (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    return message.replace(/^(?:Uncaught\s+)?ConvexError:\s*/iu, "").trim() || fallback;
  },
}));

const {
  feedItemWatchesDeleteV1Handler,
  feedItemWatchesGetV1Handler,
  feedItemWatchesPostV1Handler,
  feedNotificationsGetV1Handler,
  feedNotificationsPatchV1Handler,
} = await import("./httpApiV1/feedItemNotificationsV1");

function makeCtx() {
  return { runQuery: vi.fn(), runMutation: vi.fn() };
}

const identity = {
  feedId: "clawhub-official",
  representation: "catalog",
  itemKind: "plugin",
  itemId: "@openclaw/demo",
};

describe("feed item notification HTTP API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyRateLimit.mockResolvedValue({ ok: true, headers: { "x-test": "1" } });
    mocks.requireAuth.mockResolvedValue({ ok: true, userId: "users:viewer" });
  });

  it("creates an explicit item watch for the authenticated account", async () => {
    const ctx = makeCtx();
    ctx.runMutation.mockResolvedValue({ ok: true, created: true });
    const response = await feedItemWatchesPostV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(identity),
      }),
    );

    expect(response.status).toBe(200);
    expect(ctx.runMutation).toHaveBeenCalledWith(mocks.watchRef, {
      userId: "users:viewer",
      ...identity,
      source: "explicit",
    });
  });

  it("lists watches and inbox rows with bounded pagination arguments", async () => {
    const ctx = makeCtx();
    ctx.runQuery.mockResolvedValue({ ok: true, items: [], nextCursor: null });

    const watches = await feedItemWatchesGetV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches?cursor=next&limit=25"),
    );
    const inbox = await feedNotificationsGetV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-notifications?limit=10"),
    );

    expect(watches.status).toBe(200);
    expect(inbox.status).toBe(200);
    expect(ctx.runQuery).toHaveBeenNthCalledWith(1, mocks.listWatchesRef, {
      userId: "users:viewer",
      cursor: "next",
      limit: 25,
    });
    expect(ctx.runQuery).toHaveBeenNthCalledWith(2, mocks.listInboxRef, {
      userId: "users:viewer",
      limit: 10,
    });
  });

  it("rejects malformed identities and list limits before database calls", async () => {
    const ctx = makeCtx();
    const create = await feedItemWatchesPostV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...identity, representation: "unknown" }),
      }),
    );
    const list = await feedNotificationsGetV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-notifications?limit=101"),
    );
    const extraWatchField = await feedItemWatchesPostV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...identity, source: "installed-sync" }),
      }),
    );
    const publisherWatch = await feedItemWatchesPostV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...identity, representation: "publisher" }),
      }),
    );
    const mismatchedCatalog = await feedItemWatchesPostV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...identity, feedId: "clawhub-official-skills" }),
      }),
    );
    const extraAcknowledgeField = await feedNotificationsPatchV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notificationId: "feedNotificationInbox:1",
          action: "read",
          userId: "users:other",
        }),
      }),
    );

    expect(create.status).toBe(400);
    expect(list.status).toBe(400);
    expect(extraWatchField.status).toBe(400);
    expect(publisherWatch.status).toBe(400);
    expect(mismatchedCatalog.status).toBe(400);
    expect(extraAcknowledgeField.status).toBe(400);
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("removes a watch and acknowledges one inbox event", async () => {
    const ctx = makeCtx();
    ctx.runMutation.mockResolvedValue({ ok: true });
    const query = new URLSearchParams(identity).toString();
    const remove = await feedItemWatchesDeleteV1Handler(
      ctx as never,
      new Request(`https://clawhub.ai/api/v1/feed-item-watches?${query}`, { method: "DELETE" }),
    );
    const acknowledge = await feedNotificationsPatchV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId: "feedNotificationInbox:1", action: "dismiss" }),
      }),
    );

    expect(remove.status).toBe(200);
    expect(acknowledge.status).toBe(200);
    expect(ctx.runMutation).toHaveBeenNthCalledWith(1, mocks.unwatchRef, {
      userId: "users:viewer",
      ...identity,
    });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(2, mocks.acknowledgeRef, {
      userId: "users:viewer",
      notificationId: "feedNotificationInbox:1",
      action: "dismiss",
    });
  });

  it("keeps unexpected mutation failures generic and retryable", async () => {
    const ctx = makeCtx();
    ctx.runMutation.mockRejectedValue(new Error("database connection details"));

    const response = await feedItemWatchesPostV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(identity),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Internal Server Error");
  });

  it("maps known Convex validation and ownership failures to 4xx", async () => {
    const ctx = makeCtx();
    ctx.runMutation
      .mockRejectedValueOnce(
        new Error("Uncaught ConvexError: An account can watch up to 500 items"),
      )
      .mockRejectedValueOnce(new Error("Uncaught ConvexError: Notification not found"));

    const watch = await feedItemWatchesPostV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-item-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(identity),
      }),
    );
    const acknowledge = await feedNotificationsPatchV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId: "feedNotificationInbox:1", action: "read" }),
      }),
    );

    expect(watch.status).toBe(400);
    await expect(watch.text()).resolves.toBe("An account can watch up to 500 items");
    expect(acknowledge.status).toBe(404);
    await expect(acknowledge.text()).resolves.toBe("Notification not found");
  });

  it("returns a client error when Convex rejects a malformed notification id", async () => {
    const ctx = makeCtx();
    ctx.runMutation.mockRejectedValue(new Error("Uncaught ConvexError: Invalid notification id"));

    const response = await feedNotificationsPatchV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feed-notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId: "not-an-id", action: "read" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid notification id");
  });
});
