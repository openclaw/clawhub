// Managed MCP authoring restrictions that need no definition schema.
export const MANAGED_MCP_DEFINITION_PATH = "clawhub-mcp.json";

/** CIMD client identifiers must be public HTTPS URLs with a non-root path. */
export function assertManagedMcpClientMetadataUrl(raw: string): void {
  try {
    assertManagedMcpUrl(raw);
    // URL parsing removes dot segments: reject them before identity normalization.
    const path = raw.replace(/^https:\/\/[^/]+/i, "").split(/[?#]/, 1)[0];
    if (path.split("/").some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment)))
      throw new Error("Invalid metadata path");
    if (new URL(raw).pathname === "/") throw new Error("Missing metadata path");
  } catch {
    throw new Error(
      "OAuth client metadata URL must use public HTTPS with a non-root path and no credentials",
    );
  }
}

/** Syntactic authoring restriction; network callers must additionally pin public DNS addresses. */
export function assertManagedMcpUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid MCP endpoint URL");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    raw.length > 2048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  )
    throw new Error("MCP endpoints must use public HTTPS without credentials");
  for (const key of url.searchParams.keys()) {
    if (
      /^(?:access[_-]?token|refresh[_-]?token|api[_-]?key|key|token|secret|client[_-]?secret|password|authorization|auth[_-]?token|bearer[_-]?token|session[_-]?token|auth|signature|session|code|x-amz-.+|x-goog-.+|sig|credential)$/i.test(
        key,
      )
    )
      throw new Error("MCP endpoint URLs must not contain credentials");
  }
}
