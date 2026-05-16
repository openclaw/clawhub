import { ApiRoutes } from "clawhub-schema";
import { getRuntimeEnv } from "./runtimeEnv";

const SEARCH_TELEMETRY_PATH = `${ApiRoutes.search}/telemetry`;

export async function recordSearchSubmission(query: string) {
  const trimmed = query.trim();
  if (!trimmed || typeof window === "undefined") return;

  try {
    await fetch(getSearchTelemetryUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: trimmed }),
      keepalive: true,
    });
  } catch {
    // Search telemetry is best-effort; navigation should never depend on it.
  }
}

function getSearchTelemetryUrl() {
  const siteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? getRuntimeEnv("VITE_CONVEX_URL");
  const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

  if (siteUrl && localHostnames.has(window.location.hostname)) {
    return new URL(SEARCH_TELEMETRY_PATH, siteUrl).toString();
  }

  return new URL(SEARCH_TELEMETRY_PATH, window.location.origin).toString();
}
