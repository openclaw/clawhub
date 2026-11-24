import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery, query } from "./functions";
import { getOptionalActiveAuthUserId, requireUserFromAction } from "./lib/access";
import {
  ComposioError,
  type ComposioClient,
  type ComposioConnectedAccount,
  createComposioLink,
  createComposioSession,
  deleteComposioConnectedAccount,
  deleteComposioSession,
  getComposioApiKey,
  getComposioClient,
  listComposioConnectedAccounts,
  listComposioToolkitTools,
} from "./lib/composio";
import {
  buildLinkSessionToolConfig,
  CONNECTION_APPS,
  type ConnectionApp,
  getConnectionApp,
} from "./lib/connectionApps";
import { pushSessionConfig, SESSION_TTL_MS } from "./lib/connectionSessions";

/**
 * App connections: a signed-in user connects an external app through Composio,
 * and their OpenClaw chats reach that app's allowlisted tools through the
 * relay in `httpApiV1/connectionsV1.ts`.
 *
 * Trust rules this module keeps:
 * - The Composio user id is always the server-derived ClawHub user id.
 * - `connected` is written only after Composio reports an active account for
 *   that user. Callback query parameters are hints and can only end a
 *   sign-in, never complete one.
 * - With `COMPOSIO_API_KEY` unset, every entry point behaves as if the feature
 *   does not exist.
 */

/** A sign-in the user never returns from is treated as abandoned after this. */
const ATTEMPT_TTL_MS = 15 * 60 * 1000;
/** Bounds how many Composio sessions one account can hold at a time. */
const MAX_SESSIONS_PER_USER = 1000;
const SYNC_PAGE_SIZE = 20;
const PRUNE_BATCH_SIZE = 50;
const DEFAULT_SITE_URL = "https://clawhub.ai";
const ENDED_ACCOUNT_STATUSES = new Set(["FAILED", "EXPIRED", "INACTIVE", "REVOKED"]);

const lastErrorValidator = v.union(
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("lost"),
);

type ConnectionStatus = Doc<"appConnections">["status"];
type ConnectionLastError = NonNullable<Doc<"appConnections">["lastError"]>;

const UNAVAILABLE_MESSAGE = "The connection service is not responding. Try again in a moment.";

function requireComposioClient(): ComposioClient {
  const client = getComposioClient();
  // Same answer as an unknown function would give a caller: nothing to use here.
  if (!client) throw new ConvexError("Connections are not available.");
  return client;
}

function requireConnectionApp(appId: string): ConnectionApp {
  const app = getConnectionApp(appId);
  if (!app) throw new ConvexError("Unknown app.");
  return app;
}

/** Runs Composio calls for a user-facing action without leaking provider details. */
async function withComposio<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ComposioError) {
      console.warn("connections_composio_error", { status: error.status });
      throw new ConvexError(UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

async function bestEffort(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof ComposioError)) throw error;
    console.warn("connections_composio_cleanup_failed", { status: error.status });
  }
}

function pickActiveAccount(accounts: ComposioConnectedAccount[]) {
  return (
    accounts.filter((account) => account.active).sort((a, b) => b.createdAt - a.createdAt)[0] ??
    null
  );
}

function newAttemptId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Where Composio sends the browser after a sign-in. Server-controlled, never client-supplied. */
function buildConnectCallbackUrl(appId: string, attemptId: string) {
  const url = new URL("/settings", process.env.SITE_URL?.trim() || DEFAULT_SITE_URL);
  url.searchParams.set("view", "connections");
  url.searchParams.set("app", appId);
  url.searchParams.set("attempt", attemptId);
  return url.toString();
}

async function getConnectionRow(ctx: QueryCtx | MutationCtx, userId: Id<"users">, app: string) {
  return await ctx.db
    .query("appConnections")
    .withIndex("by_user_app", (q) => q.eq("userId", userId).eq("app", app))
    .unique();
}

async function listConnectedAppIds(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const connected: string[] = [];
  for (const app of CONNECTION_APPS) {
    const row = await getConnectionRow(ctx, userId, app.id);
    if (row?.status === "connected") connected.push(app.id);
  }
  return connected;
}

async function scheduleSessionSync(ctx: MutationCtx, userId: Id<"users">) {
  await ctx.scheduler.runAfter(0, internal.connections.syncUserSessionsInternal, {
    userId,
    cursor: null,
  });
}

// ---------------------------------------------------------------------------
// Page: queries and actions for the signed-in user
// ---------------------------------------------------------------------------

/**
 * Connection state for the signed-in user. Returns null when the feature is
 * off or nobody is signed in, so the page has nothing to render.
 */
export const getMine = query({
  args: {},
  handler: async (ctx) => {
    if (!getComposioApiKey()) return null;
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) return null;
    const apps = [];
    for (const app of CONNECTION_APPS) {
      const row = await getConnectionRow(ctx, userId, app.id);
      apps.push({
        id: app.id,
        name: app.name,
        description: app.description,
        status: (row?.status ?? "disconnected") as ConnectionStatus,
        accountLabel: row?.status === "connected" ? (row.accountLabel ?? null) : null,
        lastError: (row?.lastError ?? null) as ConnectionLastError | null,
        attemptStartedAt: row?.status === "pending" ? (row.attemptStartedAt ?? null) : null,
        tools: [...app.tools],
      });
    }
    return { apps };
  },
});

/** The tools an app exposes to chats, with the descriptions Composio publishes. */
export const listTools = action({
  args: { app: v.string() },
  handler: async (ctx, args) => {
    await requireUserFromAction(ctx);
    const client = requireComposioClient();
    const app = requireConnectionApp(args.app);
    const published = await withComposio(() => listComposioToolkitTools(client, app.toolkit));
    const bySlug = new Map(published.map((tool) => [tool.slug, tool]));
    // Exactly the allowlist, in its order; a tool Composio no longer has is not exposed.
    return app.tools.flatMap((slug) => {
      const tool = bySlug.get(slug);
      return tool ? [{ slug: tool.slug, name: tool.name, description: tool.description }] : [];
    });
  },
});

type ConnectOutcome =
  | { status: "connected" }
  | { status: "pending"; redirectUrl: string; attemptId: string };

/**
 * Starts a provider sign-in and returns Composio's hosted sign-in URL. An
 * account that is already active for this user is recorded instead.
 */
export const startConnect = action({
  args: { app: v.string() },
  handler: async (ctx, args): Promise<ConnectOutcome> => {
    const { userId } = await requireUserFromAction(ctx);
    const client = requireComposioClient();
    const app = requireConnectionApp(args.app);

    return await withComposio(async () => {
      const accounts = await listComposioConnectedAccounts(client, {
        userId,
        toolkit: app.toolkit,
      });
      const active = pickActiveAccount(accounts);
      if (active) {
        await ctx.runMutation(internal.connections.recordVerifiedInternal, {
          userId,
          app: app.id,
          connectedAccountId: active.id,
          accountLabel: active.label ?? undefined,
        });
        return { status: "connected" as const };
      }

      const row: Doc<"appConnections"> | null = await ctx.runQuery(
        internal.connections.getConnectionInternal,
        { userId, app: app.id },
      );
      if (row?.status === "connected") {
        // Composio no longer has the recorded account. Say so, and narrow the
        // user's sessions, before a new sign-in starts.
        await ctx.runMutation(internal.connections.recordDisconnectedInternal, {
          userId,
          app: app.id,
          lastError: "lost",
          expectedStatus: "connected",
        });
      }
      // Only one sign-in is live per user and app: drop the one being replaced.
      const replaced = row?.status === "pending" ? row.connectedAccountId : undefined;
      if (replaced && accounts.some((account) => account.id === replaced)) {
        await bestEffort(() => deleteComposioConnectedAccount(client, replaced));
      }

      const attemptId = newAttemptId();
      const linkArgs = {
        toolkit: app.toolkit,
        callbackUrl: buildConnectCallbackUrl(app.id, attemptId),
      };
      let linkSessionId = row?.linkSessionId;
      let link: Awaited<ReturnType<typeof createComposioLink>> | null = null;
      if (linkSessionId) {
        try {
          link = await createComposioLink(client, linkSessionId, linkArgs);
        } catch (error) {
          // A deleted or unusable link session is replaced; other failures surface.
          const replaceable =
            error instanceof ComposioError && (error.status === 404 || error.status === 400);
          if (!replaceable) throw error;
        }
      }
      if (!link) {
        const session = await createComposioSession(client, {
          userId,
          config: buildLinkSessionToolConfig(app),
        });
        linkSessionId = session.sessionId;
        link = await createComposioLink(client, linkSessionId, linkArgs);
      }

      await ctx.runMutation(internal.connections.recordAttemptInternal, {
        userId,
        app: app.id,
        attemptId,
        connectedAccountId: link.connectedAccountId,
        linkSessionId: linkSessionId as string,
      });
      return { status: "pending" as const, redirectUrl: link.redirectUrl, attemptId };
    });
  },
});

/**
 * Asks Composio what is true for this user and records it. This is the only
 * path to `connected`, and it also picks up an account connected for the same
 * user outside this page, or one that has since been revoked.
 *
 * `attemptId` and `outcome` come from the browser's return URL. They are
 * hints: they can end the caller's own pending sign-in early, nothing more.
 */
export const verify = action({
  args: {
    app: v.string(),
    attemptId: v.optional(v.string()),
    outcome: v.optional(v.literal("failed")),
  },
  handler: async (ctx, args): Promise<{ status: ConnectionStatus }> => {
    const { userId } = await requireUserFromAction(ctx);
    const client = requireComposioClient();
    const app = requireConnectionApp(args.app);

    return await withComposio(async () => {
      const accounts = await listComposioConnectedAccounts(client, {
        userId,
        toolkit: app.toolkit,
      });
      const active = pickActiveAccount(accounts);
      if (active) {
        await ctx.runMutation(internal.connections.recordVerifiedInternal, {
          userId,
          app: app.id,
          connectedAccountId: active.id,
          accountLabel: active.label ?? undefined,
        });
        return { status: "connected" as const };
      }

      const row: Doc<"appConnections"> | null = await ctx.runQuery(
        internal.connections.getConnectionInternal,
        { userId, app: app.id },
      );
      if (!row || row.status === "disconnected") return { status: "disconnected" as const };

      if (row.status === "connected") {
        await ctx.runMutation(internal.connections.recordDisconnectedInternal, {
          userId,
          app: app.id,
          lastError: "lost",
          expectedStatus: "connected",
        });
        return { status: "disconnected" as const };
      }

      const pending = accounts.find((account) => account.id === row.connectedAccountId);
      const ended = !pending || ENDED_ACCOUNT_STATUSES.has(pending.status);
      const reportedFailed = args.outcome === "failed" && args.attemptId === row.attemptId;
      const abandoned = Date.now() - (row.attemptStartedAt ?? 0) > ATTEMPT_TTL_MS;
      if (!ended && !reportedFailed && !abandoned) return { status: "pending" as const };

      if (pending) await bestEffort(() => deleteComposioConnectedAccount(client, pending.id));
      await ctx.runMutation(internal.connections.recordDisconnectedInternal, {
        userId,
        app: app.id,
        lastError: ended ? "failed" : reportedFailed ? "cancelled" : "expired",
        expectedStatus: "pending",
        expectedAttemptId: row.attemptId,
      });
      return { status: "disconnected" as const };
    });
  },
});

/** Abandons the caller's pending sign-in. */
export const cancelConnect = action({
  args: { app: v.string() },
  handler: async (ctx, args): Promise<{ status: ConnectionStatus }> => {
    const { userId } = await requireUserFromAction(ctx);
    const client = requireComposioClient();
    const app = requireConnectionApp(args.app);
    const row: Doc<"appConnections"> | null = await ctx.runQuery(
      internal.connections.getConnectionInternal,
      { userId, app: app.id },
    );
    if (row?.status !== "pending") return { status: row?.status ?? "disconnected" };
    const pendingAccountId = row.connectedAccountId;
    if (pendingAccountId) {
      await bestEffort(() => deleteComposioConnectedAccount(client, pendingAccountId));
    }
    await ctx.runMutation(internal.connections.recordDisconnectedInternal, {
      userId,
      app: app.id,
      expectedStatus: "pending",
      expectedAttemptId: row.attemptId,
    });
    return { status: "disconnected" };
  },
});

/**
 * Removes every account Composio holds for this user and app, then narrows the
 * user's chat sessions. A Composio failure leaves the recorded state unchanged
 * so the page never claims a disconnect that did not happen.
 */
export const disconnect = action({
  args: { app: v.string() },
  handler: async (ctx, args): Promise<{ status: ConnectionStatus }> => {
    const { userId } = await requireUserFromAction(ctx);
    const client = requireComposioClient();
    const app = requireConnectionApp(args.app);
    await withComposio(async () => {
      const accounts = await listComposioConnectedAccounts(client, {
        userId,
        toolkit: app.toolkit,
      });
      for (const account of accounts) {
        await deleteComposioConnectedAccount(client, account.id);
      }
    });
    await ctx.runMutation(internal.connections.recordDisconnectedInternal, {
      userId,
      app: app.id,
    });
    return { status: "disconnected" };
  },
});

// ---------------------------------------------------------------------------
// Connection state writes
// ---------------------------------------------------------------------------

export const getConnectionInternal = internalQuery({
  args: { userId: v.id("users"), app: v.string() },
  handler: async (ctx, args) => await getConnectionRow(ctx, args.userId, args.app),
});

export const recordAttemptInternal = internalMutation({
  args: {
    userId: v.id("users"),
    app: v.string(),
    attemptId: v.string(),
    connectedAccountId: v.string(),
    linkSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await getConnectionRow(ctx, args.userId, args.app);
    if (!row) {
      await ctx.db.insert("appConnections", {
        userId: args.userId,
        app: args.app,
        status: "pending",
        connectedAccountId: args.connectedAccountId,
        attemptId: args.attemptId,
        attemptStartedAt: now,
        linkSessionId: args.linkSessionId,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    // A verified connection is never downgraded by starting another sign-in.
    if (row.status === "connected") {
      await ctx.db.patch(row._id, { linkSessionId: args.linkSessionId, updatedAt: now });
      return;
    }
    await ctx.db.patch(row._id, {
      status: "pending",
      connectedAccountId: args.connectedAccountId,
      accountLabel: undefined,
      lastError: undefined,
      attemptId: args.attemptId,
      attemptStartedAt: now,
      linkSessionId: args.linkSessionId,
      updatedAt: now,
    });
  },
});

export const recordVerifiedInternal = internalMutation({
  args: {
    userId: v.id("users"),
    app: v.string(),
    connectedAccountId: v.string(),
    accountLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await getConnectionRow(ctx, args.userId, args.app);
    const verified = {
      status: "connected" as const,
      connectedAccountId: args.connectedAccountId,
      accountLabel: args.accountLabel,
      lastError: undefined,
      attemptId: undefined,
      attemptStartedAt: undefined,
      verifiedAt: now,
      updatedAt: now,
    };
    if (!row) {
      await ctx.db.insert("appConnections", {
        userId: args.userId,
        app: args.app,
        createdAt: now,
        ...verified,
      });
    } else {
      await ctx.db.patch(row._id, verified);
    }
    if (row?.status !== "connected") await scheduleSessionSync(ctx, args.userId);
  },
});

export const recordDisconnectedInternal = internalMutation({
  args: {
    userId: v.id("users"),
    app: v.string(),
    lastError: v.optional(lastErrorValidator),
    expectedStatus: v.optional(v.union(v.literal("pending"), v.literal("connected"))),
    expectedAttemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await getConnectionRow(ctx, args.userId, args.app);
    if (!row) return;
    // A check that started before the state moved on must not overwrite it.
    if (args.expectedStatus && row.status !== args.expectedStatus) return;
    if (args.expectedAttemptId !== undefined && row.attemptId !== args.expectedAttemptId) return;
    await ctx.db.patch(row._id, {
      status: "disconnected",
      connectedAccountId: undefined,
      accountLabel: undefined,
      lastError: args.lastError,
      attemptId: undefined,
      attemptStartedAt: undefined,
      updatedAt: Date.now(),
    });
    if (row.status === "connected") await scheduleSessionSync(ctx, args.userId);
  },
});

// ---------------------------------------------------------------------------
// Chat sessions: storage for the relay, and sync when connections change
// ---------------------------------------------------------------------------

async function getSessionRow(ctx: QueryCtx | MutationCtx, userId: Id<"users">, chatKey: string) {
  return await ctx.db
    .query("appConnectionSessions")
    .withIndex("by_user_chat_key", (q) => q.eq("userId", userId).eq("chatKey", chatKey))
    .unique();
}

/** Everything the relay needs to route one request, in one snapshot. */
export const getRelayStateInternal = internalQuery({
  args: { userId: v.id("users"), chatKey: v.string() },
  handler: async (ctx, args) => {
    const session = await getSessionRow(ctx, args.userId, args.chatKey);
    return {
      session: session
        ? {
            composioSessionId: session.composioSessionId,
            mcpUrl: session.mcpUrl,
            configKey: session.configKey,
            expirationTime: session.expirationTime,
          }
        : null,
      connectedAppIds: await listConnectedAppIds(ctx, args.userId),
    };
  },
});

/**
 * Stores the Composio session for a user's chat.
 *
 * `replaces` names the Composio session the caller is replacing (it found the
 * stored one gone). Without a matching `replaces`, an existing row wins and
 * the caller's new session is reported back as unused, so two concurrent
 * first requests for a chat converge on one session.
 */
export const saveSessionInternal = internalMutation({
  args: {
    userId: v.id("users"),
    chatKey: v.string(),
    composioSessionId: v.string(),
    mcpUrl: v.string(),
    configKey: v.string(),
    replaces: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const stored = { composioSessionId: args.composioSessionId, mcpUrl: args.mcpUrl };
    const existing = await getSessionRow(ctx, args.userId, args.chatKey);
    if (existing) {
      if (existing.composioSessionId !== args.replaces) {
        return {
          outcome: "exists" as const,
          composioSessionId: existing.composioSessionId,
          mcpUrl: existing.mcpUrl,
          configKey: existing.configKey,
        };
      }
      await ctx.db.patch(existing._id, {
        ...stored,
        configKey: args.configKey,
        updatedAt: now,
        expirationTime: now + SESSION_TTL_MS,
      });
      return { outcome: "saved" as const, ...stored, configKey: args.configKey };
    }

    const held = await ctx.db
      .query("appConnectionSessions")
      .withIndex("by_user_chat_key", (q) => q.eq("userId", args.userId))
      .take(MAX_SESSIONS_PER_USER);
    if (held.length >= MAX_SESSIONS_PER_USER) return { outcome: "limit" as const };

    await ctx.db.insert("appConnectionSessions", {
      userId: args.userId,
      chatKey: args.chatKey,
      ...stored,
      configKey: args.configKey,
      createdAt: now,
      updatedAt: now,
      expirationTime: now + SESSION_TTL_MS,
    });
    // Retention runs as sessions are created, so an unused feature schedules nothing.
    await ctx.scheduler.runAfter(0, internal.connections.pruneExpiredSessionsInternal, {});
    return { outcome: "saved" as const, ...stored, configKey: args.configKey };
  },
});

/** Records that stored sessions now carry `configKey`, and extends their expiry. */
export const markSessionsSyncedInternal = internalMutation({
  args: {
    userId: v.id("users"),
    configKey: v.string(),
    synced: v.array(v.object({ chatKey: v.string(), composioSessionId: v.string() })),
    gone: v.array(v.object({ chatKey: v.string(), composioSessionId: v.string() })),
    extendExpiry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const entry of args.synced) {
      const row = await getSessionRow(ctx, args.userId, entry.chatKey);
      if (!row || row.composioSessionId !== entry.composioSessionId) continue;
      await ctx.db.patch(row._id, {
        configKey: args.configKey,
        updatedAt: now,
        ...(args.extendExpiry ? { expirationTime: now + SESSION_TTL_MS } : {}),
      });
    }
    // Composio no longer has these; the relay creates a fresh session on next use.
    for (const entry of args.gone) {
      const row = await getSessionRow(ctx, args.userId, entry.chatKey);
      if (row && row.composioSessionId === entry.composioSessionId) await ctx.db.delete(row._id);
    }
  },
});

export const listUserSessionsPageInternal = internalQuery({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("appConnectionSessions")
      .withIndex("by_user_chat_key", (q) => q.eq("userId", args.userId))
      .paginate({ cursor: args.cursor, numItems: SYNC_PAGE_SIZE });
    return {
      sessions: page.page.map((row) => ({
        chatKey: row.chatKey,
        composioSessionId: row.composioSessionId,
        configKey: row.configKey,
      })),
      connectedAppIds: await listConnectedAppIds(ctx, args.userId),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Updates every stored session of a user after a connect or disconnect, one
 * bounded page at a time, so existing chats pick up the change.
 */
export const syncUserSessionsInternal = internalAction({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const client = getComposioClient();
    if (!client) return;
    const page: {
      sessions: Array<{ chatKey: string; composioSessionId: string; configKey: string }>;
      connectedAppIds: string[];
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.connections.listUserSessionsPageInternal, args);
    const result = await pushSessionConfig(client, page.sessions, page.connectedAppIds);
    if (result.synced.length > 0 || result.gone.length > 0) {
      await ctx.runMutation(internal.connections.markSessionsSyncedInternal, {
        userId: args.userId,
        ...result,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.connections.syncUserSessionsInternal, {
        userId: args.userId,
        cursor: page.continueCursor,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const pruneExpiredSessionsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("appConnectionSessions")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", Date.now()))
      .take(PRUNE_BATCH_SIZE);
    if (expired.length === 0) return { deleted: 0 };
    for (const row of expired) await ctx.db.delete(row._id);
    await ctx.scheduler.runAfter(0, internal.connections.deleteComposioSessionsInternal, {
      sessionIds: expired.map((row) => row.composioSessionId),
    });
    if (expired.length === PRUNE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.connections.pruneExpiredSessionsInternal, {});
    }
    return { deleted: expired.length };
  },
});

export const deleteComposioSessionsInternal = internalAction({
  args: { sessionIds: v.array(v.string()) },
  handler: async (_ctx: ActionCtx, args) => {
    const client = getComposioClient();
    if (!client) return;
    for (const sessionId of args.sessionIds) {
      await bestEffort(() => deleteComposioSession(client, sessionId));
    }
  },
});
