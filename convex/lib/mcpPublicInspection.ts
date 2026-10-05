"use node";

import { assertManagedMcpUrl } from "clawhub-schema";
import { requestPublicResource } from "../../server/og/requestPublicImage";

export type McpPublicInspection = {
  status: "available" | "authentication-required" | "unavailable";
  observedAt: number;
  name?: string;
  version?: string;
  protocolVersion?: string;
  oauthDiscovery?: "ready" | "unavailable";
};

const MAX_BYTES = 64 * 1024;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const sse = response.headers.get("content-type")?.includes("text/event-stream");
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Response too large");
      text += decoder.decode(value, { stream: true });
      if (sse) {
        // Ignore keepalives and notifications, including CRLF-delimited streams.
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(text);
          if (!boundary) break;
          const frame = text.slice(0, boundary.index);
          text = text.slice(boundary.index + boundary[0].length);
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const body = JSON.parse(data) as Record<string, unknown>;
          if (body.id === 1) return body;
        }
      }
    }
    if (sse) throw new Error("Missing initialize response");
    return JSON.parse(text + decoder.decode()) as Record<string, unknown>;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function requestJson(url: string, signal: AbortSignal) {
  assertManagedMcpUrl(url);
  const response = await requestPublicResource(new URL(url), signal, {
    headers: { Accept: "application/json", "User-Agent": "ClawHub/1.0 MCP-compatibility-check" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Metadata unavailable");
  }
  const json = await readJson(response);
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Invalid metadata");
  return json;
}

function wellKnown(url: URL, kind: string) {
  return `${url.origin}/.well-known/${kind}${url.pathname === "/" ? "" : url.pathname}`;
}

async function discoverOAuth(endpoint: string, challenge: string | null, signal: AbortSignal) {
  const url = new URL(endpoint);
  const advertised = /(?:^|[\s,])resource_metadata="([^"]+)"/i.exec(challenge ?? "")?.[1];
  const candidates = [
    ...new Set(
      [
        advertised,
        wellKnown(url, "oauth-protected-resource"),
        `${url.origin}/.well-known/oauth-protected-resource`,
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  let issuer = url.origin;
  for (const candidate of candidates) {
    try {
      const resource = await requestJson(candidate, signal);
      if (
        Array.isArray(resource.authorization_servers) &&
        typeof resource.authorization_servers[0] === "string"
      ) {
        issuer = resource.authorization_servers[0];
        break;
      }
    } catch {
      /* Legacy servers can advertise authorization metadata without resource metadata. */
    }
  }
  assertManagedMcpUrl(issuer);
  const issuerUrl = new URL(issuer);
  for (const candidate of new Set([
    wellKnown(issuerUrl, "oauth-authorization-server"),
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
  ])) {
    try {
      const metadata = await requestJson(candidate, signal);
      if (
        typeof metadata.issuer !== "string" ||
        metadata.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")
      )
        continue;
      for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
        if (typeof metadata[key] !== "string") throw new Error("Missing OAuth endpoint");
        assertManagedMcpUrl(metadata[key]);
      }
      if (
        Array.isArray(metadata.code_challenge_methods_supported) &&
        !metadata.code_challenge_methods_supported.includes("S256")
      )
        continue;
      return true;
    } catch {
      /* Try the standard discovery fallback, without following redirects. */
    }
  }
  return false;
}

/** Bounded public observation. OAuth discovery does not register a client or prove account access. */
export async function inspectPublicMcp(
  url: string,
  transport: "streamable-http" | "sse",
  checkOAuth = false,
): Promise<McpPublicInspection> {
  const observedAt = Date.now();
  const unavailable = { status: "unavailable" as const, observedAt };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), checkOAuth ? 15_000 : 8000);
  let response: Response | undefined;
  try {
    assertManagedMcpUrl(url);
    response = await requestPublicResource(new URL(url), controller.signal, {
      headers: {
        Accept: "application/json, text/event-stream",
        "User-Agent": "ClawHub/1.0 MCP-compatibility-check",
        ...(transport === "streamable-http" ? { "Content-Type": "application/json" } : {}),
      },
      ...(transport === "streamable-http"
        ? {
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: "clawhub-public-preview", version: "1.0.0" },
              },
            }),
          }
        : {}),
    });
    const challenge = response.headers.get("www-authenticate");
    let result: McpPublicInspection = unavailable;
    // A 403 can be a WAF/policy denial, not a usable sign-in challenge. Fail closed
    // for authoring; saved plugin details remain viewable when inspection fails.
    if (response.status === 401) result = { status: "authentication-required", observedAt };
    else if (response.ok && transport === "sse") {
      // Never follow the advertised session endpoint during a public preview.
      if (response.headers.get("content-type")?.includes("text/event-stream"))
        result = { status: "available", observedAt };
    } else if (response.ok) {
      const body = await readJson(response);
      if (
        body.jsonrpc === "2.0" &&
        body.id === 1 &&
        body.result &&
        typeof body.result === "object"
      ) {
        const initialized = body.result as Record<string, unknown>;
        const info =
          initialized.serverInfo && typeof initialized.serverInfo === "object"
            ? (initialized.serverInfo as Record<string, unknown>)
            : {};
        const short = (value: unknown) =>
          typeof value === "string"
            ? value
                .slice(0, 120)
                .split("")
                .filter((character) => character.charCodeAt(0) >= 32)
                .join("")
            : undefined;
        if (short(initialized.protocolVersion) && short(info.name))
          result = {
            status: "available",
            observedAt,
            name: short(info.name),
            version: short(info.version),
            protocolVersion: short(initialized.protocolVersion),
          };
      }
    }
    if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    if (checkOAuth)
      result.oauthDiscovery = (await discoverOAuth(url, challenge, controller.signal))
        ? "ready"
        : "unavailable";
    return result;
  } catch {
    return { ...unavailable, ...(checkOAuth ? { oauthDiscovery: "unavailable" as const } : {}) };
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
