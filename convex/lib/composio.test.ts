/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  ComposioError,
  createComposioLink,
  createComposioSession,
  deleteComposioConnectedAccount,
  forwardComposioMcp,
  getComposioApiKey,
  isComposioUrl,
  listComposioConnectedAccounts,
  listComposioToolkitTools,
  updateComposioSession,
} from "./composio";
import { buildSessionToolConfig } from "./connectionApps";

const API_KEY = "test-composio-key";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type RecordedCall = { url: string; method: string; headers: Headers; body: unknown };

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function clientWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = requestUrl(input);
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : (init.body ?? null),
    });
    return handler(url, init);
  });
  return {
    client: { apiKey: API_KEY, fetch: fetchMock as unknown as typeof fetch },
    fetchMock,
    calls,
  };
}

describe("composio configuration", () => {
  it("is off without an API key", () => {
    expect(getComposioApiKey({})).toBeNull();
    expect(getComposioApiKey({ COMPOSIO_API_KEY: "  " })).toBeNull();
    expect(getComposioApiKey({ COMPOSIO_API_KEY: " key " })).toBe("key");
  });

  it("only treats HTTPS Composio hosts as Composio", () => {
    expect(isComposioUrl("https://backend.composio.dev/tool_router/trs_1/mcp")).toBe(true);
    expect(isComposioUrl("https://connect.composio.dev/link/lk_1")).toBe(true);
    expect(isComposioUrl("http://backend.composio.dev/tool_router/trs_1/mcp")).toBe(false);
    expect(isComposioUrl("https://backend.composio.dev.evil.example/mcp")).toBe(false);
    expect(isComposioUrl("https://evilcomposio.dev/mcp")).toBe(false);
    expect(isComposioUrl("not a url")).toBe(false);
  });
});

describe("composio sessions", () => {
  it("creates a direct-tools session for the user", async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({
        session_id: "trs_1",
        mcp: { type: "http", url: "https://backend.composio.dev/tool_router/trs_1/mcp" },
      }),
    );

    const session = await createComposioSession(client, {
      userId: "user_1",
      config: buildSessionToolConfig(["granola"]),
    });

    expect(session).toEqual({
      sessionId: "trs_1",
      mcpUrl: "https://backend.composio.dev/tool_router/trs_1/mcp",
    });
    const [call] = calls;
    expect(call?.url).toBe("https://backend.composio.dev/api/v3.1/tool_router/session");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("x-api-key")).toBe(API_KEY);
    expect(call?.body).toMatchObject({
      user_id: "user_1",
      toolkits: { enable: ["granola_mcp"] },
      manage_connections: { enable: false },
      workbench: { enable: false },
      preload: { tools: "all" },
      search: { enable: false },
      execute: { enable_multi_execute: false },
    });
    expect(call?.body).toMatchObject({
      tools: { granola_mcp: { enable: expect.arrayContaining(["GRANOLA_MCP_LIST_MEETINGS"]) } },
    });
  });

  it("rejects a session whose MCP URL is not a Composio host", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ session_id: "trs_1", mcp: { url: "https://attacker.example/mcp" } }),
    );
    await expect(
      createComposioSession(client, { userId: "user_1", config: buildSessionToolConfig([]) }),
    ).rejects.toBeInstanceOf(ComposioError);
  });

  it("always sends toolkits, tools and preload together on update", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ session_id: "trs_1" }));
    await updateComposioSession(client, "trs_1", buildSessionToolConfig([]));
    const [call] = calls;
    expect(call?.url).toBe("https://backend.composio.dev/api/v3.1/tool_router/session/trs_1");
    expect(call?.method).toBe("PATCH");
    expect(call?.body).toEqual({
      toolkits: { enable: [] },
      tools: {},
      preload: { tools: [] },
    });
  });

  it("reports the status and never the key or response body on failure", async () => {
    const { client } = clientWith(() =>
      jsonResponse(
        { error: { slug: "ToolRouterV2_BadRequest", message: `echo ${API_KEY} secret detail` } },
        400,
      ),
    );
    const error = await updateComposioSession(client, "trs_1", buildSessionToolConfig([])).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ComposioError);
    expect((error as ComposioError).status).toBe(400);
    expect((error as ComposioError).message).toContain("ToolRouterV2_BadRequest");
    expect((error as ComposioError).message).not.toContain(API_KEY);
    expect((error as ComposioError).message).not.toContain("secret detail");
  });

  it("reports an unreachable Composio without a status", async () => {
    const { client } = clientWith(() => {
      throw new TypeError(`connect failed for key ${API_KEY}`);
    });
    const error = await updateComposioSession(client, "trs_1", buildSessionToolConfig([])).catch(
      (caught: unknown) => caught,
    );
    expect((error as ComposioError).status).toBeNull();
    expect((error as ComposioError).message).not.toContain(API_KEY);
  });
});

describe("composio connected accounts", () => {
  it("starts a sign-in with the server's callback URL", async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({
        redirect_url: "https://connect.composio.dev/link/lk_1",
        connected_account_id: "ca_1",
      }),
    );
    const link = await createComposioLink(client, "trs_link", {
      toolkit: "granola_mcp",
      callbackUrl: "https://clawhub.ai/settings?view=connections",
    });
    expect(link).toEqual({
      redirectUrl: "https://connect.composio.dev/link/lk_1",
      connectedAccountId: "ca_1",
    });
    const [call] = calls;
    expect(call?.url).toBe(
      "https://backend.composio.dev/api/v3.1/tool_router/session/trs_link/link",
    );
    expect(call?.body).toEqual({
      toolkit: "granola_mcp",
      callback_url: "https://clawhub.ai/settings?view=connections",
    });
  });

  it("refuses a sign-in URL outside Composio", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ redirect_url: "https://phish.example/login", connected_account_id: "ca_1" }),
    );
    await expect(
      createComposioLink(client, "trs_link", { toolkit: "granola_mcp", callbackUrl: "https://x" }),
    ).rejects.toBeInstanceOf(ComposioError);
  });

  it("lists accounts for one user and toolkit and marks only usable ones active", async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({
        items: [
          {
            id: "ca_active",
            status: "ACTIVE",
            is_disabled: false,
            auth_config: { is_disabled: false },
            state: { val: { displayName: "ada@example.com" } },
            created_at: "2026-11-23T10:00:00.000Z",
          },
          { id: "ca_disabled", status: "ACTIVE", is_disabled: true },
          { id: "ca_config_off", status: "ACTIVE", auth_config: { is_disabled: true } },
          { id: "ca_pending", status: "INITIALIZING" },
          { status: "ACTIVE" },
        ],
        next_cursor: null,
      }),
    );

    const accounts = await listComposioConnectedAccounts(client, {
      userId: "user 1",
      toolkit: "granola_mcp",
    });

    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v3.1/connected_accounts");
    expect(url.searchParams.get("user_ids")).toBe("user 1");
    expect(url.searchParams.get("toolkit_slugs")).toBe("granola_mcp");
    expect(accounts.map((account) => [account.id, account.active, account.label])).toEqual([
      ["ca_active", true, "ada@example.com"],
      ["ca_disabled", false, null],
      ["ca_config_off", false, null],
      ["ca_pending", false, null],
    ]);
  });

  it("treats an already deleted account as deleted", async () => {
    const { client } = clientWith(() => jsonResponse({ error: { slug: "NotFound" } }, 404));
    await expect(deleteComposioConnectedAccount(client, "ca_gone")).resolves.toBeUndefined();
  });

  it("reads tool descriptions for a toolkit", async () => {
    const { client } = clientWith(() =>
      jsonResponse({
        items: [
          { slug: "GRANOLA_MCP_LIST_MEETINGS", name: "List meetings", description: "Lists." },
        ],
      }),
    );
    expect(await listComposioToolkitTools(client, "granola_mcp")).toEqual([
      { slug: "GRANOLA_MCP_LIST_MEETINGS", name: "List meetings", description: "Lists." },
    ]);
  });
});

describe("composio MCP forwarding", () => {
  it("adds the project key and passes only Content-Type and Accept through", async () => {
    const { client, calls } = clientWith(() => new Response("ok"));
    const body = new TextEncoder().encode('{"jsonrpc":"2.0"}').buffer as ArrayBuffer;
    await forwardComposioMcp(client, "https://backend.composio.dev/tool_router/trs_1/mcp", {
      body,
      contentType: "application/json",
      accept: "application/json, text/event-stream",
    });
    const [call] = calls;
    expect(call?.url).toBe("https://backend.composio.dev/tool_router/trs_1/mcp");
    expect([...(call?.headers.keys() ?? [])].sort()).toEqual([
      "accept",
      "content-type",
      "x-api-key",
    ]);
    expect(call?.headers.get("x-api-key")).toBe(API_KEY);
    expect(call?.body).toBe(body);
  });

  it("never sends the key to a non-Composio URL", async () => {
    const { client, fetchMock } = clientWith(() => new Response("ok"));
    await expect(
      forwardComposioMcp(client, "https://attacker.example/mcp", {
        body: new ArrayBuffer(0),
        contentType: null,
        accept: null,
      }),
    ).rejects.toBeInstanceOf(ComposioError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
