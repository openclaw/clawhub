import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  ComposioError,
  type ComposioClient,
  createComposioSession,
  deleteComposioSession,
  forwardComposioMcp,
  getComposioClient,
} from "../lib/composio";
import {
  buildSessionToolConfig,
  CONNECTIONS_MCP_PATH_PREFIX,
  isValidChatKey,
  sessionConfigKey,
} from "../lib/connectionApps";
import {
  pushSessionConfig,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
} from "../lib/connectionSessions";
import { json, requireApiTokenUserOrResponse } from "./shared";

/**
 * MCP relay for app connections: `POST /api/v1/connections/mcp/{chatKey}`.
 *
 * An OpenClaw gateway signed in with a ClawHub API token sends each chat's MCP
 * requests here. ClawHub resolves the token's user, finds or creates that
 * user's Composio session for the chat, adds the Composio project key and
 * forwards the request.
 *
 * Trust boundary:
 * - The session is always looked up by (authenticated user, chatKey). A chat
 *   key is not a credential: the same key under another user's token is a
 *   different session, holding that user's connections only.
 * - The caller's Authorization header stops here. The Composio key and the
 *   Composio session id never reach the caller.
 */
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

type RelaySession = { composioSessionId: string; mcpUrl: string };
type RelayState = {
  session: (RelaySession & { configKey: string; expirationTime: number }) | null;
  connectedAppIds: string[];
};
type SaveOutcome =
  | (RelaySession & { outcome: "saved" | "exists"; configKey: string })
  | { outcome: "limit" };

class SessionLimitError extends Error {}

function relayError(status: number, error: string, message: string, headers?: HeadersInit) {
  return json({ error, message }, status, headers);
}

function upstreamUnavailable() {
  return relayError(502, "upstream_unavailable", "The connection service is unavailable.");
}

async function createSession(
  ctx: ActionCtx,
  client: ComposioClient,
  args: { userId: Id<"users">; chatKey: string; connectedAppIds: string[]; replaces?: string },
): Promise<RelaySession> {
  const created = await createComposioSession(client, {
    userId: args.userId,
    config: buildSessionToolConfig(args.connectedAppIds),
  });
  const saved: SaveOutcome = await ctx.runMutation(internal.connections.saveSessionInternal, {
    userId: args.userId,
    chatKey: args.chatKey,
    composioSessionId: created.sessionId,
    mcpUrl: created.mcpUrl,
    configKey: sessionConfigKey(args.connectedAppIds),
    replaces: args.replaces,
  });
  if (saved.outcome === "saved") return saved;
  // Not stored: another request for this chat won the race, or the account is
  // at its session limit. Either way the session just created is unused.
  try {
    await deleteComposioSession(client, created.sessionId);
  } catch (error) {
    if (!(error instanceof ComposioError)) throw error;
  }
  if (saved.outcome === "limit") throw new SessionLimitError();
  return saved;
}

/** Finds or creates the caller's session for this chat and brings its tools up to date. */
async function resolveSession(
  ctx: ActionCtx,
  client: ComposioClient,
  userId: Id<"users">,
  chatKey: string,
): Promise<RelaySession & { connectedAppIds: string[] }> {
  const state: RelayState = await ctx.runQuery(internal.connections.getRelayStateInternal, {
    userId,
    chatKey,
  });
  const { connectedAppIds } = state;
  const stored = state.session;
  if (!stored) {
    const created = await createSession(ctx, client, { userId, chatKey, connectedAppIds });
    return { ...created, connectedAppIds };
  }

  const stale = stored.configKey !== sessionConfigKey(connectedAppIds);
  const touchDue = stored.expirationTime - Date.now() < SESSION_TTL_MS - SESSION_TOUCH_INTERVAL_MS;
  if (!stale && !touchDue) return { ...stored, connectedAppIds };

  const ref = { chatKey, composioSessionId: stored.composioSessionId };
  if (stale) {
    // A connect or disconnect normally updates every session right away. This
    // catches a session that update missed, before any tool can be reached.
    const pushed = await pushSessionConfig(
      client,
      [{ ...ref, configKey: stored.configKey }],
      connectedAppIds,
    );
    if (pushed.gone.length > 0) {
      const replaced = await createSession(ctx, client, {
        userId,
        chatKey,
        connectedAppIds,
        replaces: stored.composioSessionId,
      });
      return { ...replaced, connectedAppIds };
    }
    // Fail closed: never forward to a session that may still hold tools the
    // user has since disconnected.
    if (pushed.synced.length === 0) throw new ComposioError("session update", null);
  }
  await ctx.runMutation(internal.connections.markSessionsSyncedInternal, {
    userId,
    configKey: sessionConfigKey(connectedAppIds),
    synced: [ref],
    gone: [],
    extendExpiry: true,
  });
  return { ...stored, connectedAppIds };
}

async function readRequestBody(request: Request): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null;
  const body = await request.arrayBuffer();
  return body.byteLength > MAX_REQUEST_BYTES ? null : body;
}

async function relay(
  ctx: ActionCtx,
  client: ComposioClient,
  userId: Id<"users">,
  chatKey: string,
  forwarded: { body: ArrayBuffer; contentType: string | null; accept: string | null },
) {
  let session = await resolveSession(ctx, client, userId, chatKey);
  let upstream = await forwardComposioMcp(client, session.mcpUrl, forwarded);
  if (upstream.status === 404) {
    // Composio no longer has the stored session: replace it and try once more.
    const { connectedAppIds } = session;
    const replaced = await createSession(ctx, client, {
      userId,
      chatKey,
      connectedAppIds,
      replaces: session.composioSessionId,
    });
    session = { ...replaced, connectedAppIds };
    upstream = await forwardComposioMcp(client, session.mcpUrl, forwarded);
  }

  // These describe ClawHub's own access to Composio, not the caller's request.
  if (
    upstream.status === 401 ||
    upstream.status === 403 ||
    upstream.status === 404 ||
    upstream.status >= 500
  ) {
    throw new ComposioError("mcp forward", upstream.status);
  }

  let body: ArrayBuffer;
  try {
    body = await upstream.arrayBuffer();
  } catch {
    throw new ComposioError("mcp forward", null, "response interrupted");
  }
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  return new Response(body.byteLength > 0 ? body : null, { status: upstream.status, headers });
}

export async function connectionsMcpV1Handler(ctx: ActionCtx, request: Request) {
  const client = getComposioClient();
  // Without a Composio key the route answers like any unknown path.
  if (!client) return relayError(404, "not_found", "Not found");
  if (request.method !== "POST") {
    return relayError(405, "method_not_allowed", "This endpoint accepts POST only.", {
      Allow: "POST",
    });
  }

  const auth = await requireApiTokenUserOrResponse(ctx, request, {});
  if (!auth.ok) return auth.response;

  // Matched on the raw path: valid chat keys need no decoding, and anything
  // else, including extra path segments, is rejected.
  const chatKey = new URL(request.url).pathname.slice(CONNECTIONS_MCP_PATH_PREFIX.length);
  if (!isValidChatKey(chatKey)) {
    return relayError(400, "invalid_chat_key", "chatKey must match [A-Za-z0-9_-]{16,128}.");
  }

  const body = await readRequestBody(request);
  if (!body) return relayError(413, "request_too_large", "Request body is too large.");

  try {
    return await relay(ctx, client, auth.userId, chatKey, {
      body,
      contentType: request.headers.get("content-type"),
      accept: request.headers.get("accept"),
    });
  } catch (error) {
    if (error instanceof SessionLimitError) {
      return relayError(429, "too_many_sessions", "This account has too many active chats.");
    }
    if (error instanceof ComposioError) {
      console.warn("connections_relay_upstream_error", { status: error.status });
      return upstreamUnavailable();
    }
    throw error;
  }
}
