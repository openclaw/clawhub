import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const CLAWHUB_VERCEL_OWNER_ID = "team_pLdjXbfy0XvPRiNmAygTjTSH";
export const CLAWHUB_VERCEL_PROJECT_ID = "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc";
export const CLAWHUB_VERCEL_TEAM = "openclaw-foundation";
export const CLAWHUB_VERCEL_PROJECT = "clawhub";
export const ARCHIVE_REQUEST_IDENTITY_HEADER = "x-clawhub-vercel-oidc-token";

const VERCEL_OIDC_ISSUER = `https://oidc.vercel.com/${CLAWHUB_VERCEL_TEAM}`;
const VERCEL_OIDC_AUDIENCE = `https://vercel.com/${CLAWHUB_VERCEL_TEAM}`;
const VERCEL_OIDC_JWKS = createRemoteJWKSet(new URL("https://oidc.vercel.com/.well-known/jwks"));
const CLAWHUB_PRODUCTION_CONVEX_SITE = "wry-manatee-359.convex.site";
const CLAWHUB_TEST_CONVEX_SITE = "academic-chihuahua-392.convex.site";

export type ClawHubVercelEnvironment = "development" | "preview" | "test" | "production";

export function expectedVercelEnvironmentForConvexSite(
  requestUrl: string,
): ClawHubVercelEnvironment | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return "development";
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site")) return null;
  if (url.hostname === CLAWHUB_PRODUCTION_CONVEX_SITE) return "production";
  if (url.hostname === CLAWHUB_TEST_CONVEX_SITE) return "test";
  return "preview";
}

export async function verifyClawHubVercelOidcToken(
  token: string,
  expectedEnvironment: ClawHubVercelEnvironment,
  jwks: JWTVerifyGetKey = VERCEL_OIDC_JWKS,
) {
  const verified = await jwtVerify(token, jwks, {
    algorithms: ["RS256"],
    issuer: VERCEL_OIDC_ISSUER,
    audience: VERCEL_OIDC_AUDIENCE,
  });
  const payload = verified.payload;
  if (
    payload.owner_id !== CLAWHUB_VERCEL_OWNER_ID ||
    payload.project_id !== CLAWHUB_VERCEL_PROJECT_ID ||
    payload.environment !== expectedEnvironment ||
    payload.sub !==
      `owner:${CLAWHUB_VERCEL_TEAM}:project:${CLAWHUB_VERCEL_PROJECT}:environment:${expectedEnvironment}`
  ) {
    throw new Error("Invalid ClawHub Vercel identity");
  }
  return payload;
}
