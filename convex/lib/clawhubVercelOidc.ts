import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const CLAWHUB_VERCEL_OWNER_ID = "team_pLdjXbfy0XvPRiNmAygTjTSH";
export const CLAWHUB_VERCEL_PROJECT_ID = "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc";
export const CLAWHUB_VERCEL_TEAM = "openclaw-foundation";
export const CLAWHUB_VERCEL_PROJECT = "clawhub";
export const ARCHIVE_REQUEST_IDENTITY_HEADER = "x-clawhub-vercel-oidc-token";
export const STAGING_EDGE_SECRET_HEADER = "x-clawhub-staging-edge-secret";
export const STAGING_CONVEX_SITE_ORIGIN = "https://cheery-civet-733.convex.site";

const VERCEL_OIDC_ISSUER = `https://oidc.vercel.com/${CLAWHUB_VERCEL_TEAM}`;
const VERCEL_OIDC_AUDIENCE = `https://vercel.com/${CLAWHUB_VERCEL_TEAM}`;
const VERCEL_OIDC_JWKS = createRemoteJWKSet(new URL(`${VERCEL_OIDC_ISSUER}/.well-known/jwks`));
const STAGING_CONVEX_SITE = new URL(STAGING_CONVEX_SITE_ORIGIN).hostname;

type ClawHubArchiveRuntimeEnvironment = {
  CLAWHUB_ENV?: string;
  CLAWHUB_PREVIEW?: string;
  CLAWHUB_STAGING_EDGE_SECRET?: string;
};

export type ClawHubVercelEnvironment = "development" | "preview" | "production";

export function expectedVercelEnvironmentForConvexSite(
  requestUrl: string,
  env: ClawHubArchiveRuntimeEnvironment = process.env,
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

  const runtimeEnvironment = env.CLAWHUB_ENV?.trim();
  if (url.hostname === STAGING_CONVEX_SITE) {
    return runtimeEnvironment === "staging" && env.CLAWHUB_PREVIEW !== "1" ? "preview" : null;
  }
  if (env.CLAWHUB_PREVIEW === "1") {
    return runtimeEnvironment && runtimeEnvironment !== "preview" ? null : "preview";
  }
  if (runtimeEnvironment === "production") return "production";
  // ClawHub Test is an app-level label on a Vercel preview-target deployment.
  if (runtimeEnvironment === "test") return "preview";
  return null;
}

export function hasValidStagingEdgeSecret(
  request: Request,
  env: ClawHubArchiveRuntimeEnvironment = process.env,
): boolean {
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return false;
  }
  const stagingRuntime = env.CLAWHUB_ENV?.trim() === "staging";
  if (!stagingRuntime && hostname !== STAGING_CONVEX_SITE) return true;
  if (!stagingRuntime || hostname !== STAGING_CONVEX_SITE || env.CLAWHUB_PREVIEW === "1") {
    return false;
  }

  // Vercel OIDC identifies a Preview project, not a branch. Only the staging
  // branch receives this secret; other PR Previews must not impersonate its edge.
  const expected = env.CLAWHUB_STAGING_EDGE_SECRET?.trim();
  const presented = request.headers.get(STAGING_EDGE_SECRET_HEADER)?.trim();
  if (!expected || expected.length < 32 || expected.length > 256 || !presented) return false;
  if (presented.length > 256) return false;
  let difference = expected.length ^ presented.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return difference === 0;
}

// This JWT identifies the Vercel project and environment, not the Git branch.
// Staging request callers must also require hasValidStagingEdgeSecret(request).
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
