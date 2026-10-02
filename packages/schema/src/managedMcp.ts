import { type, type inferred } from "arktype";
import { PLUGIN_CATEGORY_DEFINITIONS } from "./catalogMetadata.js";

const authSchema = type({ "+": "reject", kind: '"none"' })
  .or({ "+": "reject", kind: '"oauth"', scope: "string?" })
  .or({ "+": "reject", kind: '"api-key"', header: "string", placeholder: "string" });

const definitionSchema = type({
  "+": "reject",
  id: "string",
  name: "string",
  company: "string",
  description: "string",
  category: "string",
  version: "string",
  setup: "string?",
  icon: {
    "+": "reject",
    pngBase64: "string",
    license: "string",
    attribution: "string",
    sourceUrl: "string?",
    licenseUrl: "string?",
  },
  connection: {
    "+": "reject",
    url: "string",
    transport: '"streamable-http"|"sse"',
    auth: authSchema,
  },
});

export type ManagedMcpDefinition = (typeof definitionSchema)[inferred];
export const MANAGED_MCP_DEFINITION_PATH = "clawhub-mcp.json";

/** Validate without reflecting potentially secret input in errors or logs. */
export function parseManagedMcpDefinition(raw: unknown): ManagedMcpDefinition {
  const value = definitionSchema(raw);
  if (value instanceof type.errors) throw new Error("Invalid managed MCP definition fields");
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(value.id)) throw new Error("Invalid integration id");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version))
    throw new Error("Version must be a stable semantic version");
  if (!PLUGIN_CATEGORY_DEFINITIONS.some(({ slug }) => slug === value.category))
    throw new Error("Select a current plugin category");
  for (const [field, text, max] of [
    ["name", value.name, 120],
    ["company", value.company, 120],
    ["description", value.description, 300],
    ["icon license", value.icon.license, 120],
    ["icon attribution", value.icon.attribution, 500],
    ["setup", value.setup ?? "", 2000],
  ] as const) {
    if (
      (field !== "setup" && !text.trim()) ||
      text.length > max ||
      Array.from(text).some(
        (character) => character.charCodeAt(0) < 32 && !"\t\n\r".includes(character),
      )
    )
      throw new Error(`Invalid ${field}`);
  }
  // Legacy original icons are MIT-licensed. Company artwork has separate rights;
  // keep its provenance and permission terms with the immutable package bytes.
  if (value.icon.license !== "MIT" && (!value.icon.sourceUrl || !value.icon.licenseUrl))
    throw new Error("Non-MIT icons require a source URL and license URL");
  for (const url of [value.icon.sourceUrl, value.icon.licenseUrl]) {
    if (url === undefined) continue;
    try {
      assertManagedMcpUrl(url);
    } catch {
      throw new Error("Icon source and license URLs must use public HTTPS without credentials");
    }
  }
  assertManagedMcpUrl(value.connection.url);
  const auth = value.connection.auth;
  if (
    auth.kind === "oauth" &&
    auth.scope !== undefined &&
    (!/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(auth.scope) ||
      auth.scope.length > 1000)
  )
    throw new Error("Invalid OAuth scope");
  if (auth.kind === "api-key") {
    if (!/^(?:Authorization|X-[A-Za-z0-9-]+|Api-Key)$/i.test(auth.header))
      throw new Error("Unsupported credential header");
    if (!/^(?:Bearer )?\$\{[A-Z][A-Z0-9_]{0,99}\}$/.test(auth.placeholder))
      throw new Error("API credentials must be environment placeholders");
  }
  if (
    value.icon.pngBase64.length > 699052 ||
    !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.icon.pngBase64)
  )
    throw new Error("Icon must be a PNG no larger than 512KB");
  return value;
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
