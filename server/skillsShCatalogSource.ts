import { createHash } from "node:crypto";
import { getVercelOidcToken, verifyVercelOidcToken, type VercelOidcPayload } from "@vercel/oidc";

const SKILLS_SH_API_BASE = "https://skills.sh/api/v1";
const MAX_SOURCE_PAGE_SIZE = 500;
const MAX_TEST_SCAN_ADMISSIONS = 10;
const DETAIL_CONCURRENCY = 8;
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
  writesEnabled: boolean;
  scanPlanningEnabled: boolean;
  maxEntriesPerRun: number;
  publicVisibilityEnabled: boolean;
};

export type SkillsShCatalogGitHubOwnerProof = {
  authentication: "clawhub-github-authenticated";
  fetches: number;
  owners: Array<{ owner: string; id: number; login: string }>;
};

export class SkillsShCatalogOwnerProofRequiredError extends Error {
  constructor(
    readonly owners: string[],
    readonly sourcePreflight: {
      skillsShFetches: number;
      listFetches: number;
      searchFetches: number;
      detailFetches: number;
      selection: {
        rows: number;
        nvidiaRows: number;
        requiredCollisionIds: readonly string[];
      };
    },
  ) {
    super("skills.sh live Test source requires authenticated GitHub owner proofs");
    this.name = "SkillsShCatalogOwnerProofRequiredError";
  }
}

export function validateSkillsShCatalogGitHubOwnerProof(
  selectedOwners: readonly string[],
  proof: SkillsShCatalogGitHubOwnerProof,
) {
  if (
    proof.authentication !== "clawhub-github-authenticated" ||
    proof.fetches !== selectedOwners.length ||
    proof.owners.length !== selectedOwners.length
  ) {
    throw new Error("skills.sh live Test source lacks complete authenticated GitHub owner proof");
  }
  const selected = new Set(selectedOwners);
  const ids = new Map<string, number>();
  for (const resolvedOwner of proof.owners) {
    const owner = resolvedOwner.owner.trim().toLowerCase();
    const login = resolvedOwner.login.trim().toLowerCase();
    if (
      !selected.has(owner) ||
      login !== owner ||
      ids.has(owner) ||
      !Number.isSafeInteger(resolvedOwner.id) ||
      resolvedOwner.id <= 0
    ) {
      throw new Error(
        "skills.sh live Test source returned invalid authenticated GitHub owner proof",
      );
    }
    ids.set(owner, resolvedOwner.id);
  }
  for (const owner of selectedOwners) {
    if (!ids.has(owner)) {
      throw new Error(
        `skills.sh live Test source lacks an authenticated immutable owner id for ${owner}`,
      );
    }
  }
  return ids;
}

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
    !control.writesEnabled ||
    !control.scanPlanningEnabled ||
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

const REQUIRED_COLLISION_IDS = [
  "anthropics/skills/frontend-design",
  "anthropics/claude-code/frontend-design",
] as const;

function isGitHubCatalogRow(row: SkillsShCatalogListRow) {
  const source = row.source.trim().toLowerCase();
  const slug = row.slug.trim().toLowerCase();
  return (
    row.sourceType === "github" &&
    source.split("/").length === 2 &&
    /^[a-z0-9][a-z0-9-]*$/.test(slug) &&
    row.id.trim().toLowerCase() === `${source}/${slug}`
  );
}

function normalizeListRow(row: SkillsShCatalogListRow) {
  const [owner = "", repo = ""] = row.source.split("/");
  const slug = row.slug.trim().toLowerCase();
  return {
    ...row,
    owner: owner.trim().toLowerCase(),
    repo: repo.trim().toLowerCase(),
    slug,
    externalId: `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}/${slug}`,
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = Array.from<R>({ length: values.length });
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function sha256Hex(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildArtifact(detail: SkillsShCatalogDetail) {
  const files = detail.files
    .map((file) => {
      const bytes = Buffer.from(file.content, "utf8");
      return {
        path: file.name,
        size: bytes.byteLength,
        sha256: sha256Hex(bytes),
        contentType: file.name.toLowerCase().endsWith(".md")
          ? "text/markdown; charset=utf-8"
          : "text/plain; charset=utf-8",
        contentBase64: bytes.toString("base64"),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = files.map((file) => `${file.path}\0${file.sha256}\n`).join("");
  return {
    artifactContentHash: sha256Hex(manifest),
    files,
  };
}

function createSkillsShFetchOptions(
  env: SkillsShCatalogSourceEnv | undefined,
  fetchImpl: typeof fetch | undefined,
  value: string,
) {
  return {
    env,
    fetchImpl,
    oidcToken: value,
  };
}

async function selectSkillsShCatalogTestRows(fetchOptions: {
  env?: SkillsShCatalogSourceEnv;
  fetchImpl?: typeof fetch;
  oidcToken?: string;
}) {
  const candidates = new Map<string, ReturnType<typeof normalizeListRow>>();
  let listFetches = 0;
  for (let page = 0; candidates.size < MAX_SOURCE_PAGE_SIZE + 100; page += 1) {
    const response = await fetchSkillsShCatalogPage(
      { page, perPage: MAX_SOURCE_PAGE_SIZE },
      fetchOptions,
    );
    listFetches += 1;
    for (const row of response.data) {
      if (!isGitHubCatalogRow(row)) continue;
      const normalized = normalizeListRow(row);
      candidates.set(normalized.externalId, normalized);
    }
    if (!response.pagination.hasMore) break;
  }
  const nvidia = await searchSkillsShCatalog(
    { query: "nvidia", owner: "nvidia", limit: 200 },
    fetchOptions,
  );
  const nvidiaRows = nvidia.data
    .filter(isGitHubCatalogRow)
    .map(normalizeListRow)
    .filter((row) => row.owner === "nvidia")
    .slice(0, 10);
  const requiredIds = new Set([
    ...REQUIRED_COLLISION_IDS,
    ...nvidiaRows.map((row) => row.externalId),
  ]);
  for (const row of nvidiaRows) candidates.set(row.externalId, row);
  for (const id of requiredIds) {
    if (!candidates.has(id)) throw new Error(`Required skills.sh live row is missing: ${id}`);
  }
  const selectedRows = [
    ...Array.from(requiredIds, (id) => candidates.get(id)!),
    ...Array.from(candidates.values()).filter((row) => !requiredIds.has(row.externalId)),
  ].slice(0, MAX_SOURCE_PAGE_SIZE);
  if (selectedRows.length !== MAX_SOURCE_PAGE_SIZE) {
    throw new Error(`Expected ${MAX_SOURCE_PAGE_SIZE} live rows`);
  }
  return {
    selectedRows,
    selectedOwners: Array.from(new Set(selectedRows.map((row) => row.owner))).sort(),
    listFetches,
    selection: {
      rows: selectedRows.length,
      nvidiaRows: selectedRows.filter((row) => row.owner === "nvidia").length,
      requiredCollisionIds: REQUIRED_COLLISION_IDS,
    },
  };
}

export async function captureSkillsShCatalogTestSnapshot(options: {
  env?: SkillsShCatalogSourceEnv;
  fetchImpl?: typeof fetch;
  getOidcToken?: () => Promise<string>;
  verifyOidcToken?: VerifyVercelOidc;
  readConvexControl: () => Promise<SkillsShCatalogTestControl>;
  admitExternalIds?: string[];
  githubOwnerProof?: SkillsShCatalogGitHubOwnerProof;
  resolveGitHubOwners?: (owners: string[]) => Promise<SkillsShCatalogGitHubOwnerProof>;
}) {
  const startedAt = Date.now();
  const authorization = await authorizeSkillsShCatalogTestRequest(options);
  const control = await options.readConvexControl();
  if (
    control.mode !== "staging-live" ||
    !control.discoveryEnabled ||
    !control.writesEnabled ||
    !control.scanPlanningEnabled ||
    control.maxEntriesPerRun !== MAX_SOURCE_PAGE_SIZE ||
    control.publicVisibilityEnabled
  ) {
    throw new Error("skills.sh live Test capture requires the exact dark 500-row control");
  }
  const fetchOptions = createSkillsShFetchOptions(
    options.env,
    options.fetchImpl,
    authorization.oidcToken,
  );
  const selection = await selectSkillsShCatalogTestRows(fetchOptions);
  const sourcePreflight = {
    skillsShFetches: selection.listFetches + 1,
    listFetches: selection.listFetches,
    searchFetches: 1,
    detailFetches: 0,
    selection: selection.selection,
  };
  const githubOwnerProof =
    options.githubOwnerProof ??
    (options.resolveGitHubOwners
      ? await options.resolveGitHubOwners(selection.selectedOwners)
      : null);
  if (!githubOwnerProof) {
    throw new SkillsShCatalogOwnerProofRequiredError(selection.selectedOwners, sourcePreflight);
  }
  const githubOwnerIds = validateSkillsShCatalogGitHubOwnerProof(
    selection.selectedOwners,
    githubOwnerProof,
  );
  const details = await mapWithConcurrency(
    selection.selectedRows,
    DETAIL_CONCURRENCY,
    async (row) => await fetchSkillsShCatalogDetail(row.externalId, fetchOptions),
  );
  const selected = selection.selectedRows.map((row, index) => {
    const detail = details[index]!;
    if (detail.id.trim().toLowerCase() !== row.externalId || !/^[a-f0-9]{64}$/i.test(detail.hash)) {
      throw new Error(`skills.sh live row lacks an exact detail hash: ${row.externalId}`);
    }
    return { row, detail };
  });
  const rows = selected.map(({ row, detail }) => {
    const githubOwnerId = githubOwnerIds.get(row.owner)!;
    return {
      externalId: row.externalId,
      githubOwnerId,
      owner: row.owner,
      repo: row.repo,
      slug: row.slug,
      displayName: row.name.trim() || row.slug,
      sourceUrl: row.url,
      githubRepoUrl: row.installUrl ?? `https://github.com/${row.owner}/${row.repo}`,
      sourceContentHash: detail.hash.toLowerCase(),
      installs: row.installs,
    };
  });
  const admitted = new Set(
    (options.admitExternalIds ?? []).map((externalId) => externalId.trim().toLowerCase()),
  );
  if (admitted.size > authorization.maxRealScanAdmissions) {
    throw new Error(
      `skills.sh live Test admission cannot exceed ${authorization.maxRealScanAdmissions}`,
    );
  }
  const artifacts = selected
    .filter(({ row }) => admitted.has(row.externalId))
    .map(({ row, detail }) => ({
      externalId: row.externalId,
      ...buildArtifact(detail),
    }));
  if (artifacts.length !== admitted.size) {
    throw new Error("skills.sh live Test admission artifact is not present in the selected 500");
  }
  return {
    snapshotId: `skills-sh-test-live-500:${sha256Hex(
      rows.map((row) => `${row.externalId}:${row.sourceContentHash}\n`).join(""),
    ).slice(0, 16)}`,
    capturedAt: new Date().toISOString(),
    rows,
    artifacts,
    verifiedIdentity: authorization.verifiedIdentity,
    selection: {
      rows: rows.length,
      nvidiaRows: rows.filter((row) => row.owner === "nvidia").length,
      requiredCollisionIds: REQUIRED_COLLISION_IDS,
    },
    metrics: {
      runtimeMs: Date.now() - startedAt,
      skillsShFetches: selection.listFetches + 1 + details.length,
      listFetches: selection.listFetches,
      searchFetches: 1,
      detailFetches: details.length,
      githubOwnerFetches: githubOwnerProof.fetches,
    },
  };
}
