import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_ORG_PAGE_SIZE = 100;

export const GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS = 15 * 60 * 1000;
export const GITHUB_ORG_MEMBERSHIP_SYNC_PROFILE_KEY = "githubOrgMembershipSync";

type FetchImpl = typeof fetch;

export type GitHubOrgMembership = {
  githubOrgId: string;
  login: string;
  avatarUrl?: string;
  role: "admin" | "member";
};

export type GitHubOrgMembershipSync = {
  memberships: GitHubOrgMembership[];
  syncedAt: number;
  truncated: boolean;
};

type GitHubMembershipPayload = {
  state?: unknown;
  role?: unknown;
  organization?: {
    id?: unknown;
    login?: unknown;
    avatar_url?: unknown;
  };
};

export async function fetchActiveGitHubOrgMemberships(
  accessToken: string,
  options: { fetchImpl?: FetchImpl; now?: number } = {},
): Promise<GitHubOrgMembershipSync> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const memberships: GitHubOrgMembership[] = [];

  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(
      `${GITHUB_API}/user/memberships/orgs?state=active&per_page=${GITHUB_ORG_PAGE_SIZE}&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "clawhub/github-org-memberships",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub organization membership lookup failed (${response.status})`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("GitHub organization membership lookup returned invalid data");
    }

    for (const row of payload) {
      const membership = parseGitHubOrgMembership(row);
      if (!membership) continue;
      memberships.push(membership);
    }

    if (payload.length < GITHUB_ORG_PAGE_SIZE) {
      return {
        memberships: dedupeMemberships(memberships),
        syncedAt: options.now ?? Date.now(),
        truncated: false,
      };
    }
  }
}

export function readGitHubOrgMembershipSync(
  profile: Record<string, unknown>,
): GitHubOrgMembershipSync | null {
  const value = profile[GITHUB_ORG_MEMBERSHIP_SYNC_PROFILE_KEY];
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GitHubOrgMembershipSync>;
  if (
    !Array.isArray(candidate.memberships) ||
    typeof candidate.syncedAt !== "number" ||
    !Number.isFinite(candidate.syncedAt) ||
    typeof candidate.truncated !== "boolean"
  ) {
    return null;
  }

  const memberships = candidate.memberships
    .map((membership) => parseStoredMembership(membership))
    .filter((membership): membership is GitHubOrgMembership => membership !== null);
  return {
    memberships: dedupeMemberships(memberships),
    syncedAt: candidate.syncedAt,
    truncated: candidate.truncated,
  };
}

export async function replaceGitHubOrgMemberships(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  sync: GitHubOrgMembershipSync,
) {
  const existing = await ctx.db
    .query("githubOrgMemberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const existingByOrgId = new Map(
    existing.map((membership) => [membership.githubOrgId, membership]),
  );
  const nextIds = new Set<string>();

  for (const membership of sync.memberships) {
    nextIds.add(membership.githubOrgId);
    const current = existingByOrgId.get(membership.githubOrgId);
    const value = {
      userId,
      githubOrgId: membership.githubOrgId,
      login: membership.login,
      avatarUrl: membership.avatarUrl,
      role: membership.role,
      syncedAt: sync.syncedAt,
    };
    if (current) {
      await ctx.db.patch(current._id, value);
    } else {
      await ctx.db.insert("githubOrgMemberships", value);
    }
  }

  for (const membership of existing) {
    if (!nextIds.has(membership.githubOrgId)) {
      await ctx.db.delete(membership._id);
    }
  }

  await ctx.db.patch(userId, {
    githubOrgMembershipsSyncedAt: sync.syncedAt,
    githubOrgMembershipsTruncated: sync.truncated || undefined,
  });
}

function parseGitHubOrgMembership(value: unknown): GitHubOrgMembership | null {
  if (!value || typeof value !== "object") return null;
  const row = value as GitHubMembershipPayload;
  if (row.state !== "active" || (row.role !== "admin" && row.role !== "member")) return null;
  return parseStoredMembership({
    githubOrgId: normalizeNumericId(row.organization?.id),
    login: row.organization?.login,
    avatarUrl: row.organization?.avatar_url,
    role: row.role,
  });
}

function parseStoredMembership(value: unknown): GitHubOrgMembership | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<GitHubOrgMembership>;
  const githubOrgId = normalizeNumericId(row.githubOrgId);
  const login = typeof row.login === "string" ? row.login.trim() : "";
  const role = row.role;
  if (!githubOrgId || !isGitHubLogin(login) || (role !== "admin" && role !== "member")) {
    return null;
  }
  const avatarUrl =
    typeof row.avatarUrl === "string" && isHttpsUrl(row.avatarUrl.trim())
      ? row.avatarUrl.trim()
      : undefined;
  return { githubOrgId, login, avatarUrl, role };
}

function normalizeNumericId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) return value.trim();
  return null;
}

function isGitHubLogin(value: string) {
  return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value);
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function dedupeMemberships(memberships: GitHubOrgMembership[]) {
  return [
    ...new Map(memberships.map((membership) => [membership.githubOrgId, membership])).values(),
  ].sort((left, right) => left.login.localeCompare(right.login));
}
