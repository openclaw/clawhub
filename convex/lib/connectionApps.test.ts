/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  buildLinkSessionToolConfig,
  buildSessionToolConfig,
  CONNECTION_APPS,
  getConnectionApp,
  isValidChatKey,
  sessionConfigKey,
} from "./connectionApps";

describe("connection app catalog", () => {
  it("exposes only the reviewed read-only Granola tools", () => {
    expect(CONNECTION_APPS.map((app) => app.id)).toEqual(["granola"]);
    const granola = getConnectionApp("granola");
    expect(granola?.toolkit).toBe("granola_mcp");
    expect(granola?.tools).toEqual([
      "GRANOLA_MCP_GET_ACCOUNT_INFO",
      "GRANOLA_MCP_LIST_MEETINGS",
      "GRANOLA_MCP_GET_MEETINGS",
      "GRANOLA_MCP_SEARCH_MEETINGS",
      "GRANOLA_MCP_QUERY_GRANOLA_MEETINGS",
      "GRANOLA_MCP_LIST_MEETING_FOLDERS",
      "GRANOLA_MCP_LIST_TEMPLATES",
      "GRANOLA_MCP_GET_MEETING_TRANSCRIPT",
      "GRANOLA_MCP_SEARCH_TRANSCRIPTS",
    ]);
    // Granola's write tools all carry one of these verbs.
    for (const tool of granola?.tools ?? []) {
      expect(tool).not.toMatch(/ADD|CREATE|UPDATE|REMOVE|DELETE|GENERATE|SWITCH|FEEDBACK/);
    }
    expect(getConnectionApp("gmail")).toBeNull();
  });
});

describe("chat keys", () => {
  it.each(["abcdefghijklmnop", "chat_KEY-0123456789", "a".repeat(128)])("accepts %s", (key) => {
    expect(isValidChatKey(key)).toBe(true);
  });

  it.each([
    "",
    "short",
    "a".repeat(15),
    "a".repeat(129),
    "has space 1234567890",
    "slash/1234567890abcdef",
    "dot.1234567890abcdef",
    "percent%2F1234567890ab",
    "ünicode-1234567890abc",
  ])("rejects %j", (key) => {
    expect(isValidChatKey(key)).toBe(false);
  });
});

describe("session tool configuration", () => {
  it("gives a user with no connected apps an empty allowlist", () => {
    // Composio rejects preload "all" without a positive allowlist.
    expect(buildSessionToolConfig([])).toEqual({
      toolkits: { enable: [] },
      tools: {},
      preload: { tools: [] },
    });
    expect(sessionConfigKey([])).toBe("");
  });

  it("allows exactly the connected app's allowlisted tools", () => {
    const granola = getConnectionApp("granola");
    expect(buildSessionToolConfig(["granola"])).toEqual({
      toolkits: { enable: ["granola_mcp"] },
      tools: { granola_mcp: { enable: granola?.tools } },
      preload: { tools: "all" },
    });
  });

  it("ignores unknown app ids", () => {
    expect(buildSessionToolConfig(["unknown"])).toEqual(buildSessionToolConfig([]));
    expect(sessionConfigKey(["unknown", "granola"])).toBe(sessionConfigKey(["granola"]));
  });

  it("changes the config key when the connected set changes", () => {
    expect(sessionConfigKey(["granola"])).not.toBe(sessionConfigKey([]));
    expect(sessionConfigKey(["granola"])).toContain("GRANOLA_MCP_LIST_MEETINGS");
  });

  it("enables the app's toolkit on a sign-in session", () => {
    const granola = getConnectionApp("granola");
    if (!granola) throw new Error("missing fixture app");
    expect(buildLinkSessionToolConfig(granola).toolkits).toEqual({ enable: ["granola_mcp"] });
  });
});
