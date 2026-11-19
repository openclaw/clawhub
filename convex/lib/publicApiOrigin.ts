import { getClawHubRuntimeEnvironment } from "clawhub-schema/rolloutCapabilities";

const DEFAULT_PUBLIC_SITE_URL = "https://clawhub.ai";

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function isProductionDeployment() {
  const deployment = process.env.CONVEX_DEPLOYMENT?.trim() ?? "";
  return (
    (deployment.startsWith("prod:") || deployment.includes("production")) &&
    getClawHubRuntimeEnvironment(process.env) === "production"
  );
}

function isTrustedForwardedHost(value: string) {
  try {
    const hostname = new URL(`https://${value}`).hostname.toLowerCase();
    return (
      hostname === "clawhub.ai" ||
      hostname === "www.clawhub.ai" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

export function publicApiOrigin(request: Request) {
  const configured = normalizeOrigin(process.env.SITE_URL ?? process.env.VITE_SITE_URL);
  if (configured) return configured;

  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  if (
    forwardedHost &&
    !forwardedHost.endsWith(".convex.site") &&
    isTrustedForwardedHost(forwardedHost)
  ) {
    const forwardedProto =
      firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
      firstForwardedValue(request.headers.get("x-forwarded-protocol")) ??
      "https";
    const proto = forwardedProto === "http" ? "http" : "https";
    return `${proto}://${forwardedHost}`;
  }

  const requestUrl = new URL(request.url);
  if (isProductionDeployment() && requestUrl.hostname.endsWith(".convex.site")) {
    return DEFAULT_PUBLIC_SITE_URL;
  }
  return requestUrl.origin;
}
