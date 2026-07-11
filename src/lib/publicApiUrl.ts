import { getRequiredRuntimeEnv, getRuntimeEnv } from "./runtimeEnv";

function normalizeApiPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveAbsoluteBaseUrl(...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      return new URL(value).toString();
    } catch {
      continue;
    }
  }
  return null;
}

export function publicApiUrl(path: string) {
  const normalizedPath = normalizeApiPath(path);
  if (typeof window !== "undefined") {
    // Hosted browsers use the same-origin Nitro proxy. Local browsers use the
    // Convex site directly so anonymous local backends do not need edge routing.
    const convexClientBaseUrl = resolveAbsoluteBaseUrl(
      getRuntimeEnv("VITE_CONVEX_SITE_URL"),
      getRuntimeEnv("VITE_CONVEX_URL"),
    );
    if (
      convexClientBaseUrl &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "0.0.0.0")
    ) {
      return new URL(normalizedPath, convexClientBaseUrl);
    }
    return new URL(normalizedPath, window.location.origin);
  }

  const base =
    resolveAbsoluteBaseUrl(
      getRuntimeEnv("VITE_CONVEX_SITE_URL"),
      getRuntimeEnv("VITE_CONVEX_URL"),
    ) ?? getRequiredRuntimeEnv("VITE_CONVEX_URL");
  return new URL(normalizedPath, base);
}
