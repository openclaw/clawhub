import { defineEventHandler, getRequestIP } from "h3";
import type { H3Event } from "h3";

const MIN_CLOUD_DEV_AUTH_SECRET_LENGTH = 32;

type DevAuthSecretEnv = {
  CONVEX_DEPLOYMENT?: string;
  DEV_AUTH_CONVEX_DEPLOYMENT?: string;
  DEV_AUTH_ENABLED?: string;
  DEV_AUTH_SECRET?: string;
};

type DevAuthSecretResult =
  | { kind: "secret"; value: string }
  | { kind: "notRequired" }
  | { kind: "unavailable" };

function getDevAuthDeployment(env: DevAuthSecretEnv) {
  return env.CONVEX_DEPLOYMENT?.trim() || env.DEV_AUTH_CONVEX_DEPLOYMENT?.trim() || "";
}

function isLocalConvexDeployment(deployment: string) {
  return deployment.startsWith("local:") || deployment.startsWith("anonymous:");
}

function isDevConvexDeployment(deployment: string) {
  return deployment.startsWith("dev:");
}

function isLocalhostHost(value: string | null | undefined) {
  if (!value) return false;
  try {
    const { hostname } = new URL(`http://${value}`);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function isLocalhostUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function getDevAuthSecret(env: DevAuthSecretEnv = process.env): DevAuthSecretResult {
  if (env.DEV_AUTH_ENABLED !== "1") return { kind: "unavailable" };
  const deployment = getDevAuthDeployment(env);
  if (isLocalConvexDeployment(deployment)) return { kind: "notRequired" };
  if (!isDevConvexDeployment(deployment)) return { kind: "unavailable" };

  const secret = env.DEV_AUTH_SECRET?.trim();
  if (!secret || secret.length < MIN_CLOUD_DEV_AUTH_SECRET_LENGTH) {
    return { kind: "unavailable" };
  }
  return { kind: "secret", value: secret };
}

function isLoopbackAddress(value: string | undefined) {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function isLocalRequest(event: H3Event) {
  const host = event.req.headers.get("host") || event.url.host;
  const origin = event.req.headers.get("origin");
  const referer = event.req.headers.get("referer");
  const clientAddress = event.context.clientAddress ?? getRequestIP(event);
  return (
    isLoopbackAddress(clientAddress) &&
    isLocalhostHost(event.url.host) &&
    isLocalhostHost(host) &&
    isLocalhostUrl(origin) &&
    isLocalhostUrl(referer)
  );
}

function jsonResponse(payload: { devAuthSecret: string | null }, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export default defineEventHandler((event) => {
  if (!isLocalRequest(event)) {
    return jsonResponse({ devAuthSecret: null }, 404);
  }

  const secret = getDevAuthSecret();
  if (secret.kind === "unavailable") {
    return jsonResponse({ devAuthSecret: null }, 404);
  }
  return jsonResponse({ devAuthSecret: secret.kind === "secret" ? secret.value : null });
});
