/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getConnectionApp } from "./lib/connectionApps";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");

const COMPOSIO_KEY = "test-composio-project-key";
const CHAT_KEY = "chat-0123456789abcdef";
const GRANOLA_TOOLS = getConnectionApp("granola")?.tools ?? [];

type FakeSession = {
  userId: string;
  toolkits: string[];
  tools: Record<string, { enable: string[] }>;
};
type FakeAccount = {
  id: string;
  userId: string;
  toolkit: string;
  status: string;
  label?: string;
};
type RecordedCall = { method: string; url: URL; headers: Headers; body: unknown; rawBody: string };

/** In-memory stand-in for the Composio endpoints ClawHub calls. */
function createFakeComposio() {
  const sessions = new Map<string, FakeSession>();
  const accounts = new Map<string, FakeAccount>();
  const calls: RecordedCall[] = [];
  let sequence = 0;
  let outage: "network" | number | null = null;
  let failUpdates = false;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const sse = (body: unknown) =>
    new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

  function readToolConfig(body: Record<string, unknown>) {
    const toolkits = (body.toolkits as { enable: string[] }).enable;
    const preload = (body.preload as { tools: unknown }).tools;
    // Mirrors Composio: preload "all" needs a positive allowlist.
    if (preload === "all" && toolkits.length === 0) return null;
    return { toolkits, tools: body.tools as Record<string, { enable: string[] }> };
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const rawBody =
      init?.body instanceof ArrayBuffer
        ? new TextDecoder().decode(init.body)
        : typeof init?.body === "string"
          ? init.body
          : "";
    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = null;
    }
    calls.push({ method, url, headers, body, rawBody });

    if (outage === "network") throw new TypeError("network down");
    if (typeof outage === "number") return json({ error: { slug: "Outage" } }, outage);
    if (headers.get("x-api-key") !== COMPOSIO_KEY) return json({ error: { slug: "Auth" } }, 401);

    const path = url.pathname;
    const mcp = /^\/tool_router\/([^/]+)\/mcp$/.exec(path);
    if (mcp && method === "POST") {
      const session = sessions.get(mcp[1] ?? "");
      if (!session) return json({ error: { message: "session not found" } }, 404);
      const call = body as { id?: number; method?: string };
      if (call.method === "notifications/initialized") return new Response(null, { status: 202 });
      const tools = Object.values(session.tools).flatMap((entry) => entry.enable);
      if (call.method === "tools/list") {
        return sse(
          tools.length > 0
            ? { jsonrpc: "2.0", id: call.id, result: { tools: tools.map((name) => ({ name })) } }
            : { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "Method not found" } },
        );
      }
      return sse({ jsonrpc: "2.0", id: call.id, result: { servedUser: session.userId } });
    }

    const route = path.replace(/^\/api\/v3\.1/, "");
    if (route === "/tool_router/session" && method === "POST") {
      const request = body as Record<string, unknown> & { user_id: string };
      const config = readToolConfig(request);
      if (!config) return json({ error: { slug: "ToolRouterV2_BadRequest" } }, 400);
      sequence += 1;
      const id = `trs_${sequence}`;
      sessions.set(id, { userId: request.user_id, ...config });
      return json({
        session_id: id,
        mcp: { type: "http", url: `https://backend.composio.dev/tool_router/${id}/mcp` },
      });
    }
    const sessionPath = /^\/tool_router\/session\/([^/]+)(\/link)?$/.exec(route);
    if (sessionPath) {
      const id = sessionPath[1] ?? "";
      const session = sessions.get(id);
      if (!session) return json({ error: { slug: "ToolRouterV2_SessionNotFound" } }, 404);
      if (sessionPath[2] && method === "POST") {
        const { toolkit } = body as { toolkit: string };
        if (!session.toolkits.includes(toolkit)) {
          return json({ error: { slug: "ToolRouterV2_ToolkitNotAllowed" } }, 400);
        }
        sequence += 1;
        const accountId = `ca_${sequence}`;
        accounts.set(accountId, {
          id: accountId,
          userId: session.userId,
          toolkit,
          status: "INITIALIZING",
        });
        return json({
          redirect_url: `https://connect.composio.dev/link/lk_${sequence}`,
          connected_account_id: accountId,
        });
      }
      if (method === "PATCH") {
        if (failUpdates) return json({ error: { slug: "Unavailable" } }, 503);
        const config = readToolConfig(body as Record<string, unknown>);
        if (!config) return json({ error: { slug: "ToolRouterV2_BadRequest" } }, 400);
        sessions.set(id, { userId: session.userId, ...config });
        return json({ session_id: id });
      }
      if (method === "DELETE") {
        sessions.delete(id);
        return json({ session_id: id, deleted: true });
      }
    }
    if (route === "/connected_accounts" && method === "GET") {
      const userId = url.searchParams.get("user_ids");
      const toolkit = url.searchParams.get("toolkit_slugs");
      const items = [...accounts.values()]
        .filter((account) => account.userId === userId && account.toolkit === toolkit)
        .map((account) => ({
          id: account.id,
          status: account.status,
          is_disabled: false,
          auth_config: { is_disabled: false },
          toolkit: { slug: account.toolkit },
          state: { val: account.label ? { displayName: account.label } : {} },
          created_at: "2026-11-23T10:00:00.000Z",
        }));
      return json({ items, next_cursor: null });
    }
    const accountPath = /^\/connected_accounts\/([^/]+)$/.exec(route);
    if (accountPath && method === "DELETE") {
      if (!accounts.delete(accountPath[1] ?? "")) return json({ error: {} }, 404);
      return json({ success: true });
    }
    if (route === "/tools" && method === "GET") {
      return json({
        items: [
          ...GRANOLA_TOOLS.map((slug) => ({ slug, name: slug, description: `About ${slug}` })),
          { slug: "GRANOLA_MCP_CREATE_FOLDER", name: "Create folder", description: "Writes." },
        ],
      });
    }
    return json({ error: { slug: "Unexpected" } }, 500);
  });

  return {
    sessions,
    accounts,
    calls,
    fetchMock,
    setOutage: (value: "network" | number | null) => {
      outage = value;
    },
    setFailUpdates: (value: boolean) => {
      failUpdates = value;
    },
    addAccount: (account: FakeAccount) => accounts.set(account.id, account),
    callsTo: (method: string, pathPattern: RegExp) =>
      calls.filter((call) => call.method === method && pathPattern.test(call.url.pathname)),
  };
}

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const users = await t.run(async (ctx) => {
    const ada = await ctx.db.insert("users", { handle: "ada" });
    const grace = await ctx.db.insert("users", { handle: "grace" });
    for (const [userId, token] of [
      [ada, "clh_ada"],
      [grace, "clh_grace"],
    ] as const) {
      await ctx.db.insert("apiTokens", {
        userId,
        label: "gateway",
        prefix: token,
        tokenHash: await hashToken(token),
        createdAt: 1,
      });
    }
    return { ada, grace };
  });
  const as = (userId: Id<"users">) => t.withIdentity({ subject: `${userId}|test-session` });
  return { t, ...users, asAda: as(users.ada), asGrace: as(users.grace) };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function rpc(method: string, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method });
}

async function relay(
  t: Fixture["t"],
  token: string | null,
  options: { chatKey?: string; method?: string; body?: string } = {},
) {
  const method = options.method ?? "POST";
  return await t.fetch(`/api/v1/connections/mcp/${options.chatKey ?? CHAT_KEY}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    ...(method === "POST" ? { body: options.body ?? rpc("tools/list") } : {}),
  });
}

async function connectGranola(context: Fixture, composio: ReturnType<typeof createFakeComposio>) {
  const started = await context.asAda.action(api.connections.startConnect, { app: "granola" });
  if (started.status !== "pending") throw new Error("expected a pending sign-in");
  const account = [...composio.accounts.values()].find((entry) => entry.userId === context.ada);
  if (!account) throw new Error("sign-in did not create an account");
  account.status = "ACTIVE";
  account.label = "ada@example.com";
  const verified = await context.asAda.action(api.connections.verify, { app: "granola" });
  await context.t.finishAllScheduledFunctions(vi.runAllTimers);
  return { started, verified, accountId: account.id };
}

let composio: ReturnType<typeof createFakeComposio>;

beforeEach(() => {
  vi.useFakeTimers();
  composio = createFakeComposio();
  vi.stubGlobal("fetch", composio.fetchMock);
  vi.stubEnv("COMPOSIO_API_KEY", COMPOSIO_KEY);
  vi.stubEnv("SITE_URL", "https://clawhub.example");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("connections relay", () => {
  it("answers 404 and calls nothing when the feature is not configured", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "");
    const { t } = await fixture();

    for (const method of ["POST", "GET", "DELETE"]) {
      const response = await relay(t, "clh_ada", { method });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found", message: "Not found" });
    }
    expect(composio.fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("appConnectionSessions").take(1))).toEqual([]);
  });

  it("rejects a missing or unknown token before reaching Composio", async () => {
    const { t } = await fixture();
    expect((await relay(t, null)).status).toBe(401);
    expect((await relay(t, "clh_unknown")).status).toBe(401);
    expect(composio.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "short",
    "has.dot.0123456789abcdef",
    "percent%2F0123456789abcdef",
    `${CHAT_KEY}/extra`,
    "a".repeat(129),
  ])("rejects chat key %j", async (chatKey) => {
    const { t } = await fixture();
    const response = await relay(t, "clh_ada", { chatKey });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_chat_key");
    expect(composio.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT", "PATCH", "DELETE"])("answers 405 to %s", async (method) => {
    const { t } = await fixture();
    const response = await relay(t, "clh_ada", { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(composio.fetchMock).not.toHaveBeenCalled();
  });

  it("creates an empty-allowlist session for a user with no apps and forwards unchanged", async () => {
    const { t, ada } = await fixture();
    const body = rpc("ping", 7);

    const response = await relay(t, "clh_ada", { body });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await response.text();
    expect(text).toBe(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 7, result: { servedUser: ada } })}\n\n`,
    );

    const [create] = composio.callsTo("POST", /\/tool_router\/session$/);
    expect(create?.body).toEqual({
      user_id: ada,
      toolkits: { enable: [] },
      tools: {},
      preload: { tools: [] },
      manage_connections: { enable: false },
      workbench: { enable: false },
      search: { enable: false },
      execute: { enable_multi_execute: false },
    });

    const [forwarded] = composio.callsTo("POST", /\/mcp$/);
    expect(forwarded?.rawBody).toBe(body);
    expect(forwarded?.headers.get("x-api-key")).toBe(COMPOSIO_KEY);
    expect(forwarded?.headers.get("authorization")).toBeNull();
    expect(forwarded?.headers.get("content-type")).toBe("application/json");
    expect(forwarded?.headers.get("accept")).toBe("application/json, text/event-stream");

    // Nothing that identifies ClawHub's Composio access reaches the caller.
    const exposed = `${text}${JSON.stringify([...response.headers.entries()])}`;
    expect(exposed).not.toContain(COMPOSIO_KEY);
    expect(exposed).not.toContain("trs_");
  });

  it("passes an empty 202 notification reply through", async () => {
    const { t } = await fixture();
    const response = await relay(t, "clh_ada", { body: rpc("notifications/initialized") });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("reuses the stored session for the same user and chat", async () => {
    const { t } = await fixture();
    await relay(t, "clh_ada");
    await relay(t, "clh_ada");
    expect(composio.callsTo("POST", /\/tool_router\/session$/)).toHaveLength(1);
    expect(composio.callsTo("POST", /\/mcp$/)).toHaveLength(2);
    await relay(t, "clh_ada", { chatKey: "another-chat-0123456789" });
    expect(composio.callsTo("POST", /\/tool_router\/session$/)).toHaveLength(2);
  });

  it("keeps two users on the same chat key in separate sessions", async () => {
    const context = await fixture();
    const { t, ada, grace } = context;
    await connectGranola(context, composio);

    const adaReply = await (await relay(t, "clh_ada", { body: rpc("ping") })).text();
    const graceReply = await (await relay(t, "clh_grace", { body: rpc("ping") })).text();
    expect(adaReply).toContain(ada);
    expect(graceReply).toContain(grace);
    expect(graceReply).not.toContain(ada);

    const rows = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(10));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.composioSessionId)).size).toBe(2);
    expect(new Set(rows.map((row) => row.chatKey))).toEqual(new Set([CHAT_KEY]));
    for (const row of rows) {
      expect(composio.sessions.get(row.composioSessionId)?.userId).toBe(row.userId);
    }

    // Ada's connection gives Grace's session, on the same chat key, no tools.
    const adaTools = await (await relay(t, "clh_ada")).text();
    const graceTools = await (await relay(t, "clh_grace")).text();
    expect(adaTools).toContain("GRANOLA_MCP_GET_ACCOUNT_INFO");
    expect(adaTools).not.toMatch(/MEETING|TRANSCRIPT/);
    expect(graceTools).not.toContain("GRANOLA_MCP");
    expect(graceTools).toContain("Method not found");
  });

  it("answers 502 without internals when Composio is unreachable or failing", async () => {
    const { t } = await fixture();
    await relay(t, "clh_ada");

    for (const outage of ["network", 500, 401] as const) {
      composio.setOutage(outage);
      const response = await relay(t, "clh_ada");
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        error: "upstream_unavailable",
        message: "The connection service is unavailable.",
      });
      expect(text).not.toContain(COMPOSIO_KEY);
      expect(text).not.toContain("trs_");
    }

    composio.setOutage("network");
    const firstUse = await relay(t, "clh_grace");
    expect(firstUse.status).toBe(502);
  });

  it("passes a client-level error status from Composio through", async () => {
    const { t } = await fixture();
    await relay(t, "clh_ada");
    composio.setOutage(406);
    const response = await relay(t, "clh_ada");
    expect(response.status).toBe(406);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("replaces a session Composio no longer has", async () => {
    const { t } = await fixture();
    await relay(t, "clh_ada");
    composio.sessions.clear();

    const response = await relay(t, "clh_ada", { body: rpc("ping") });

    expect(response.status).toBe(200);
    expect(composio.callsTo("POST", /\/tool_router\/session$/)).toHaveLength(2);
    const rows = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(10));
    expect(rows).toHaveLength(1);
    expect(composio.sessions.has(rows[0]?.composioSessionId ?? "")).toBe(true);
  });

  it("brings a stale session up to date before forwarding, and fails closed if it cannot", async () => {
    const context = await fixture();
    const { t, ada } = context;
    await relay(t, "clh_ada");
    await connectGranola(context, composio);

    // Simulate a disconnect whose session update never reached this session.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("appConnections")
        .withIndex("by_user_app", (q) => q.eq("userId", ada).eq("app", "granola"))
        .unique();
      if (row) await ctx.db.patch(row._id, { status: "disconnected" });
    });
    composio.setFailUpdates(true);
    const forwardsBefore = composio.callsTo("POST", /\/mcp$/).length;
    expect((await relay(t, "clh_ada")).status).toBe(502);
    expect(composio.callsTo("POST", /\/mcp$/)).toHaveLength(forwardsBefore);

    composio.setFailUpdates(false);
    const reply = await (await relay(t, "clh_ada")).text();
    expect(reply).not.toContain("GRANOLA_MCP");
    const [row] = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(1));
    expect(row?.configKey).toBe("");
  });

  it("refuses new sessions once an account holds the maximum", async () => {
    const { t, ada } = await fixture();
    await t.run(async (ctx) => {
      for (let index = 0; index < 1000; index += 1) {
        await ctx.db.insert("appConnectionSessions", {
          userId: ada,
          chatKey: `seeded-chat-key-${String(index).padStart(4, "0")}`,
          composioSessionId: `trs_seed_${index}`,
          mcpUrl: `https://backend.composio.dev/tool_router/trs_seed_${index}/mcp`,
          configKey: "",
          createdAt: 1,
          updatedAt: 1,
          expirationTime: Date.now() + 60_000,
        });
      }
    });

    const response = await relay(t, "clh_ada");

    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("too_many_sessions");
    // The session created for the refused request is not left behind.
    expect(composio.sessions.size).toBe(0);
  });
});

describe("connecting and disconnecting an app", () => {
  it("behaves as absent when the feature is not configured", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "");
    const { asAda } = await fixture();
    expect(await asAda.query(api.connections.getMine, {})).toBeNull();
    await expect(asAda.action(api.connections.startConnect, { app: "granola" })).rejects.toThrow(
      "Connections are not available.",
    );
    await expect(asAda.action(api.connections.verify, { app: "granola" })).rejects.toThrow();
    await expect(asAda.action(api.connections.listTools, { app: "granola" })).rejects.toThrow();
    expect(composio.fetchMock).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    const { t } = await fixture();
    expect(await t.query(api.connections.getMine, {})).toBeNull();
    await expect(t.action(api.connections.startConnect, { app: "granola" })).rejects.toThrow();
    await expect(t.action(api.connections.disconnect, { app: "granola" })).rejects.toThrow();
    expect(composio.fetchMock).not.toHaveBeenCalled();
  });

  it("lists exactly the exposed tools with Composio's descriptions", async () => {
    const { asAda } = await fixture();
    const overview = await asAda.query(api.connections.getMine, {});
    expect(overview?.apps).toEqual([
      expect.objectContaining({
        id: "granola",
        name: "Granola",
        status: "disconnected",
        accountLabel: null,
        lastError: null,
        tools: GRANOLA_TOOLS,
      }),
    ]);

    const tools = await asAda.action(api.connections.listTools, { app: "granola" });
    expect(tools.map((tool) => tool.slug)).toEqual(GRANOLA_TOOLS);
    expect(tools[0]?.description).toBe(`About ${GRANOLA_TOOLS[0]}`);
  });

  it("shows connected only after Composio confirms the account, then updates every session", async () => {
    const context = await fixture();
    const { t, ada, asAda, asGrace } = context;
    await relay(t, "clh_ada");
    await relay(t, "clh_ada", { chatKey: "second-chat-0123456789" });
    await relay(t, "clh_grace");

    const started = await asAda.action(api.connections.startConnect, { app: "granola" });
    expect(started).toMatchObject({
      status: "pending",
      redirectUrl: expect.stringMatching(/^https:\/\/connect\.composio\.dev\/link\//),
    });
    const [link] = composio.callsTo("POST", /\/link$/);
    if (!link) throw new Error("missing link request");
    const callback = new URL((link.body as { callback_url: string }).callback_url);
    expect(callback.origin).toBe("https://clawhub.example");
    expect(callback.pathname).toBe("/settings");
    expect(callback.searchParams.get("view")).toBe("connections");
    expect(callback.searchParams.get("app")).toBe("granola");

    // Returning from the provider is not proof: Composio still says pending.
    expect(await asAda.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "pending",
    });
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "pending",
      accountLabel: null,
    });

    const account = [...composio.accounts.values()][0];
    if (!account) throw new Error("missing sign-in account");
    account.status = "ACTIVE";
    account.label = "ada@example.com";
    expect(await asAda.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "connected",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "connected",
      accountLabel: "ada@example.com",
      lastError: null,
    });
    // Another user sees nothing of Ada's connection.
    expect((await asGrace.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "disconnected",
      accountLabel: null,
    });

    const rows = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(10));
    for (const row of rows) {
      const session = composio.sessions.get(row.composioSessionId);
      if (row.userId === ada) {
        expect(session?.toolkits).toEqual(["granola_mcp"]);
        expect(session?.tools.granola_mcp?.enable).toEqual(GRANOLA_TOOLS);
        expect(row.configKey).not.toBe("");
      } else {
        expect(session?.toolkits).toEqual([]);
        expect(row.configKey).toBe("");
      }
    }
    const updates = composio.callsTo("PATCH", /\/tool_router\/session\//);
    expect(updates).toHaveLength(2);
    expect(updates[0]?.body).toEqual({
      toolkits: { enable: ["granola_mcp"] },
      tools: { granola_mcp: { enable: GRANOLA_TOOLS } },
      preload: { tools: "all" },
    });
  });

  it("removes the account at Composio on disconnect and narrows every session", async () => {
    const context = await fixture();
    const { t, asAda } = context;
    await relay(t, "clh_ada");
    const { accountId } = await connectGranola(context, composio);
    expect(composio.accounts.has(accountId)).toBe(true);

    expect(await asAda.action(api.connections.disconnect, { app: "granola" })).toEqual({
      status: "disconnected",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(composio.accounts.size).toBe(0);
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "disconnected",
      accountLabel: null,
      lastError: null,
    });
    const [row] = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(1));
    expect(composio.sessions.get(row?.composioSessionId ?? "")?.toolkits).toEqual([]);
    expect(composio.callsTo("PATCH", /\/tool_router\/session\//).at(-1)?.body).toEqual({
      toolkits: { enable: [] },
      tools: {},
      preload: { tools: [] },
    });
  });

  it("keeps the connection when Composio cannot remove the account", async () => {
    const context = await fixture();
    const { asAda } = context;
    await connectGranola(context, composio);
    composio.setOutage(503);

    await expect(asAda.action(api.connections.disconnect, { app: "granola" })).rejects.toThrow(
      "The connection service is not responding.",
    );
    composio.setOutage(null);
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]?.status).toBe("connected");
  });

  it("recognises an account connected for the same user outside the page", async () => {
    const { ada, asAda, asGrace } = await fixture();
    composio.addAccount({
      id: "ca_external",
      userId: ada,
      toolkit: "granola_mcp",
      status: "ACTIVE",
      label: "ada@work.example",
    });

    // Grace asking does not pick up Ada's account.
    expect(await asGrace.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "disconnected",
    });
    expect(await asAda.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "connected",
    });
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "connected",
      accountLabel: "ada@work.example",
    });
    expect((await asGrace.query(api.connections.getMine, {}))?.apps[0]?.status).toBe(
      "disconnected",
    );

    // Starting a sign-in while already connected records the connection instead.
    expect(await asAda.action(api.connections.startConnect, { app: "granola" })).toEqual({
      status: "connected",
    });
    expect(composio.callsTo("POST", /\/link$/)).toHaveLength(0);
  });

  it("reports a failed sign-in", async () => {
    const { asAda } = await fixture();
    await asAda.action(api.connections.startConnect, { app: "granola" });
    const account = [...composio.accounts.values()][0];
    if (!account) throw new Error("missing sign-in account");
    account.status = "FAILED";

    expect(await asAda.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "disconnected",
    });
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "disconnected",
      lastError: "failed",
    });
    expect(composio.accounts.size).toBe(0);
  });

  it("ends a sign-in the browser reports as failed, but only for that attempt", async () => {
    const { asAda } = await fixture();
    const started = await asAda.action(api.connections.startConnect, { app: "granola" });
    if (started.status !== "pending") throw new Error("expected a pending sign-in");

    expect(
      await asAda.action(api.connections.verify, {
        app: "granola",
        attemptId: "someone-elses-attempt",
        outcome: "failed",
      }),
    ).toEqual({ status: "pending" });

    expect(
      await asAda.action(api.connections.verify, {
        app: "granola",
        attemptId: started.attemptId,
        outcome: "failed",
      }),
    ).toEqual({ status: "disconnected" });
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "disconnected",
      lastError: "cancelled",
    });
  });

  it("treats a sign-in nobody finished as expired", async () => {
    const { asAda } = await fixture();
    await asAda.action(api.connections.startConnect, { app: "granola" });
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);

    expect(await asAda.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "disconnected",
    });
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "disconnected",
      lastError: "expired",
    });
  });

  it("lets the user cancel a pending sign-in", async () => {
    const { asAda } = await fixture();
    await asAda.action(api.connections.startConnect, { app: "granola" });
    expect(await asAda.action(api.connections.cancelConnect, { app: "granola" })).toEqual({
      status: "disconnected",
    });
    expect(composio.accounts.size).toBe(0);
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "disconnected",
      lastError: null,
    });
  });

  it("keeps a sign-in pending when Composio cannot remove it on cancel", async () => {
    const { asAda } = await fixture();
    await asAda.action(api.connections.startConnect, { app: "granola" });
    // The sign-in completed after the page last checked.
    const account = [...composio.accounts.values()][0];
    if (!account) throw new Error("missing sign-in account");
    account.status = "ACTIVE";
    composio.setOutage(503);

    await expect(asAda.action(api.connections.cancelConnect, { app: "granola" })).rejects.toThrow(
      "The connection service is not responding.",
    );
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]?.status).toBe("pending");

    composio.setOutage(null);
    expect(await asAda.action(api.connections.cancelConnect, { app: "granola" })).toEqual({
      status: "disconnected",
    });
    // The completed account is gone, so a later check cannot reconnect it.
    expect(composio.accounts.size).toBe(0);
    expect(await asAda.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "disconnected",
    });
  });

  it("notices a connection that was revoked elsewhere and narrows sessions", async () => {
    const context = await fixture();
    const { t, asAda } = context;
    await relay(t, "clh_ada");
    const { accountId } = await connectGranola(context, composio);
    composio.accounts.delete(accountId);

    expect(await asAda.action(api.connections.verify, { app: "granola" })).toEqual({
      status: "disconnected",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "disconnected",
      lastError: "lost",
    });
    const [row] = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(1));
    expect(composio.sessions.get(row?.composioSessionId ?? "")?.toolkits).toEqual([]);
  });

  it("starts a fresh sign-in when the recorded connection is gone at Composio", async () => {
    const context = await fixture();
    const { t, asAda } = context;
    await relay(t, "clh_ada");
    const { accountId } = await connectGranola(context, composio);
    composio.accounts.delete(accountId);

    const started = await asAda.action(api.connections.startConnect, { app: "granola" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(started.status).toBe("pending");
    expect((await asAda.query(api.connections.getMine, {}))?.apps[0]).toMatchObject({
      status: "pending",
      accountLabel: null,
    });
    // The stale connection no longer gives the user's chats any tools.
    const [row] = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(1));
    expect(composio.sessions.get(row?.composioSessionId ?? "")?.toolkits).toEqual([]);
  });

  it("does not leak Composio details when a check fails", async () => {
    const { asAda } = await fixture();
    composio.setOutage(500);
    const error = await asAda
      .action(api.connections.verify, { app: "granola" })
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("The connection service is not responding.");
    expect(String(error)).not.toContain(COMPOSIO_KEY);
    expect(String(error)).not.toContain("Outage");
  });
});

describe("session retention", () => {
  it("drops expired sessions here and at Composio", async () => {
    const { t } = await fixture();
    await relay(t, "clh_ada");
    await relay(t, "clh_grace");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(10));
    const [expired, kept] = rows;
    if (!expired || !kept) throw new Error("missing fixture sessions");
    await t.run((ctx) => ctx.db.patch(expired._id, { expirationTime: Date.now() - 1 }));

    expect(await t.mutation(internal.connections.pruneExpiredSessionsInternal, {})).toEqual({
      deleted: 1,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const remaining = await t.run((ctx) => ctx.db.query("appConnectionSessions").take(10));
    expect(remaining.map((row) => row._id)).toEqual([kept._id]);
    expect(composio.sessions.has(expired.composioSessionId)).toBe(false);
    expect(composio.sessions.has(kept.composioSessionId)).toBe(true);
  });
});
