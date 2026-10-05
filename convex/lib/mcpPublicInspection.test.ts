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
beforeEach(() => request.mockReset());
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
  it("does not treat a 401 as compatible OAuth discovery", async () => {
    request.mockImplementation(async () => new Response(null, { status: 401 }));
    expect(
      await inspectPublicMcp("https://mcp.example.com", "streamable-http", true),
    ).toMatchObject({ status: "authentication-required", oauthDiscovery: "unavailable" });
  });
});
