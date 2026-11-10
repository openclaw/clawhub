import { parseArk, WellKnownConfigSchema } from "./schema/index.js";

const DISCOVERY_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// A well-known document can name any string. Only an https base, or http on
// loopback, is a registry. Credentials in the URL are rejected.
function acceptedDiscoveredBase(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return trimmed;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return trimmed;
  return null;
}

// Mirrors the fetchWithTimeout pattern from ./http.js (not imported) so an
// endpoint that accepts but never answers cannot hang discovery forever.
// Returns both the response and the timeout handle so the caller can extend
// the timeout to cover body parsing.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{
  response: Response;
  clearTimer: () => void;
  normalizeError: (error: unknown) => unknown;
}> {
  const controller = new AbortController();
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  let timeoutError: Error | null = null;
  const timeout = setTimeout(() => {
    timeoutError = new Error(`Request timed out after ${timeoutSeconds}s`);
    controller.abort(timeoutError);
  }, timeoutMs);
  const normalizeError = (error: unknown) => timeoutError ?? error;
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      response,
      clearTimer: () => clearTimeout(timeout),
      normalizeError,
    };
  } catch (error) {
    clearTimeout(timeout);
    throw normalizeError(error);
  }
}

export async function discoverRegistryFromSite(siteUrl: string, timeoutMs = DISCOVERY_TIMEOUT_MS) {
  const paths = ["/.well-known/clawhub.json", "/.well-known/clawdhub.json"];
  for (const path of paths) {
    const url = new URL(path, siteUrl);
    const { response, clearTimer, normalizeError } = await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      timeoutMs,
    );
    if (!response.ok) {
      clearTimer();
      continue;
    }
    // Keep timeout active through JSON body parsing to guard against
    // peers that send headers but never complete the response body
    try {
      const raw = (await response.json()) as unknown;
      const parsed = parseArk(WellKnownConfigSchema, raw, "WellKnown config");
      const rawBase = "apiBase" in parsed ? parsed.apiBase : parsed.registry;
      const apiBase = acceptedDiscoveredBase(rawBase);
      if (!apiBase) return null;
      return {
        apiBase,
        authBase: acceptedDiscoveredBase(parsed.authBase) ?? undefined,
        minCliVersion: parsed.minCliVersion,
      };
    } catch (error) {
      throw normalizeError(error);
    } finally {
      clearTimer();
    }
  }
  return null;
}
