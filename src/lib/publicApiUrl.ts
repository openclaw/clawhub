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
    // Public-edge requests use the same-origin Nitro proxy, including previews
    // on localhost. Direct Convex development backends retain their own routing.
    const convexClientBaseUrl = resolveAbsoluteBaseUrl(
      getRuntimeEnv("VITE_CONVEX_SITE_URL"),
      getRuntimeEnv("VITE_CONVEX_URL"),
    );
    const backendHostname = convexClientBaseUrl ? new URL(convexClientBaseUrl).hostname : "";
    const directConvexBackend =
      ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(backendHostname) ||
      backendHostname.endsWith(".convex.site") ||
      backendHostname.endsWith(".convex.cloud");
    if (
      convexClientBaseUrl &&
      directConvexBackend &&
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
