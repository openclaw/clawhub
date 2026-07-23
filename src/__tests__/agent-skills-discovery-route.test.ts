import { describe, expect, it } from "vitest";
import { proxyAgentSkillsDiscoveryResponse } from "../routes/$owner/skills/$slug/[.]well-known/agent-skills/index[.]json";

describe("Agent Skills discovery route", () => {
  it("does not forward stale compression or transport headers", async () => {
    const upstream = new Response('{"skills":[]}', {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=60",
        Connection: "keep-alive",
        "Content-Encoding": "gzip",
        "Content-Length": "123",
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    const response = await proxyAgentSkillsDiscoveryResponse(upstream);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"skills":[]}');
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Connection")).toBeNull();
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
  });

  it("returns the discovery headers without a body for HEAD requests", async () => {
    const upstream = new Response('{"skills":[]}', {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    const response = await proxyAgentSkillsDiscoveryResponse(upstream, false);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });
});
