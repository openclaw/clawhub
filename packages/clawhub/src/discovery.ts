import { parseArk, WellKnownConfigSchema } from "./schema/index.js";

const DISCOVERY_TIMEOUT_MS = 15_000;

// Mirrors the fetchWithTimeout pattern from ./http.js (not imported) so an
// endpoint that accepts but never answers cannot hang discovery forever.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  const timeout = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutSeconds}s`)),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverRegistryFromSite(siteUrl: string, timeoutMs = DISCOVERY_TIMEOUT_MS) {
  const paths = ["/.well-known/clawhub.json", "/.well-known/clawdhub.json"];
  for (const path of paths) {
    const url = new URL(path, siteUrl);
    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      timeoutMs,
    );
    if (!response.ok) continue;
    const raw = (await response.json()) as unknown;
    const parsed = parseArk(WellKnownConfigSchema, raw, "WellKnown config");
    const apiBase = "apiBase" in parsed ? parsed.apiBase : parsed.registry;
    if (!apiBase) return null;
    return {
      apiBase,
      authBase: parsed.authBase,
      minCliVersion: parsed.minCliVersion,
    };
  }
  return null;
}
