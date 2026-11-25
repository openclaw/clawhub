import type { ComposioSessionToolConfig } from "./connectionApps";

/**
 * Minimal Composio REST client for app connections.
 *
 * Composio performs the provider sign-in and holds the provider tokens. The
 * project API key is a backend secret: it is only ever sent to Composio, and
 * nothing here returns it, logs it, or puts it in an error message.
 */
const COMPOSIO_ORIGIN = "https://backend.composio.dev";
const COMPOSIO_API_BASE = `${COMPOSIO_ORIGIN}/api/v3.1`;
const API_TIMEOUT_MS = 20_000;
// Tool calls run through the MCP endpoint and can take much longer than API calls.
const MCP_TIMEOUT_MS = 120_000;
const ACCOUNT_PAGE_LIMIT = 50;
const MAX_ACCOUNT_PAGES = 4;
const MAX_ACCOUNT_LABEL_LENGTH = 200;

export type ComposioClient = {
  apiKey: string;
  fetch: typeof fetch;
};

export type ComposioConnectedAccount = {
  id: string;
  /** Composio status, upper-cased: ACTIVE, INITIALIZING, INITIATED, FAILED, EXPIRED, ... */
  status: string;
  /** Usable for tool calls: active, and neither it nor its auth config is disabled. */
  active: boolean;
  /** The provider account name, when Composio reports one. */
  label: string | null;
  createdAt: number;
};

export type ComposioTool = {
  slug: string;
  name: string;
  description: string;
};

/**
 * A failed Composio call. `status` is Composio's HTTP status, or null when no
 * response arrived. The message is for server logs; callers must not show it
 * to users.
 */
export class ComposioError extends Error {
  readonly status: number | null;

  constructor(operation: string, status: number | null, detail?: string) {
    super(
      `Composio ${operation} failed (${status ?? "no response"})${detail ? `: ${detail}` : ""}`,
    );
    this.name = "ComposioError";
    this.status = status;
  }
}

/** The feature exists only where this deployment has a Composio project key. */
export function getComposioApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.COMPOSIO_API_KEY?.trim() || null;
}

export function getComposioClient(
  env: Record<string, string | undefined> = process.env,
): ComposioClient | null {
  const apiKey = getComposioApiKey(env);
  return apiKey ? { apiKey, fetch } : null;
}

/** The project key is only ever sent to a Composio-operated HTTPS host. */
export function isComposioUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"))
    );
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function composioRequest(
  client: ComposioClient,
  operation: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options: { allowNotFound?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await client.fetch(`${COMPOSIO_API_BASE}${path}`, {
      method,
      headers: {
        "x-api-key": client.apiKey,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new ComposioError(operation, null);
  }

  if (response.status === 404 && options.allowNotFound) return null;
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    // Composio's error slug names the failure without echoing request data.
    const slug = asString(asRecord(asRecord(payload)?.error)?.slug);
    throw new ComposioError(operation, response.status, slug ?? undefined);
  }
  const record = asRecord(payload);
  if (!record) throw new ComposioError(operation, response.status, "unexpected response");
  return record;
}

// Direct tools preset: no meta tools, no in-chat sign-in, no sandbox. Chats
// reach exactly the allowlisted tools of the apps the user has connected.
const DIRECT_TOOLS_PRESET = {
  manage_connections: { enable: false },
  workbench: { enable: false },
  search: { enable: false },
  execute: { enable_multi_execute: false },
};

export async function createComposioSession(
  client: ComposioClient,
  args: { userId: string; config: ComposioSessionToolConfig },
): Promise<{ sessionId: string; mcpUrl: string }> {
  const payload = await composioRequest(client, "session create", "POST", "/tool_router/session", {
    user_id: args.userId,
    ...args.config,
    ...DIRECT_TOOLS_PRESET,
  });
  const sessionId = asString(payload?.session_id);
  const mcpUrl = asString(asRecord(payload?.mcp)?.url);
  if (!sessionId || !mcpUrl || !isComposioUrl(mcpUrl)) {
    throw new ComposioError("session create", 200, "unexpected response");
  }
  return { sessionId, mcpUrl };
}

/** Replaces the session's tool configuration. A missing session reports status 404. */
export async function updateComposioSession(
  client: ComposioClient,
  sessionId: string,
  config: ComposioSessionToolConfig,
) {
  await composioRequest(
    client,
    "session update",
    "PATCH",
    `/tool_router/session/${encodeURIComponent(sessionId)}`,
    config,
  );
}

export async function deleteComposioSession(client: ComposioClient, sessionId: string) {
  await composioRequest(
    client,
    "session delete",
    "DELETE",
    `/tool_router/session/${encodeURIComponent(sessionId)}`,
    undefined,
    { allowNotFound: true },
  );
}

/** Starts a provider sign-in for one toolkit and returns Composio's hosted sign-in URL. */
export async function createComposioLink(
  client: ComposioClient,
  sessionId: string,
  args: { toolkit: string; callbackUrl: string },
): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const payload = await composioRequest(
    client,
    "link create",
    "POST",
    `/tool_router/session/${encodeURIComponent(sessionId)}/link`,
    { toolkit: args.toolkit, callback_url: args.callbackUrl },
  );
  const redirectUrl = asString(payload?.redirect_url);
  const connectedAccountId = asString(payload?.connected_account_id);
  if (!redirectUrl || !connectedAccountId || !isComposioUrl(redirectUrl)) {
    throw new ComposioError("link create", 200, "unexpected response");
  }
  return { redirectUrl, connectedAccountId };
}

function readAccountLabel(account: Record<string, unknown>) {
  const stateValue = asRecord(asRecord(account.state)?.val);
  const label = asString(stateValue?.displayName) ?? asString(stateValue?.email);
  return label ? label.slice(0, MAX_ACCOUNT_LABEL_LENGTH) : null;
}

function toConnectedAccount(value: unknown): ComposioConnectedAccount | null {
  const account = asRecord(value);
  const id = asString(account?.id);
  if (!account || !id) return null;
  const status = (asString(account.status) ?? "").toUpperCase();
  const authConfigDisabled = asRecord(account.auth_config)?.is_disabled === true;
  const createdAt = Date.parse(asString(account.created_at) ?? "");
  return {
    id,
    status,
    active: status === "ACTIVE" && account.is_disabled !== true && !authConfigDisabled,
    label: readAccountLabel(account),
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/**
 * Connected accounts Composio holds for one ClawHub user and toolkit, in any
 * status. The user filter is the ownership check: callers pass the server-
 * derived user id, never an id supplied by a browser.
 */
export async function listComposioConnectedAccounts(
  client: ComposioClient,
  args: { userId: string; toolkit: string },
): Promise<ComposioConnectedAccount[]> {
  const accounts: ComposioConnectedAccount[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
    const query = new URLSearchParams({
      user_ids: args.userId,
      toolkit_slugs: args.toolkit,
      limit: String(ACCOUNT_PAGE_LIMIT),
    });
    if (cursor) query.set("cursor", cursor);
    const payload = await composioRequest(
      client,
      "connected accounts list",
      "GET",
      `/connected_accounts?${query.toString()}`,
    );
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      const account = toConnectedAccount(item);
      if (account) accounts.push(account);
    }
    cursor = asString(payload?.next_cursor);
    if (!cursor) break;
  }
  return accounts;
}

export async function deleteComposioConnectedAccount(client: ComposioClient, accountId: string) {
  await composioRequest(
    client,
    "connected account delete",
    "DELETE",
    `/connected_accounts/${encodeURIComponent(accountId)}`,
    undefined,
    { allowNotFound: true },
  );
}

export async function listComposioToolkitTools(
  client: ComposioClient,
  toolkit: string,
): Promise<ComposioTool[]> {
  const query = new URLSearchParams({ toolkit_slug: toolkit, limit: "200" });
  const payload = await composioRequest(client, "tools list", "GET", `/tools?${query.toString()}`);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const tools: ComposioTool[] = [];
  for (const item of items) {
    const tool = asRecord(item);
    const slug = asString(tool?.slug);
    if (!tool || !slug) continue;
    tools.push({
      slug,
      name: asString(tool.name) ?? slug,
      description: asString(tool.description) ?? "",
    });
  }
  return tools;
}

/**
 * Sends one MCP request to a session. The caller's body, Content-Type and
 * Accept pass through; its Authorization header never does. Throws
 * `ComposioError` with a null status when Composio cannot be reached.
 */
export async function forwardComposioMcp(
  client: ComposioClient,
  mcpUrl: string,
  args: { body: ArrayBuffer; contentType: string | null; accept: string | null },
): Promise<Response> {
  if (!isComposioUrl(mcpUrl)) throw new ComposioError("mcp forward", null, "unexpected url");
  const headers: Record<string, string> = { "x-api-key": client.apiKey };
  if (args.contentType) headers["Content-Type"] = args.contentType;
  if (args.accept) headers.Accept = args.accept;
  try {
    return await client.fetch(mcpUrl, {
      method: "POST",
      headers,
      body: args.body,
      redirect: "error",
      signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
    });
  } catch {
    throw new ComposioError("mcp forward", null);
  }
}
