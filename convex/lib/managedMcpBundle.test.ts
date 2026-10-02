import { describe, expect, it } from "vitest";
import { buildManagedMcpBundle } from "./managedMcpBundle";

const definition = {
  id: "posthog",
  name: "PostHog",
  company: "PostHog",
  description: "Query product analytics.",
  category: "data-analytics",
  version: "1.0.0",
  icon: {
    pngBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII=",
    license: "MIT",
    attribution: "OpenClaw",
  },
  connection: {
    url: "https://mcp.posthog.com/mcp",
    transport: "streamable-http",
    auth: { kind: "api-key", header: "Authorization", placeholder: "Bearer ${POSTHOG_MCP_TOKEN}" },
  },
};

describe("managed MCP bundle", () => {
  it("keeps company icon terms distinct from the wrapper MIT license", () => {
    const { files } = buildManagedMcpBundle({
      ...definition,
      icon: {
        ...definition.icon,
        license: "Provider brand terms",
        attribution: "PostHog logo belongs to PostHog.",
        sourceUrl: "https://posthog.com/brand/icon.png",
        licenseUrl: "https://posthog.com/brand",
      },
    });
    const text = (path: string) =>
      new TextDecoder().decode(files.find((file) => file.path === path)?.bytes);
    expect(JSON.parse(text("package.json")).license).toBe("SEE LICENSE IN LICENSE");
    expect(JSON.parse(text(".claude-plugin/plugin.json")).license).toBeUndefined();
    expect(text("LICENSE")).toContain("does not apply to assets/icon.png");
    expect(text("NOTICE")).toContain("Source: https://posthog.com/brand/icon.png");
    expect(text("NOTICE")).toContain("Terms: https://posthog.com/brand");
    expect(text("NOTICE")).toContain("Provider brand terms");
    expect(text("NOTICE")).toContain("PostHog logo belongs to PostHog.");
  });

  it("generates installable manifests with credential references and honest authorship", () => {
    const { files, name } = buildManagedMcpBundle(definition);
    expect(name).toBe("@openclaw/posthog");
    const json = (path: string) =>
      JSON.parse(new TextDecoder().decode(files.find((f) => f.path === path)?.bytes));
    expect(json(".claude-plugin/plugin.json")).toMatchObject({
      name: "posthog",
      author: { name: "OpenClaw" },
    });
    expect(json("openclaw.plugin.json")).toMatchObject({
      id: "posthog",
      categories: ["data-analytics"],
    });
    expect(json(".mcp.json").mcpServers.posthog.type).toBe("http");
    expect(json(".mcp.json").mcpServers.posthog).not.toHaveProperty("transport");
    expect(json("openclaw.plugin.json").mcpServers.posthog.transport).toBe("streamable-http");
    expect(json(".mcp.json").mcpServers.posthog.headers.Authorization).toBe(
      "Bearer ${POSTHOG_MCP_TOKEN}",
    );
    expect(new TextDecoder().decode(files.find((f) => f.path === "README.md")?.bytes)).toContain(
      "operated by PostHog",
    );
    expect(files.some((f) => f.path === "assets/icon.png")).toBe(true);
  });

  it("creates reproducible bytes and leaves previous artifacts intact when configuration changes", () => {
    const old = buildManagedMcpBundle(definition);
    const baseline = JSON.stringify(old);
    expect(buildManagedMcpBundle(definition)).toEqual(old);
    const next = buildManagedMcpBundle({
      ...definition,
      version: "1.0.1",
      connection: { ...definition.connection, url: "https://mcp.posthog.com/updated" },
    });
    expect(JSON.stringify(old)).toEqual(baseline);
    expect(next.files).not.toEqual(old.files);
  });

  it("preserves legacy SSE in both supported manifest formats", () => {
    const { files } = buildManagedMcpBundle({
      ...definition,
      connection: { ...definition.connection, transport: "sse" },
    });
    const file = files.find((entry) => entry.path === ".mcp.json");
    expect(JSON.parse(new TextDecoder().decode(file?.bytes)).mcpServers.posthog.type).toBe("sse");
  });

  it("rejects malformed icons before publication", () => {
    expect(() =>
      buildManagedMcpBundle({
        ...definition,
        icon: { ...definition.icon, pngBase64: "iVBORw0KGgo=" },
      }),
    ).toThrow();
  });
});
