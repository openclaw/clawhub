import { describe, expect, it } from "vitest";
import { parseManagedMcpDefinition } from "./managedMcp.js";

const definition = {
  id: "indeed",
  name: "Indeed",
  company: "Indeed",
  description: "Search jobs on Indeed.",
  category: "productivity",
  version: "1.0.0",
  icon: { pngBase64: "iVBORw0KGgo=", license: "MIT", attribution: "OpenClaw" },
  connection: {
    url: "https://mcp.indeed.com/mcp",
    transport: "streamable-http",
    auth: { kind: "oauth", scope: "job_seeker.jobs.search offline_access" },
  },
};

describe("managed MCP definitions", () => {
  it("preserves official icon provenance and its separate rights", () => {
    const input = {
      ...definition,
      icon: {
        ...definition.icon,
        license: "Provider brand terms",
        attribution: "Indeed logo belongs to Indeed.",
        sourceUrl: "https://www.indeed.com/brand/icon.png",
        licenseUrl: "https://www.indeed.com/legal/brand",
      },
    };
    expect(parseManagedMcpDefinition(input)).toEqual(input);
  });

  it.each([
    { license: "Provider brand terms" },
    { license: "" },
    { license: "x".repeat(121) },
    { sourceUrl: "http://example.com/icon.png" },
    { licenseUrl: "https://example.com/terms?token=secret" },
    { sourceUrl: "https://127.0.0.1/icon.png" },
  ])("rejects missing or unsafe icon rights metadata %j", (overrides) => {
    expect(() =>
      parseManagedMcpDefinition({ ...definition, icon: { ...definition.icon, ...overrides } }),
    ).toThrow();
  });

  it("preserves endpoint restrictions, transport and OAuth scopes", () => {
    const input = structuredClone(definition);
    input.connection.url += "?codemode=false&tools=search%2Cread";
    input.connection.transport = "sse";
    expect(parseManagedMcpDefinition(input)).toEqual(input);
  });

  it.each([
    { command: "node" },
    { headers: { Authorization: "Bearer secret" } },
    { auth: { kind: "oauth", clientSecret: "secret" } },
    { auth: { kind: "api-key", header: "Authorization", placeholder: "Bearer secret" } },
    { url: "https://user:password@example.com/mcp" },
    { url: "https://example.com/mcp?access_token=secret" },
    { url: "https://example.com/mcp?auth_token=secret" },
    { url: "https://example.com/mcp?authToken=secret" },
    { url: "https://example.com/mcp?auth-token=secret" },
    { url: "https://localhost./mcp" },
    { url: "https://service.internal./mcp" },
    { url: "http://localhost:3210/mcp" },
    { url: "https://127.0.0.1/mcp" },
    { url: "https://[::1]/mcp" },
  ])("rejects unsafe connection settings %j", (overrides) => {
    expect(() =>
      parseManagedMcpDefinition({
        ...definition,
        connection: { ...definition.connection, ...overrides },
      }),
    ).toThrow();
  });

  it("accepts only a credential placeholder for API-key authentication", () => {
    const input = {
      ...definition,
      connection: {
        ...definition.connection,
        auth: {
          kind: "api-key",
          header: "Authorization",
          placeholder: "Bearer ${POSTHOG_API_KEY}",
        },
      },
    };
    expect(parseManagedMcpDefinition(input)).toEqual(input);
  });

  it.each([
    { id: "../plugin" },
    { category: "tools" },
    { version: "latest" },
    { unsupported: true },
  ])("rejects invalid package identity or metadata %j", (overrides) => {
    expect(() => parseManagedMcpDefinition({ ...definition, ...overrides })).toThrow();
  });
});
