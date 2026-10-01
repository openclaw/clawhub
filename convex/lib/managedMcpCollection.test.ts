import { describe, expect, it } from "vitest";
import definitions from "../../fixtures/managed-mcp/launch.json";
import { buildManagedMcpBundle } from "./managedMcpBundle";

describe("managed MCP launch collection", () => {
  it("builds all 66 selected integrations as installable bundles with owned icons", () => {
    expect(definitions).toHaveLength(66);
    expect(new Set(definitions.map((entry) => entry.id)).size).toBe(66);
    const counts = { oauth: 0, "api-key": 0, none: 0 };
    for (const entry of definitions) {
      const bundle = buildManagedMcpBundle(entry);
      counts[bundle.definition.connection.auth.kind]++;
      expect(bundle.files.some((file) => file.path === ".claude-plugin/plugin.json")).toBe(true);
      expect(bundle.files.some((file) => file.path === "assets/icon.png")).toBe(true);
      expect(bundle.definition.icon.license).toBe("MIT");
      expect(bundle.files.some((file) => /\.(?:js|ts|sh|py)$/.test(file.path))).toBe(false);
    }
    expect(counts).toEqual({ oauth: 54, "api-key": 1, none: 11 });
    for (const id of [
      "figma",
      "gamma",
      "strava",
      "n8n",
      "unreal-engine",
      "google-drive",
      "asana",
    ]) {
      expect(definitions.some((entry) => entry.id === id)).toBe(false);
    }
  });

  it("preserves the reviewed scopes, query restrictions, transport, and credential placeholder", () => {
    const get = (id: string) => definitions.find((entry) => entry.id === id)?.connection;
    expect(get("indeed")?.auth).toEqual({
      kind: "oauth",
      scope: "job_seeker.jobs.search offline_access",
    });
    expect(get("cloudflare")?.url).toBe("https://mcp.cloudflare.com/mcp?codemode=false");
    expect(get("klaviyo")?.url).toBe(
      "https://mcp.klaviyo.com/mcp?core-tools-only=true&disable-tools-with-user-generated-content=true",
    );
    expect(get("postman")?.url).toBe("https://mcp.postman.com/minimal");
    expect(get("paypal")?.transport).toBe("sse");
    expect(get("square")?.transport).toBe("sse");
    expect(get("posthog")?.auth).toEqual({
      kind: "api-key",
      header: "Authorization",
      placeholder: "Bearer ${POSTHOG_MCP_TOKEN}",
    });
  });
});
