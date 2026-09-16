import {
  ARCHIVE_REQUEST_IDENTITY_HEADER,
  expectedVercelEnvironmentForConvexSite,
  verifyClawHubVercelOidcToken,
} from "./clawhubVercelOidc";

export const VERIFIED_CLIENT_IP_HEADER = "x-clawhub-client-ip";

export async function getVerifiedClientIp(request: Request): Promise<string | null> {
  // A local Convex runtime has no hosted ingress. Gate this exception on the
  // server-owned deployment URL, never the request Host or forwarded headers.
  if (!process.env.CLAWHUB_ENV && !process.env.CLAWHUB_PREVIEW) {
    try {
      const deployment = new URL(process.env.CONVEX_CLOUD_URL ?? "");
      if (
        deployment.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(deployment.hostname)
      )
        return "127.0.0.1";
    } catch {
      /* Hosted or unconfigured runtimes require verified ingress. */
    }
  }
  const token = request.headers.get(ARCHIVE_REQUEST_IDENTITY_HEADER)?.trim();
  const ip = request.headers.get(VERIFIED_CLIENT_IP_HEADER)?.trim();
  if (!token || token.length > 16384 || !ip || ip.length > 64 || ip.includes(",")) return null;
  const environment = expectedVercelEnvironmentForConvexSite(request.url);
  if (!environment) return null;
  try {
    await verifyClawHubVercelOidcToken(token, environment);
    if (ip.includes(":")) {
      if (!/^[0-9a-f:.]+$/i.test(ip)) return null;
      // URL parsing validates and canonicalizes IPv6, including mapped addresses.
      return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    }
    const octets = ip.split(".");
    if (
      octets.length !== 4 ||
      octets.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
    )
      return null;
    return octets.join(".");
  } catch {
    return null;
  }
}
