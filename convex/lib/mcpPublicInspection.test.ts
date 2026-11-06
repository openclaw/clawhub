// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestPublicResource } from "../../server/og/requestPublicImage";
import { inspectPublicMcp } from "./mcpPublicInspection";
vi.mock("../../server/og/requestPublicImage", () => ({ requestPublicResource: vi.fn() }));
const request = vi.mocked(requestPublicResource);
const initialized = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2025-03-26",
    serverInfo: { name: "Example", version: "1.0" },
    instructions: "never expose me",
  },
};
beforeEach(() => {
  request.mockReset();
});
describe("public MCP inspection", () => {
  it("reads CRLF SSE initialize after keepalives without exposing instructions", async () => {
    request.mockResolvedValue(
      new Response(
        `: ping\r\n\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message" })}\r\n\r\ndata: ${JSON.stringify(initialized)}\r\n\r\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const result = await inspectPublicMcp("https://mcp.example.com/mcp", "streamable-http");
    expect(result).toMatchObject({
      status: "available",
      name: "Example",
      protocolVersion: "2025-03-26",
    });
    expect(JSON.stringify(result)).not.toContain("never expose me");
    expect(request.mock.calls[0][2].headers).not.toHaveProperty("Authorization");
  });
  it("bounds responses and rejects unrelated JSON", async () => {
    request
      .mockResolvedValueOnce(new Response("x".repeat(65 * 1024)))
      .mockResolvedValueOnce(Response.json({ status: "healthy" }));
    expect((await inspectPublicMcp("https://mcp.example.com", "streamable-http")).status).toBe(
      "unavailable",
    );
    expect((await inspectPublicMcp("https://mcp.example.com", "streamable-http")).status).toBe(
      "unavailable",
    );
  });
  it("does not follow redirects, private URLs, or SSE session endpoints", async () => {
    request.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: "http://localhost/" } }),
    );
    expect((await inspectPublicMcp("https://mcp.example.com", "streamable-http")).status).toBe(
      "unavailable",
    );
    expect((await inspectPublicMcp("https://127.0.0.1", "streamable-http")).status).toBe(
      "unavailable",
    );
    request.mockResolvedValueOnce(
      new Response("event: endpoint\ndata: http://localhost/private\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    expect((await inspectPublicMcp("https://mcp.example.com/sse", "sse")).status).toBe("available");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("distinguishes OAuth discovery from a successful client registration or sign-in", async () => {
    request
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ authorization_servers: ["https://auth.example.com"] }))
      .mockResolvedValueOnce(
        Response.json({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
          code_challenge_methods_supported: ["S256"],
        }),
      );
    expect(
      await inspectPublicMcp("https://mcp.example.com/mcp", "streamable-http", true),
    ).toMatchObject({ status: "authentication-required", oauthDiscovery: "ready" });
    expect(request.mock.calls.slice(1).every((call) => !call[2].body)).toBe(true);
  });
  it("accepts CIMD-only discovery with an explicitly authored usable client document", async () => {
    const clientMetadataUrl = "https://client.example.com/oauth/client.json";
    request.mockImplementation(async (url) => {
      if (url.href === "https://mcp.example.com/mcp") return new Response(null, { status: 401 });
      if (url.pathname.includes("oauth-protected-resource"))
        return Response.json({ authorization_servers: ["https://auth.example.com"] });
      if (url.hostname === "auth.example.com")
        return Response.json({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          client_id_metadata_document_supported: true,
          code_challenge_methods_supported: ["S256"],
        });
      if (url.href === clientMetadataUrl)
        return Response.json({
          client_id: clientMetadataUrl,
          client_name: "Example MCP client",
          redirect_uris: ["http://127.0.0.1:3000/callback"],
          token_endpoint_auth_method: "none",
        });
      return new Response(null, { status: 404 });
    });
    expect(
      await inspectPublicMcp(
        "https://mcp.example.com/mcp",
        "streamable-http",
        true,
        clientMetadataUrl,
      ),
    ).toMatchObject({ status: "authentication-required", oauthDiscovery: "ready" });
    expect(request.mock.calls.map(([url]) => url.href)).toContain(clientMetadataUrl);
    expect(request.mock.calls.slice(1).every((call) => !call[2].body)).toBe(true);
    expect(
      request.mock.calls.every((call) => !Object.hasOwn(call[2].headers, "Authorization")),
    ).toBe(true);
  });

  it.each([
    { label: "missing authored URL", authored: undefined },
    { label: "root URL", authored: "https://client.example.com/" },
    { label: "private URL", authored: "https://127.0.0.1/client.json" },
    { label: "missing capability", metadata: { client_id_metadata_document_supported: undefined } },
    { label: "false capability", metadata: { client_id_metadata_document_supported: false } },
    { label: "string capability", metadata: { client_id_metadata_document_supported: "true" } },
    { label: "issuer mismatch", metadata: { issuer: "https://other.example.com" } },
    {
      label: "unsafe authorization",
      metadata: { authorization_endpoint: "http://localhost/authorize" },
    },
    { label: "missing token endpoint", metadata: { token_endpoint: undefined } },
    { label: "plain PKCE only", metadata: { code_challenge_methods_supported: ["plain"] } },
    {
      label: "wrong client identity",
      client: { client_id: "https://other.example.com/client.json" },
    },
    { label: "missing client name", client: { client_name: undefined } },
    { label: "shared client secret", client: { client_secret: "fixture-not-a-real-secret" } },
    { label: "secret expiry", client: { client_secret_expires_at: 0 } },
    {
      label: "shared-secret authentication",
      client: { token_endpoint_auth_method: "client_secret_basic" },
    },
    { label: "non-string authentication", client: { token_endpoint_auth_method: 42 } },
    { label: "empty redirects", client: { redirect_uris: [] } },
    { label: "invalid redirects", client: { redirect_uris: [42] } },
    {
      label: "remote HTTP redirect",
      client: { redirect_uris: ["http://client.example.com/callback"] },
    },
    {
      label: "fragment redirect",
      client: { redirect_uris: ["http://localhost/callback#fragment"] },
    },
    { label: "unavailable document", response: () => new Response(null, { status: 404 }) },
    {
      label: "redirected document",
      response: () =>
        new Response(null, { status: 302, headers: { Location: "http://localhost/" } }),
    },
    { label: "oversized document", response: () => new Response("x".repeat(65 * 1024)) },
    { label: "malformed document", response: () => new Response("not JSON") },
    { label: "array document", response: () => Response.json([]) },
  ])("rejects CIMD discovery with $label", async (testCase) => {
    const clientMetadataUrl = "https://client.example.com/oauth/client.json";
    const authored = "authored" in testCase ? testCase.authored : clientMetadataUrl;
    request.mockImplementation(async (url) => {
      if (url.href === "https://mcp.example.com/mcp") return new Response(null, { status: 401 });
      if (url.pathname.includes("oauth-protected-resource"))
        return Response.json({ authorization_servers: ["https://auth.example.com"] });
      if (url.hostname === "auth.example.com")
        return Response.json({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          client_id_metadata_document_supported: true,
          code_challenge_methods_supported: ["S256"],
          ...testCase.metadata,
        });
      return (
        testCase.response?.() ??
        Response.json({
          client_id: clientMetadataUrl,
          client_name: "Example MCP client",
          redirect_uris: ["http://127.0.0.1:3000/callback"],
          ...testCase.client,
        })
      );
    });
    expect(
      await inspectPublicMcp("https://mcp.example.com/mcp", "streamable-http", true, authored),
    ).toMatchObject({ status: "authentication-required", oauthDiscovery: "unavailable" });
    expect(request.mock.calls.map(([url]) => url.protocol)).not.toContain("http:");
  });

  it.each([
    { label: "legacy DCR", registration: "https://auth.example.com/register", expected: "ready" },
    { label: "unsafe DCR", registration: "http://localhost/register", expected: "unavailable" },
    { label: "no identity mechanism", registration: undefined, expected: "unavailable" },
  ])("retains the $label path without CIMD authoring", async ({ registration, expected }) => {
    request.mockImplementation(async (url) => {
      if (url.href === "https://mcp.example.com/mcp") return new Response(null, { status: 401 });
      if (url.pathname.includes("oauth-protected-resource"))
        return Response.json({ authorization_servers: ["https://auth.example.com"] });
      return Response.json({
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: registration,
        code_challenge_methods_supported: ["S256"],
      });
    });
    expect(
      (await inspectPublicMcp("https://mcp.example.com/mcp", "streamable-http", true))
        .oauthDiscovery,
    ).toBe(expected);
  });

  it("does not treat a 401 as compatible OAuth discovery", async () => {
    request.mockImplementation(async () => new Response(null, { status: 401 }));
    expect(
      await inspectPublicMcp("https://mcp.example.com", "streamable-http", true),
    ).toMatchObject({ status: "authentication-required", oauthDiscovery: "unavailable" });
  });
});
