import { getVercelOidcToken, verifyVercelOidcToken, type VercelOidcPayload } from "@vercel/oidc";

const SKILLS_SH_API_BASE = "https://skills.sh/api/v1";
const MAX_SOURCE_PAGE_SIZE = 500;
const MAX_TEST_SCAN_ADMISSIONS = 10;
const CLAWHUB_VERCEL_OWNER_ID = "team_pLdjXbfy0XvPRiNmAygTjTSH";
const CLAWHUB_VERCEL_PROJECT_ID = "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc";
const CLAWHUB_TEST_CONVEX_URL = "https://academic-chihuahua-392.convex.cloud";

export type SkillsShCatalogSourceEnv = {
  CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED?: string;
  VERCEL_ENV?: string;
  VERCEL_OIDC_TOKEN?: string;
  VERCEL_TARGET_ENV?: string;
  VITE_CLAWHUB_DEPLOY_ENV?: string;
  VITE_CONVEX_URL?: string;
};

export type SkillsShCatalogListRow = {
  id: string;
  installUrl: string | null;
  installs: number;
  name: string;
  slug: string;
  source: string;
  sourceType: string;
  url: string;
};

export type SkillsShCatalogDetail = {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash: string;
  files: Array<{
    name: string;
    content: string;
  }>;
};

type SkillsShCatalogPage = {
  data: SkillsShCatalogListRow[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    hasMore: boolean;
  };
};

type SkillsShCatalogSearch = {
  data: SkillsShCatalogListRow[];
};

function assertIntegerInRange(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function requireOidcToken(env: SkillsShCatalogSourceEnv, requestOidcToken?: string) {
  const token = requestOidcToken?.trim() || env.VERCEL_OIDC_TOKEN?.trim();
  if (!token) {
    throw new Error("skills.sh catalog source requires VERCEL_OIDC_TOKEN");
  }
  return token;
}

async function fetchSkillsShJson<T>(
  path: string,
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
    oidcToken?: string;
  } = {},
): Promise<T> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${SKILLS_SH_API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${requireOidcToken(env, options.oidcToken)}`,
    },
  });
  if (!response.ok) {
    throw new Error(`skills.sh catalog source returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchSkillsShCatalogPage(
  args: {
    page: number;
    perPage: number;
  },
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
    oidcToken?: string;
  } = {},
) {
  assertIntegerInRange("page", args.page, 0, 100_000);
  assertIntegerInRange("perPage", args.perPage, 1, MAX_SOURCE_PAGE_SIZE);
  return await fetchSkillsShJson<SkillsShCatalogPage>(
    `/skills?page=${args.page}&per_page=${args.perPage}`,
    options,
  );
}

export async function searchSkillsShCatalog(
  args: {
    query: string;
    owner?: string;
    limit: number;
  },
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
    oidcToken?: string;
  } = {},
) {
  assertIntegerInRange("limit", args.limit, 1, MAX_SOURCE_PAGE_SIZE);
  const params = new URLSearchParams({
    q: args.query,
    limit: String(args.limit),
  });
  if (args.owner) params.set("owner", args.owner);
  return await fetchSkillsShJson<SkillsShCatalogSearch>(
    `/skills/search?${params.toString()}`,
    options,
  );
}

export async function fetchSkillsShCatalogDetail(
  id: string,
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
    oidcToken?: string;
  } = {},
) {
  const normalizedId = id
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  if (normalizedId.split("/").length !== 3) {
    throw new Error("skills.sh catalog detail id must be owner/repo/skill");
  }
  return await fetchSkillsShJson<SkillsShCatalogDetail>(`/skills/${normalizedId}`, options);
}

export function getSkillsShCatalogTestSourcePolicy(env: SkillsShCatalogSourceEnv = process.env) {
  if (env.VITE_CLAWHUB_DEPLOY_ENV !== "test") {
    return {
      allowed: false as const,
      environment: env.VITE_CLAWHUB_DEPLOY_ENV?.trim() || "unknown",
      reason: "skills.sh live Test discovery requires the Test build marker",
    };
  }
  if (env.VERCEL_ENV !== "preview") {
    return {
      allowed: false as const,
      environment: env.VERCEL_ENV?.trim() || "unknown",
      reason: "skills.sh live Test discovery requires the Vercel Preview runtime",
    };
  }
  if (env.VITE_CONVEX_URL !== CLAWHUB_TEST_CONVEX_URL) {
    return {
      allowed: false as const,
      environment: "test",
      reason: "skills.sh live Test discovery requires the baked Test Convex backend",
    };
  }
  if (env.CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED !== "1") {
    return {
      allowed: false as const,
      environment: "test",
      reason: "skills.sh live Test discovery is disabled",
    };
  }
  return {
    allowed: true as const,
    environment: "test",
    maxDiscoveryRows: MAX_SOURCE_PAGE_SIZE,
    maxRealScanAdmissions: MAX_TEST_SCAN_ADMISSIONS,
  };
}

type VerifyVercelOidc = (
  token: string,
  options: {
    projectId: string;
    ownerId: string;
    environment: string;
  },
) => Promise<{ payload: VercelOidcPayload }>;

type SkillsShCatalogTestControl = {
  mode: "off" | "fixture" | "staging-live";
  discoveryEnabled: boolean;
  maxEntriesPerRun: number;
  publicVisibilityEnabled: boolean;
};

async function authorizeSkillsShCatalogTestRequest(
  options: {
    env?: SkillsShCatalogSourceEnv;
    getOidcToken?: () => Promise<string>;
    verifyOidcToken?: VerifyVercelOidc;
  } = {},
) {
  const env = options.env ?? process.env;
  const policy = getSkillsShCatalogTestSourcePolicy(env);
  if (!policy.allowed) throw new Error(policy.reason);

  const getOidcToken = options.getOidcToken ?? getVercelOidcToken;
  const verifyOidcToken = options.verifyOidcToken ?? verifyVercelOidcToken;
  const token = await getOidcToken();
  const verified = await verifyOidcToken(token, {
    projectId: CLAWHUB_VERCEL_PROJECT_ID,
    ownerId: CLAWHUB_VERCEL_OWNER_ID,
    environment: "preview",
  });
  if (
    verified.payload.project_id !== CLAWHUB_VERCEL_PROJECT_ID ||
    verified.payload.owner_id !== CLAWHUB_VERCEL_OWNER_ID ||
    verified.payload.environment !== "preview"
  ) {
    throw new Error("skills.sh live Test discovery requires verified ClawHub Vercel identity");
  }
  return {
    ...policy,
    oidcToken: token,
    verifiedIdentity: {
      ownerId: verified.payload.owner_id,
      projectId: verified.payload.project_id,
      environment: verified.payload.environment,
    },
  };
}

export async function fetchSkillsShCatalogTestPage(options: {
  env?: SkillsShCatalogSourceEnv;
  fetchImpl?: typeof fetch;
  getOidcToken?: () => Promise<string>;
  verifyOidcToken?: VerifyVercelOidc;
  readConvexControl: () => Promise<SkillsShCatalogTestControl>;
}) {
  const authorization = await authorizeSkillsShCatalogTestRequest(options);
  const control = await options.readConvexControl();
  if (
    control.mode !== "staging-live" ||
    !control.discoveryEnabled ||
    control.maxEntriesPerRun < 1 ||
    control.maxEntriesPerRun > authorization.maxDiscoveryRows ||
    control.publicVisibilityEnabled
  ) {
    throw new Error("skills.sh live Test discovery requires the dark Convex staging control");
  }
  const page = await fetchSkillsShCatalogPage(
    { page: 0, perPage: authorization.maxDiscoveryRows },
    {
      env: options.env,
      fetchImpl: options.fetchImpl,
      oidcToken: authorization.oidcToken,
    },
  );
  if (page.data.length > control.maxEntriesPerRun) {
    throw new Error("skills.sh live Test discovery exceeded the Convex run budget");
  }
  return {
    page,
    verifiedIdentity: authorization.verifiedIdentity,
    controls: {
      maxDiscoveryRows: control.maxEntriesPerRun,
      maxRealScanAdmissions: authorization.maxRealScanAdmissions,
      publicVisibilityEnabled: false,
    },
  };
}
