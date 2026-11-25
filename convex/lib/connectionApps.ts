/**
 * External apps a ClawHub user can connect, and the exact tools each one
 * exposes to OpenClaw chats.
 *
 * The tool list is an explicit allowlist: a tool the provider adds later is not
 * exposed until it is reviewed and added here. Every entry must be read-only.
 */
export type ConnectionApp = {
  /** Stable ClawHub id, used in URLs and stored rows. */
  id: string;
  name: string;
  description: string;
  /** Composio toolkit slug. */
  toolkit: string;
  /** Composio tool slugs exposed to chats. Read-only tools only. */
  tools: readonly string[];
};

export const CONNECTION_APPS: readonly ConnectionApp[] = [
  {
    id: "granola",
    name: "Granola",
    description: "Read your Granola account information. Meeting content is not included.",
    toolkit: "granola_mcp",
    // The Test proof needs account metadata only, not meeting names, notes or transcripts.
    tools: ["GRANOLA_MCP_GET_ACCOUNT_INFO"],
  },
];

export function getConnectionApp(appId: string): ConnectionApp | null {
  return CONNECTION_APPS.find((app) => app.id === appId) ?? null;
}

/** Relay route: `POST {convex site origin}/api/v1/connections/mcp/{chatKey}`. */
export const CONNECTIONS_MCP_PATH_PREFIX = "/api/v1/connections/mcp/";

const CHAT_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Chat keys are opaque and client-chosen; only their shape is checked. */
export function isValidChatKey(value: string) {
  return CHAT_KEY_PATTERN.test(value);
}

function connectedApps(connectedAppIds: readonly string[]) {
  const wanted = new Set(connectedAppIds);
  return CONNECTION_APPS.filter((app) => wanted.has(app.id));
}

/**
 * Identifies the tool configuration a Composio session was last given. It
 * covers the allowlists as well as the connected apps, so a code change to an
 * allowlist also brings stored sessions up to date on their next use.
 */
export function sessionConfigKey(connectedAppIds: readonly string[]) {
  return connectedApps(connectedAppIds)
    .map((app) => `${app.toolkit}:${[...app.tools].sort().join(",")}`)
    .sort()
    .join(";");
}

export type ComposioSessionToolConfig = {
  toolkits: { enable: string[] };
  tools: Record<string, { enable: string[] }>;
  preload: { tools: "all" | string[] };
};

/**
 * The three blocks that decide what a session can reach. They are always sent
 * together: Composio rejects `preload: "all"` without a positive allowlist,
 * and an update that narrows `toolkits` while leaving a stored `"all"` in
 * place returns 400 yet leaves the session unusable.
 */
export function buildSessionToolConfig(
  connectedAppIds: readonly string[],
): ComposioSessionToolConfig {
  const apps = connectedApps(connectedAppIds);
  return {
    toolkits: { enable: apps.map((app) => app.toolkit) },
    tools: Object.fromEntries(apps.map((app) => [app.toolkit, { enable: [...app.tools] }])),
    preload: { tools: apps.length > 0 ? "all" : [] },
  };
}

/** Session used only to start a provider sign-in for one app. */
export function buildLinkSessionToolConfig(app: ConnectionApp): ComposioSessionToolConfig {
  return {
    toolkits: { enable: [app.toolkit] },
    tools: { [app.toolkit]: { enable: [...app.tools] } },
    preload: { tools: "all" },
  };
}
