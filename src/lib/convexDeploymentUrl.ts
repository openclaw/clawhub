type ConvexUrlEnv = {
  CONVEX_URL?: string;
  VITE_CONVEX_SITE_URL?: string;
  VITE_CONVEX_URL?: string;
};

function parseAbsoluteUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function resolveConvexSiteUrl(env: ConvexUrlEnv) {
  const explicitSiteUrl = parseAbsoluteUrl(env.VITE_CONVEX_SITE_URL);
  if (explicitSiteUrl) return explicitSiteUrl.origin;

  const cloudUrl = parseAbsoluteUrl(env.VITE_CONVEX_URL ?? env.CONVEX_URL);
  if (cloudUrl?.protocol === "https:" && cloudUrl.hostname.endsWith(".convex.cloud")) {
    cloudUrl.hostname = `${cloudUrl.hostname.slice(0, -".convex.cloud".length)}.convex.site`;
    return cloudUrl.origin;
  }

  if (
    cloudUrl?.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(cloudUrl.hostname)
  ) {
    return cloudUrl.origin;
  }

  throw new Error("Cannot derive a Convex site URL from VITE_CONVEX_URL");
}

export function convexDeploymentName(url: string) {
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith(".convex.site")) return null;
  return parsed.hostname.slice(0, -".convex.site".length);
}
