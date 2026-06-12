import { ConvexError } from "convex/values";
import {
  base64UrlDecode,
  base64UrlEncode,
  hmacSha256Base64Url,
  hmacSha256Hex,
  isRepoPathUnderRoot,
  normalizeGitHubRepo,
  sha256Hex,
  timingSafeEqual,
} from "./githubCommon";
import { normalizeRepoPath } from "./githubImport";
import { normalizeSkillSlug } from "./skillSlugValidator";

export { createGitHubAppJwt } from "./githubCommon";

export type GitHubWebhookVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-secret" | "missing-signature" | "malformed-signature" | "bad-signature";
    };

export type GitHubAppStatePayload = {
  publisherId: string;
  requestedByUserId: string;
  nonce: string;
  targetAccountId?: string;
  exp: number;
};

const DEFAULT_SETUP_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SYNC_ROOTS = 25;

export function normalizeGitHubRepoFullName(value: string) {
  return normalizeGitHubRepo(value);
}

export function normalizeGitHubSyncRef(value: string | undefined | null, defaultBranch: string) {
  const raw = value?.trim() || defaultBranch.trim();
  if (!raw) throw new ConvexError("Sync ref is required");
  return raw.replace(/^refs\/heads\//, "");
}

export function normalizeGitHubSyncRoots(roots: string[] | undefined | null) {
  const normalized = new Set<string>();
  for (const root of roots?.length ? roots : [""]) {
    const trimmed = root.trim();
    if (!trimmed) {
      normalized.add("");
      continue;
    }
    const value = normalizeRepoPath(root);
    if (!value) throw new ConvexError("Invalid sync root");
    normalized.add(value);
    if (normalized.size > MAX_SYNC_ROOTS) throw new ConvexError("Too many sync roots");
  }
  return Array.from(normalized).sort((a, b) => a.localeCompare(b));
}

export function isPathUnderAnyRoot(path: string, roots: string[]) {
  const normalizedPath = normalizeRepoPath(path);
  const normalizedRoots = normalizeGitHubSyncRoots(roots);
  if (normalizedRoots.includes("")) return true;
  return normalizedRoots.some((root) => isRepoPathUnderRoot(normalizedPath, root));
}

export function deriveSlugFromCandidatePath(candidatePath: string, repoFullName: string) {
  const repoName = repoFullName.split("/").at(1) ?? repoFullName;
  const base = candidatePath ? (candidatePath.split("/").at(-1) ?? candidatePath) : repoName;
  return normalizeSkillSlug(
    base
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
      .replace(/--+/g, "-"),
  );
}

export function sourceLinkMatchesProvenance(params: {
  link: { repoFullName: string; path: string; status: string };
  sourceProvenance?: { kind: "github"; repo: string; path?: string } | null;
  sourceSync?: { sourceLinkId: string } | null;
  expectedSourceLinkId: string;
}) {
  if (params.link.status === "disabled") return false;
  if (params.sourceSync?.sourceLinkId !== params.expectedSourceLinkId) return false;
  const provenance = params.sourceProvenance;
  if (!provenance || provenance.kind !== "github") return false;
  return (
    normalizeGitHubRepoFullName(provenance.repo)?.toLowerCase() ===
      normalizeGitHubRepoFullName(params.link.repoFullName)?.toLowerCase() &&
    normalizeRepoPath(provenance.path ?? "") === normalizeRepoPath(params.link.path)
  );
}

export async function signGitHubAppState(
  payload: Omit<GitHubAppStatePayload, "exp"> & { exp?: number },
  secret: string,
  now = Date.now(),
) {
  const exp = payload.exp ?? now + DEFAULT_SETUP_STATE_TTL_MS;
  const body = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        publisherId: payload.publisherId,
        requestedByUserId: payload.requestedByUserId,
        nonce: payload.nonce,
        targetAccountId: payload.targetAccountId,
        exp,
      } satisfies GitHubAppStatePayload),
    ),
  );
  const signature = await hmacSha256Base64Url(secret, body);
  return `${body}.${signature}`;
}

export async function verifyGitHubAppState(
  state: string,
  secret: string,
  now = Date.now(),
): Promise<GitHubAppStatePayload> {
  const [body, signature, extra] = state.split(".");
  if (!body || !signature || extra) throw new ConvexError("Invalid GitHub setup state");
  const expected = await hmacSha256Base64Url(secret, body);
  if (!timingSafeEqual(signature, expected)) throw new ConvexError("Invalid GitHub setup state");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  } catch {
    throw new ConvexError("Invalid GitHub setup state");
  }
  const payload = parsed as Partial<GitHubAppStatePayload>;
  if (
    typeof payload.publisherId !== "string" ||
    typeof payload.requestedByUserId !== "string" ||
    typeof payload.nonce !== "string" ||
    (payload.targetAccountId !== undefined && typeof payload.targetAccountId !== "string") ||
    typeof payload.exp !== "number"
  ) {
    throw new ConvexError("Invalid GitHub setup state");
  }
  if (payload.exp < now) throw new ConvexError("GitHub setup state expired");
  return {
    publisherId: payload.publisherId,
    requestedByUserId: payload.requestedByUserId,
    nonce: payload.nonce,
    targetAccountId: payload.targetAccountId,
    exp: payload.exp,
  };
}

export async function hashGitHubAppState(state: string) {
  return sha256Hex(state);
}

export async function verifyGitHubWebhookSignature(params: {
  body: ArrayBuffer;
  signatureHeader: string | null;
  secret: string | undefined;
}): Promise<GitHubWebhookVerificationResult> {
  const secret = params.secret?.trim();
  if (!secret) return { ok: false, reason: "missing-secret" };
  const signature = params.signatureHeader?.trim();
  if (!signature) return { ok: false, reason: "missing-signature" };
  if (!signature.startsWith("sha256=")) return { ok: false, reason: "malformed-signature" };
  const expected = `sha256=${await hmacSha256Hex(secret, params.body)}`;
  if (!timingSafeEqual(signature, expected)) return { ok: false, reason: "bad-signature" };
  return { ok: true };
}

export function buildGitHubAppInstallUrl(params: {
  appSlug: string;
  state: string;
  targetId?: string;
}) {
  const url = new URL(`https://github.com/apps/${params.appSlug}/installations/new`);
  url.searchParams.set("state", params.state);
  if (params.targetId) url.searchParams.set("target_id", params.targetId);
  return url.toString();
}
