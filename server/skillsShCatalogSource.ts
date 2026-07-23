import { createHash } from "node:crypto";
import { getVercelOidcToken, verifyVercelOidcToken, type VercelOidcPayload } from "@vercel/oidc";
import { getClawHubRolloutCapabilities } from "clawhub-schema";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { buildGitHubApiHeaders } from "../convex/lib/githubAuth";

const SKILLS_SH_API_BASE = "https://skills.sh/api/v1";
const MAX_SOURCE_PAGE_SIZE = 500;
const MAX_SOURCE_ATTEMPTS = 4;
const MAX_TEST_SCAN_ADMISSIONS = 10;
const DETAIL_CONCURRENCY = 8;
const MAX_UPSTREAM_SCANNER_STATUS_LENGTH = 32;
const MAX_UPSTREAM_SCANNER_URL_LENGTH = 2_048;
const MAX_UPSTREAM_SOURCE_TYPE_LENGTH = 64;
const MAX_IDENTITY_PAGE_BYTES = 512 * 1024;
const MAX_IDENTITY_PAGE_REDIRECTS = 2;
const MAX_GITHUB_TREE_BYTES = 8 * 1024 * 1024;
const MAX_GITHUB_TREE_ENTRIES = 100_000;
const MAX_CONTROLLED_DETAIL_BYTES = 1024 * 1024;
const MAX_PROOF_METADATA_BYTES = 1024 * 1024;
const MAX_PROOF_SNAPSHOT_BYTES = 32 * 1024;
const MAX_PROOF_SOURCE_ROWS = 50_000;
const GITHUB_LOCATOR_CONCURRENCY = 8;
const MINIMUM_API_REQUEST_INTERVAL_MS = 125;
const MAX_INLINE_RETRY_AFTER_MS = 30_000;
const CLAWHUB_VERCEL_OWNER_ID = "team_pLdjXbfy0XvPRiNmAygTjTSH";
const CLAWHUB_VERCEL_PROJECT_ID = "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc";
const CLAWHUB_TEST_CONVEX_URL = "https://academic-chihuahua-392.convex.cloud";

const SKILLS_SH_MIRROR_CONTROLLED_SUPPLEMENTS = [
  {
    externalId: "patrick-erichsen/skills/html",
    owner: "patrick-erichsen",
    repo: "skills",
    slug: "html",
    displayName: "HTML Artifact Chooser",
    sourceUrl: "https://www.skills.sh/patrick-erichsen/skills/html",
    githubPath: "skills/html",
    detailPath: "skills/html/SKILL.md",
    githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
    sourceContentHash: "42d2e89358ea927441dfede45c3b0cf89a21603bc7c32246f098d24a9cbea1ff",
  },
  {
    externalId: "steipete/clawdis/discrawl",
    owner: "steipete",
    repo: "clawdis",
    slug: "discrawl",
    displayName: "Discrawl",
    sourceUrl: "https://www.skills.sh/steipete/clawdis/discrawl",
    githubPath: ".agents/skills/discrawl",
    detailPath: ".agents/skills/discrawl/SKILL.md",
    githubCommit: "690ed564419291ca6e832dc69b53061300075b62",
    sourceContentHash: "889dc43180b210dbca12f8291e007feb231250ecfdba90c4d3938a18125efb6d",
  },
] as const;

type SkillsShMirrorControlledSupplement = {
  externalId: string;
  owner: string;
  repo: string;
  slug: string;
  displayName: string;
  sourceUrl: string;
  githubPath: string;
  detailPath: string;
  githubCommit: string;
  sourceContentHash: string;
};

export const SKILLS_SH_MIRROR_CONTROLLED_SUPPLEMENT_COUNT =
  SKILLS_SH_MIRROR_CONTROLLED_SUPPLEMENTS.length;
export const SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS = SKILLS_SH_MIRROR_CONTROLLED_SUPPLEMENTS.map(
  (row) => row.externalId,
);
const SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX = "skills-sh:proof:";

function normalizeControlledSupplementIds(values: unknown[]) {
  const allowed = new Set<string>(SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS);
  const normalized = values.map((value) =>
    typeof value === "string" ? value.trim().toLowerCase() : "",
  );
  if (
    normalized.some((value) => !allowed.has(value)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error("skills.sh mirror controlled identities are invalid");
  }
  return SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS.filter((externalId) =>
    normalized.includes(externalId),
  );
}

export function buildSkillsShMirrorProofSnapshotId(args: {
  catalogTotal: number;
  controlledExternalIds: string[];
  controlledOverlayExternalIds?: string[];
  controlledSupplementExternalIds?: string[];
  evidence?: SkillsShMirrorProofEvidence;
}) {
  assertIntegerInRange("catalogTotal", args.catalogTotal, 1, MAX_PROOF_SOURCE_ROWS);
  const controlledExternalIds = normalizeControlledSupplementIds(args.controlledExternalIds);
  const controlledOverlayExternalIds = normalizeControlledSupplementIds(
    args.controlledOverlayExternalIds ?? [],
  );
  const controlledSupplementExternalIds = normalizeControlledSupplementIds(
    args.controlledSupplementExternalIds ?? controlledExternalIds,
  );
  if (
    controlledOverlayExternalIds.some((externalId) =>
      controlledSupplementExternalIds.includes(externalId),
    ) ||
    controlledExternalIds.some(
      (externalId) =>
        !controlledOverlayExternalIds.includes(externalId) &&
        !controlledSupplementExternalIds.includes(externalId),
    ) ||
    controlledOverlayExternalIds.some(
      (externalId) => !controlledExternalIds.includes(externalId),
    ) ||
    controlledSupplementExternalIds.some(
      (externalId) => !controlledExternalIds.includes(externalId),
    )
  ) {
    throw new Error("skills.sh mirror controlled proof partition is invalid");
  }
  const encodedPayload = Buffer.from(
    JSON.stringify({
      catalogTotal: args.catalogTotal,
      controlledExternalIds,
      controlledOverlayExternalIds,
      controlledSupplementExternalIds,
    }),
  ).toString("base64url");
  const compact = `${SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX}${encodedPayload}`;
  if (!args.evidence) return compact;
  const evidence = validateSkillsShMirrorProofEvidence(args.evidence);
  const serializedEvidence = JSON.stringify(evidence);
  const snapshotId =
    `${compact}.${sha256Hex(`${encodedPayload}.${serializedEvidence}`)}.` +
    Buffer.from(serializedEvidence).toString("base64url");
  if (Buffer.byteLength(snapshotId, "utf8") > MAX_PROOF_SNAPSHOT_BYTES) {
    throw new Error("skills.sh mirror proof source metadata is too large");
  }
  return snapshotId;
}

export function parseSkillsShMirrorProofSnapshotId(snapshotId: string) {
  if (!snapshotId.startsWith(SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX)) {
    throw new Error("skills.sh mirror run lacks proof source metadata");
  }
  let payload: unknown;
  let evidence: SkillsShMirrorProofEvidence | undefined;
  let sourceSnapshotHash: string | undefined;
  try {
    const [encodedPayload, snapshotHash, encodedEvidence, ...unexpected] = snapshotId
      .slice(SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX.length)
      .split(".");
    if (
      unexpected.length > 0 ||
      (snapshotHash !== undefined && encodedEvidence === undefined) ||
      (snapshotHash === undefined && encodedEvidence !== undefined)
    ) {
      throw new Error("invalid proof snapshot segments");
    }
    payload = JSON.parse(Buffer.from(encodedPayload ?? "", "base64url").toString("utf8"));
    if (snapshotHash && encodedEvidence) {
      const serializedEvidence = Buffer.from(encodedEvidence, "base64url").toString("utf8");
      if (
        !/^[a-f0-9]{64}$/.test(snapshotHash) ||
        sha256Hex(`${encodedPayload}.${serializedEvidence}`) !== snapshotHash
      ) {
        throw new Error("invalid proof snapshot hash");
      }
      evidence = validateSkillsShMirrorProofEvidence(JSON.parse(serializedEvidence));
      sourceSnapshotHash = snapshotHash;
    }
  } catch {
    throw new Error("skills.sh mirror proof source metadata is invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("skills.sh mirror proof source metadata is invalid");
  }
  const record = payload as Record<string, unknown>;
  if (
    !Number.isInteger(record.catalogTotal) ||
    Number(record.catalogTotal) < 1 ||
    Number(record.catalogTotal) > MAX_PROOF_SOURCE_ROWS
  ) {
    throw new Error("skills.sh mirror proof catalog total is invalid");
  }
  if (!Array.isArray(record.controlledExternalIds)) {
    throw new Error("skills.sh mirror proof controlled identities are invalid");
  }
  const controlledExternalIds = normalizeControlledSupplementIds(record.controlledExternalIds);
  const controlledOverlayExternalIds = normalizeControlledSupplementIds(
    Array.isArray(record.controlledOverlayExternalIds) ? record.controlledOverlayExternalIds : [],
  );
  const controlledSupplementExternalIds = normalizeControlledSupplementIds(
    Array.isArray(record.controlledSupplementExternalIds)
      ? record.controlledSupplementExternalIds
      : controlledExternalIds,
  );
  buildSkillsShMirrorProofSnapshotId({
    catalogTotal: Number(record.catalogTotal),
    controlledExternalIds,
    controlledOverlayExternalIds,
    controlledSupplementExternalIds,
  });
  return {
    catalogTotal: Number(record.catalogTotal),
    controlledExternalIds,
    controlledOverlayExternalIds,
    controlledSupplementExternalIds,
    ...(sourceSnapshotHash ? { sourceSnapshotHash } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

export type SkillsShCatalogSourceEnv = {
  CLAWHUB_SKILLS_SH_ROLLOUT_MODE?: string;
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
  hash: string | null;
  files: Array<{
    name?: unknown;
    content?: unknown;
    path?: unknown;
    contents?: unknown;
  }> | null;
};

export type SkillsShCatalogAudit = {
  id?: unknown;
  source?: unknown;
  slug?: unknown;
  audits?: unknown;
};

export type SkillsShMirrorUpstreamScanner = {
  status: string;
  sourceCheckedAt?: string;
  sourceUrl?: string;
};

export type SkillsShMirrorUpstreamScanners = {
  genAgentTrustHub: SkillsShMirrorUpstreamScanner;
  socket: SkillsShMirrorUpstreamScanner;
  snyk: SkillsShMirrorUpstreamScanner;
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

type SkillsShCatalogPagination = SkillsShCatalogPage["pagination"];

export type SkillsShMirrorProofEvidence = {
  pagination: {
    endpointExhausted: true;
    databaseCoverage: "leaderboard-only";
    page0: SkillsShCatalogPagination;
    requestedPages: Array<{
      page: number;
      count: number;
      hasMore: boolean;
      identityHash: string;
      contentHash: string;
    }>;
    finalNonemptyPage: {
      page: number;
      count: number;
      pagination: SkillsShCatalogPagination;
    };
    firstBeyondEndPage: {
      page: number;
      count: number;
      pagination: SkillsShCatalogPagination;
    };
    uniqueIds: number;
    duplicateIds: number;
  };
  fields: {
    sampledExternalId: string;
    leaderboard: {
      topLevelKeys: string[];
      paginationKeys: string[];
      rowKeys: string[];
      taxonomyFields: string[];
    };
    search: {
      topLevelKeys: string[];
      rowKeys: string[];
      taxonomyFields: string[];
    };
    detail: {
      topLevelKeys: string[];
      fileKeys: string[];
      taxonomyFields: string[];
    };
    page: {
      url: string;
      jsonLdDocuments: Array<{ type: string | null; keys: string[] }>;
      taxonomyFields: string[];
    };
    rsc: {
      objectKeys: string[];
      taxonomyFields: string[];
    };
    normalizedUpstreamTaxonomyFields: string[];
  };
};

export type SkillsShMirrorCapturedSourcePage = {
  page: number;
  sourceTotal: number;
  pageLength: number;
  hasMore: boolean;
  identityHash: string;
  contentHash: string;
  sourceBytes: number;
  serializedBytes: number;
  rows: SkillsShCatalogListRow[];
};

type HashQualifiedSkillsShCatalogDetail = SkillsShCatalogDetail & {
  hash: string;
};

type SkillsShMirrorQuarantineReason =
  | "identity-page-content-type"
  | "identity-page-fetch-failed"
  | "identity-page-http-404"
  | "identity-page-http-error"
  | "identity-page-repository-conflict"
  | "identity-page-repository-mismatch"
  | "identity-page-repository-missing"
  | "identity-page-redirect"
  | "identity-page-required"
  | "identity-page-too-large"
  | "unsupported-identity";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

class SkillsShMirrorIdentityError extends Error {
  constructor(
    readonly reason: SkillsShMirrorQuarantineReason,
    message: string = reason,
  ) {
    super(message);
    this.name = "SkillsShMirrorIdentityError";
  }
}

const UPSTREAM_SCANNER_PROVIDERS = {
  "agent-trust-hub": "genAgentTrustHub",
  socket: "socket",
  snyk: "snyk",
} as const;

function normalizeUpstreamScannerStatus(value: string) {
  const status = value.trim().toLowerCase().replace(/\s+/g, "-");
  return status &&
    status.length <= MAX_UPSTREAM_SCANNER_STATUS_LENGTH &&
    /^[a-z0-9][a-z0-9-]*$/.test(status)
    ? status
    : "unavailable";
}

export function buildSkillsShMirrorUpstreamScanners(
  auditPayload: SkillsShCatalogAudit | null,
  sourceUrl: string,
): SkillsShMirrorUpstreamScanners {
  const unavailable = (): SkillsShMirrorUpstreamScanner => ({ status: "unavailable" });
  const scanners: SkillsShMirrorUpstreamScanners = {
    genAgentTrustHub: unavailable(),
    socket: unavailable(),
    snyk: unavailable(),
  };
  if (!auditPayload || !Array.isArray(auditPayload.audits)) return scanners;
  let pageUrl: URL;
  try {
    pageUrl = new URL(sourceUrl);
  } catch {
    return scanners;
  }
  if (pageUrl.protocol !== "https:" || !["skills.sh", "www.skills.sh"].includes(pageUrl.hostname)) {
    return scanners;
  }
  for (const value of auditPayload.audits) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const audit = value as Record<string, unknown>;
    if (typeof audit.slug !== "string" || typeof audit.status !== "string") continue;
    const slug = audit.slug.trim().toLowerCase();
    const provider = UPSTREAM_SCANNER_PROVIDERS[slug as keyof typeof UPSTREAM_SCANNER_PROVIDERS];
    if (!provider) continue;
    const status = normalizeUpstreamScannerStatus(audit.status);
    if (status === "unavailable") continue;
    const detailUrl = new URL(pageUrl);
    detailUrl.pathname = `${detailUrl.pathname.replace(/\/+$/, "")}/security/${slug}`;
    detailUrl.search = "";
    detailUrl.hash = "";
    if (detailUrl.href.length > MAX_UPSTREAM_SCANNER_URL_LENGTH) continue;
    let sourceCheckedAt: string | undefined;
    if (typeof audit.auditedAt === "string" && !Number.isNaN(Date.parse(audit.auditedAt))) {
      sourceCheckedAt = audit.auditedAt;
    }
    scanners[provider] = {
      status,
      sourceUrl: detailUrl.href,
      ...(sourceCheckedAt ? { sourceCheckedAt } : {}),
    };
  }
  return scanners;
}

type SkillsShFetchOptions = {
  env?: SkillsShCatalogSourceEnv;
  fetchImpl?: typeof fetch;
  oidcToken?: string;
  minimumApiRequestIntervalMs?: number;
};

type SkillsShMirrorGitHubLocatorRow = {
  externalId: string;
  sourceType?: string;
  owner?: string;
  repo?: string;
  slug?: string;
  githubPath?: string;
  githubCommit?: string;
  detail?: {
    path: string;
    content: string;
    truncated: boolean;
  };
};

type GitHubRepoTreeSnapshot = {
  commit: string;
  blobs: Array<{ path: string; sha: string }>;
};

class SkillsShSourceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`skills.sh catalog source returned HTTP ${status}`);
    this.name = "SkillsShSourceHttpError";
  }
}

export function skillsShSourceRetryAfterSeconds(error: unknown) {
  return error instanceof SkillsShSourceHttpError && error.status === 429
    ? error.retryAfterSeconds
    : null;
}

async function fetchSkillsShApiResponse(
  path: string,
  options: SkillsShFetchOptions,
  allowNotFound = false,
) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let attempt = 0; attempt < MAX_SOURCE_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(`${SKILLS_SH_API_BASE}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${requireOidcToken(env, options.oidcToken)}`,
      },
    });
    if (response.ok) return response;
    if (allowNotFound && response.status === 404) {
      await cancelResponseBody(response);
      return null;
    }
    const retryAfterMs = response.status === 429 ? skillsShRetryAfterMs(response, attempt) : null;
    if (
      (response.status !== 429 && response.status < 500) ||
      attempt === MAX_SOURCE_ATTEMPTS - 1 ||
      (retryAfterMs !== null && retryAfterMs > MAX_INLINE_RETRY_AFTER_MS)
    ) {
      await cancelResponseBody(response);
      throw new SkillsShSourceHttpError(
        response.status,
        retryAfterMs === null ? null : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
      );
    }
    await cancelResponseBody(response);
    await waitForSkillsShRetry(response, attempt);
  }
  throw new Error("skills.sh catalog source exhausted retries");
}

function normalizeSkillsShId(id: string) {
  const parts = id.split("/");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part.trim())) {
    throw new Error("skills.sh mirror detail id must be source/skill or owner/repo/skill");
  }
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function isSkillsShIdentitySegment(value: string) {
  return Boolean(value) && !value.includes("/");
}

function normalizeUpstreamSourceType(value: unknown) {
  const normalized = (typeof value === "string" ? value : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return (normalized || "missing").slice(0, MAX_UPSTREAM_SOURCE_TYPE_LENGTH);
}

async function fetchSkillsShMirrorAudit(id: string, options: SkillsShFetchOptions = {}) {
  const response = await fetchSkillsShApiResponse(
    `/skills/audit/${normalizeSkillsShId(id)}`,
    options,
    true,
  );
  return response === null ? null : ((await response.json()) as SkillsShCatalogAudit);
}

function isHtmlElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function htmlText(node: HtmlNode): string {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(htmlText).join("") : "";
}

function htmlElements(node: HtmlNode, predicate: (element: HtmlElement) => boolean): HtmlElement[] {
  const matches: HtmlElement[] = [];
  if (isHtmlElement(node) && predicate(node)) matches.push(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) matches.push(...htmlElements(child, predicate));
  }
  return matches;
}

function htmlAttribute(element: HtmlElement, name: string) {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function parseExactGitHubRepositoryUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    pathParts.length !== 2
  ) {
    return null;
  }
  const owner = pathParts[0]?.toLowerCase();
  const repo = pathParts[1]?.replace(/\.git$/i, "").toLowerCase();
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    canonicalRepoUrl: `https://github.com/${owner}/${repo}`,
  };
}

/*
 * Repository identity is read only from the page's metadata row. Rendered
 * README content can contain arbitrary labels and links and is not authoritative.
 */
function repositoryIdentityFromHtml(html: string, expectedOwner: string, expectedRepo: string) {
  const document = parse(html);
  const metadataContainers = htmlElements(document, (element) => {
    const classes = new Set((htmlAttribute(element, "class") ?? "").split(/\s+/));
    return (
      classes.has("bg-background") &&
      classes.has("py-8") &&
      element.childNodes.some(
        (child) => isHtmlElement(child) && htmlText(child).trim().toLowerCase() === "repository",
      )
    );
  });
  const repositoryLinks = new Set<string>();
  for (const container of metadataContainers) {
    const links = container.childNodes.filter(
      (node): node is HtmlElement =>
        isHtmlElement(node) && node.tagName === "a" && htmlAttribute(node, "href") !== undefined,
    );
    for (const link of links) {
      const href = htmlAttribute(link, "href");
      const repository = href ? parseExactGitHubRepositoryUrl(href) : null;
      if (repository) {
        repositoryLinks.add(
          `${repository.owner}/${repository.repo}|${repository.canonicalRepoUrl}`,
        );
      }
    }
  }
  const candidates = Array.from(repositoryLinks, (value) => {
    const [identity, canonicalRepoUrl] = value.split("|");
    const [owner, repo] = identity!.split("/");
    return { owner: owner!, repo: repo!, canonicalRepoUrl: canonicalRepoUrl! };
  });
  if (candidates.length === 0) {
    throw new SkillsShMirrorIdentityError("identity-page-repository-missing");
  }
  if (candidates.length > 1) {
    throw new SkillsShMirrorIdentityError("identity-page-repository-conflict");
  }
  const [candidate] = candidates;
  if (candidate!.owner !== expectedOwner || candidate!.repo !== expectedRepo) {
    throw new SkillsShMirrorIdentityError("identity-page-repository-mismatch");
  }
  return candidate!;
}

function exactSkillsShIdentityPageUrl(value: string, expectedPath: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" &&
    ["skills.sh", "www.skills.sh"].includes(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.toLowerCase() === expectedPath
    ? url
    : null;
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response may already be closed by the runtime.
  }
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function hasExactSkillsShPagePath(sourceUrl: string, pathParts: string[]) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    ["skills.sh", "www.skills.sh"].includes(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.toLowerCase() === `/${pathParts.join("/")}`
  );
}

function parseExactGitHubInstallIdentity(source: string, installUrl: string | null) {
  const [owner, repo, ...rest] = source.split("/");
  if (!owner || !repo || rest.length > 0) return null;
  if (!installUrl) return null;
  const repository = parseExactGitHubRepositoryUrl(installUrl);
  return repository?.owner === owner && repository.repo === repo ? repository : null;
}

export function buildSkillsShMirrorObservation(
  row: SkillsShCatalogListRow,
  sourcePageHtml?: string,
) {
  const externalId = row.id.trim().toLowerCase();
  const slug = row.slug.trim().toLowerCase();
  const source = row.source.trim().toLowerCase();
  const upstreamSourceType = normalizeUpstreamSourceType(row.sourceType);
  const installUrl = row.installUrl?.trim() || null;
  const identityError = (reason: SkillsShMirrorQuarantineReason) =>
    new SkillsShMirrorIdentityError(
      reason,
      `Unsupported skills.sh mirror identity: ${externalId} ` +
        `(sourceType=${upstreamSourceType}, source=${source || "missing"}, ` +
        `installUrlPresent=${installUrl !== null})`,
    );
  const base = {
    externalId,
    slug,
    displayName: row.name.trim() || slug,
    sourceUrl: row.url.trim(),
    upstreamInstalls: row.installs,
    upstreamSourceType,
  };
  const githubIdentity = parseExactGitHubInstallIdentity(source, installUrl);
  if (
    githubIdentity &&
    isSkillsShIdentitySegment(slug) &&
    externalId === `${githubIdentity.owner}/${githubIdentity.repo}/${slug}`
  ) {
    return {
      ...base,
      sourceType: "github" as const,
      ...githubIdentity,
    };
  }
  const [owner, repo, ...sourceRest] = source.split("/");
  const structurallyAmbiguousGithub =
    !installUrl &&
    upstreamSourceType === "well-known" &&
    Boolean(owner && repo) &&
    sourceRest.length === 0 &&
    isSkillsShIdentitySegment(slug) &&
    externalId === `${owner}/${repo}/${slug}` &&
    hasExactSkillsShPagePath(base.sourceUrl, [owner!, repo!, slug]);
  if (structurallyAmbiguousGithub) {
    if (sourcePageHtml === undefined) {
      throw identityError("identity-page-required");
    }
    let repositoryIdentity: ReturnType<typeof repositoryIdentityFromHtml>;
    try {
      repositoryIdentity = repositoryIdentityFromHtml(sourcePageHtml, owner!, repo!);
    } catch (error) {
      if (error instanceof SkillsShMirrorIdentityError) throw identityError(error.reason);
      throw error;
    }
    return {
      ...base,
      sourceType: "github" as const,
      ...repositoryIdentity,
    };
  }
  if (
    !installUrl &&
    source &&
    !source.includes("/") &&
    isSkillsShIdentitySegment(slug) &&
    externalId === `${source}/${slug}` &&
    hasExactSkillsShPagePath(base.sourceUrl, ["site", source, slug])
  ) {
    return {
      ...base,
      sourceType: "well-known" as const,
      sourceHost: source,
    };
  }
  throw identityError("unsupported-identity");
}

function safeMirrorIdentityError(row: SkillsShCatalogListRow, error: unknown) {
  const externalId = row.id.trim().toLowerCase().slice(0, 512) || "missing";
  const upstreamSourceType = normalizeUpstreamSourceType(row.sourceType);
  const reason =
    error instanceof SkillsShMirrorIdentityError ? error.reason : "unsupported-identity";
  const source = row.source.trim().toLowerCase().slice(0, 256) || "missing";
  const installUrl = row.installUrl?.trim() || null;
  console.warn(
    `Unsupported skills.sh mirror identity: ${externalId} ` +
      `(sourceType=${upstreamSourceType}, source=${source}, ` +
      `installUrlPresent=${installUrl !== null})`,
  );
  return {
    quarantined: true as const,
    externalId,
    upstreamSourceType,
    reason,
  };
}

async function fetchSkillsShIdentityPage(
  sourceUrl: string,
  options: SkillsShFetchOptions,
): Promise<
  | { ok: true; html: string; sourceBytes: number }
  | { ok: false; reason: SkillsShMirrorQuarantineReason; sourceBytes: number }
> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let sourceBytes = 0;
  const failure = (reason: SkillsShMirrorQuarantineReason) => ({
    ok: false as const,
    reason,
    sourceBytes,
  });
  let expectedPath: string;
  try {
    expectedPath = new URL(sourceUrl).pathname.toLowerCase();
  } catch {
    return failure("identity-page-redirect");
  }
  const initialUrl = exactSkillsShIdentityPageUrl(sourceUrl, expectedPath);
  if (!initialUrl) return failure("identity-page-redirect");
  attemptLoop: for (let attempt = 0; attempt < MAX_SOURCE_ATTEMPTS; attempt += 1) {
    let requestUrl = initialUrl.href;
    for (let redirects = 0; redirects <= MAX_IDENTITY_PAGE_REDIRECTS; redirects += 1) {
      let response: Response;
      try {
        response = await fetchImpl(requestUrl, {
          headers: { Accept: "text/html" },
          redirect: "manual",
        });
      } catch {
        if (attempt === MAX_SOURCE_ATTEMPTS - 1) {
          return failure("identity-page-fetch-failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue attemptLoop;
      }
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        await cancelResponseBody(response);
        if (!location || redirects === MAX_IDENTITY_PAGE_REDIRECTS) {
          return failure("identity-page-redirect");
        }
        let target: URL;
        try {
          target = new URL(location, requestUrl);
        } catch {
          return failure("identity-page-redirect");
        }
        const validatedTarget = exactSkillsShIdentityPageUrl(
          target.href,
          initialUrl.pathname.toLowerCase(),
        );
        if (!validatedTarget) return failure("identity-page-redirect");
        requestUrl = validatedTarget.href;
        continue;
      }
      if (response.status === 404) {
        await cancelResponseBody(response);
        return failure("identity-page-http-404");
      }
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          const retryAfterMs =
            response.status === 429 ? skillsShRetryAfterMs(response, attempt) : null;
          if (
            response.status === 429 &&
            (attempt === MAX_SOURCE_ATTEMPTS - 1 ||
              (retryAfterMs !== null && retryAfterMs > MAX_INLINE_RETRY_AFTER_MS))
          ) {
            await cancelResponseBody(response);
            throw new SkillsShSourceHttpError(
              response.status,
              retryAfterMs === null ? null : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
            );
          }
          if (attempt < MAX_SOURCE_ATTEMPTS - 1) {
            await cancelResponseBody(response);
            await waitForSkillsShRetry(response, attempt);
            continue attemptLoop;
          }
          await cancelResponseBody(response);
          return failure("identity-page-fetch-failed");
        }
        await cancelResponseBody(response);
        return failure("identity-page-http-error");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html")) {
        await cancelResponseBody(response);
        return failure("identity-page-content-type");
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_IDENTITY_PAGE_BYTES) {
        await cancelResponseBody(response);
        return failure("identity-page-too-large");
      }
      const body = await readBoundedResponseBytes(response, MAX_IDENTITY_PAGE_BYTES);
      sourceBytes += body.sourceBytes;
      if (!body.ok) {
        await cancelResponseBody(response);
        if (attempt === MAX_SOURCE_ATTEMPTS - 1) {
          return failure("identity-page-fetch-failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue attemptLoop;
      }
      if (body.bytes === null) {
        return failure("identity-page-too-large");
      }
      return {
        ok: true,
        html: new TextDecoder().decode(body.bytes),
        sourceBytes,
      };
    }
  }
  return failure("identity-page-fetch-failed");
}

async function readBoundedResponseBytes(response: Response, maximumBytes: number) {
  if (!response.body) {
    return { ok: true as const, bytes: new Uint8Array(), sourceBytes: 0 };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        return { ok: true as const, bytes: null, sourceBytes: byteLength };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false as const, sourceBytes: byteLength };
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true as const, bytes, sourceBytes: byteLength };
}

async function resolveSkillsShMirrorObservation(
  row: SkillsShCatalogListRow,
  options: SkillsShFetchOptions,
) {
  try {
    return {
      row: buildSkillsShMirrorObservation(row),
      identitySourceBytes: 0,
    };
  } catch (error) {
    if (
      !(error instanceof SkillsShMirrorIdentityError) ||
      error.reason !== "identity-page-required"
    ) {
      return {
        row: safeMirrorIdentityError(row, error),
        identitySourceBytes: 0,
      };
    }
  }
  const sourcePage = await fetchSkillsShIdentityPage(row.url.trim(), options);
  if (!sourcePage.ok) {
    return {
      row: safeMirrorIdentityError(row, new SkillsShMirrorIdentityError(sourcePage.reason)),
      identitySourceBytes: sourcePage.sourceBytes,
    };
  }
  try {
    return {
      row: buildSkillsShMirrorObservation(row, sourcePage.html),
      identitySourceBytes: sourcePage.sourceBytes,
    };
  } catch (error) {
    return {
      row: safeMirrorIdentityError(row, error),
      identitySourceBytes: sourcePage.sourceBytes,
    };
  }
}

function mirrorDetailFile(file: NonNullable<SkillsShCatalogDetail["files"]>[number]) {
  const path =
    typeof file.path === "string"
      ? file.path.trim()
      : typeof file.name === "string"
        ? file.name.trim()
        : "";
  const content =
    typeof file.contents === "string"
      ? file.contents
      : typeof file.content === "string"
        ? file.content
        : null;
  return path && content !== null ? { path, content } : null;
}

function truncateUtf8(value: string, maxBytes: number) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  let truncated = bytes.subarray(0, maxBytes).toString("utf8");
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.replace(/\uFFFD$/u, "");
}

function gitBlobSha(content: string) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function normalizedRepoRelativePath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function githubCommitFromArchiveRedirect(value: string, owner: string, repo: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const commit = parts[3]?.toLowerCase();
  return url.protocol === "https:" &&
    url.hostname === "codeload.github.com" &&
    parts.length === 4 &&
    parts[0]?.toLowerCase() === owner &&
    parts[1]?.toLowerCase() === repo &&
    parts[2] === "zip" &&
    commit &&
    /^[a-f0-9]{40}$/.test(commit)
    ? commit
    : null;
}

async function fetchGitHubRepoTreeSnapshot(
  owner: string,
  repo: string,
  options: {
    fetchImpl: typeof fetch;
    beforeRequest?: () => Promise<void> | void;
    accountRequest: () => void;
    accountBytes: (sourceBytes: number) => void;
  },
): Promise<GitHubRepoTreeSnapshot | null> {
  // GitHub resolves HEAD.zip to an immutable codeload commit URL. Fail closed
  // if that redirect ever stops carrying the exact repository commit SHA.
  const archiveUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/HEAD.zip`;
  await options.beforeRequest?.();
  options.accountRequest();
  let archive: Response;
  try {
    archive = await options.fetchImpl(archiveUrl, {
      headers: { Accept: "application/zip", "User-Agent": "clawhub/skills-sh-mirror" },
      redirect: "manual",
    });
  } catch {
    return null;
  }
  const location = archive.headers.get("location");
  // Source byte accounting includes only response bodies consumed by this
  // process; this redirect body is canceled unread and contributes zero.
  await cancelResponseBody(archive);
  const commit = location ? githubCommitFromArchiveRedirect(location, owner, repo) : null;
  if (!commit) return null;

  const headers = await buildGitHubApiHeaders({
    userAgent: "clawhub/skills-sh-mirror",
    fetchImpl: options.fetchImpl,
  });
  await options.beforeRequest?.();
  options.accountRequest();
  let treeResponse: Response;
  try {
    treeResponse = await options.fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commit}?recursive=1`,
      { headers },
    );
  } catch {
    return null;
  }
  if (!treeResponse.ok) {
    await cancelResponseBody(treeResponse);
    return null;
  }
  let body: Awaited<ReturnType<typeof readBoundedResponseBytes>>;
  try {
    body = await readBoundedResponseBytes(treeResponse, MAX_GITHUB_TREE_BYTES);
  } catch {
    return null;
  }
  options.accountBytes(body.sourceBytes);
  if (!body.ok || body.bytes === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.truncated === true || !Array.isArray(record.tree)) return null;
  if (record.tree.length > MAX_GITHUB_TREE_ENTRIES) return null;
  const blobs = record.tree.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const entry = value as Record<string, unknown>;
    const path = typeof entry.path === "string" ? normalizedRepoRelativePath(entry.path) : null;
    const sha = typeof entry.sha === "string" ? entry.sha.trim().toLowerCase() : "";
    return entry.type === "blob" && path && /^[a-f0-9]{40}$/.test(sha) ? [{ path, sha }] : [];
  });
  return { commit, blobs };
}

export async function resolveSkillsShMirrorGitHubLocators<T extends SkillsShMirrorGitHubLocatorRow>(
  rows: T[],
  options: {
    fetchImpl?: typeof fetch;
    beforeRequest?: () => Promise<void> | void;
    fullDetailContentByExternalId?: ReadonlyMap<string, string>;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let sourceRequests = 0;
  let sourceBytes = 0;
  const accountRequest = () => {
    sourceRequests += 1;
  };
  const accountBytes = (bytes: number) => {
    sourceBytes += bytes;
  };
  const cache = new Map<string, Promise<GitHubRepoTreeSnapshot | null>>();
  const nextRows = [...rows];
  const groups = new Map<string, Array<{ index: number; row: T }>>();
  rows.forEach((row, index) => {
    if (
      row.sourceType !== "github" ||
      !row.owner ||
      !row.repo ||
      !row.slug ||
      !row.detail ||
      (row.detail.truncated && !options.fullDetailContentByExternalId?.has(row.externalId)) ||
      (row.githubPath && row.githubCommit)
    ) {
      return;
    }
    const key = `${row.owner.toLowerCase()}/${row.repo.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push({ index, row });
    groups.set(key, group);
  });

  const groupEntries = Array.from(groups);
  let nextGroup = 0;
  await Promise.all(
    Array.from({ length: Math.min(GITHUB_LOCATOR_CONCURRENCY, groupEntries.length) }, async () => {
      while (nextGroup < groupEntries.length) {
        const [key, group] = groupEntries[nextGroup++]!;
        let snapshotPromise = cache.get(key);
        if (!snapshotPromise) {
          const [owner, repo] = key.split("/") as [string, string];
          snapshotPromise = fetchGitHubRepoTreeSnapshot(owner, repo, {
            fetchImpl,
            beforeRequest: options.beforeRequest,
            accountRequest,
            accountBytes,
          }).then((snapshot) => {
            if (!snapshot) cache.delete(key);
            return snapshot;
          });
          cache.set(key, snapshotPromise);
        }
        const snapshot = await snapshotPromise;
        if (!snapshot) continue;
        for (const { index, row } of group) {
          const relativePath = normalizedRepoRelativePath(row.detail!.path);
          if (!relativePath) continue;
          const fullContent =
            options.fullDetailContentByExternalId?.get(row.externalId) ?? row.detail!.content;
          const expectedBlobSha = gitBlobSha(fullContent);
          const suffix = `/${relativePath.toLowerCase()}`;
          const matches = snapshot.blobs.filter((blob) => {
            const path = blob.path.toLowerCase();
            if (
              blob.sha !== expectedBlobSha ||
              (!path.endsWith(suffix) && path !== relativePath.toLowerCase())
            ) {
              return false;
            }
            const folder = blob.path.split("/").slice(0, -1).join("/");
            return folder.split("/").at(-1)?.toLowerCase() === row.slug!.toLowerCase();
          });
          if (matches.length !== 1) continue;
          const githubPath = matches[0]!.path.split("/").slice(0, -1).join("/");
          if (!githubPath) continue;
          nextRows[index] = {
            ...row,
            githubPath,
            githubCommit: snapshot.commit,
          };
        }
      }
    }),
  );
  return { rows: nextRows, sourceRequests, sourceBytes };
}

export function buildSkillsShMirrorDetail(detail: SkillsShCatalogDetail, maxBytes: number) {
  assertIntegerInRange("maxBytes", maxBytes, 1, 64 * 1024);
  const files = (detail.files ?? [])
    .map(mirrorDetailFile)
    .filter((file): file is { path: string; content: string } => file !== null);
  const candidates = files
    .map((file) => {
      const basename = file.path.split("/").at(-1)?.toLowerCase();
      const contentKind =
        basename === "skill.md"
          ? ("skill-md" as const)
          : basename === "readme.md"
            ? ("readme" as const)
            : null;
      return contentKind ? { ...file, contentKind } : null;
    })
    .filter(
      (
        file,
      ): file is {
        path: string;
        content: string;
        contentKind: "skill-md" | "readme";
      } => file !== null,
    )
    .sort((left, right) => {
      if (left.contentKind !== right.contentKind) {
        return left.contentKind === "skill-md" ? -1 : 1;
      }
      return left.path.length - right.path.length || left.path.localeCompare(right.path);
    });
  const upstreamSourceContentHash =
    typeof detail.hash === "string" && /^[a-f0-9]{64}$/i.test(detail.hash)
      ? detail.hash.toLowerCase()
      : undefined;
  const selected = candidates[0];
  if (!selected) {
    return {
      ...(upstreamSourceContentHash ? { sourceContentHash: upstreamSourceContentHash } : {}),
      sourceFileCount: files.length,
      contentKind: "none" as const,
    };
  }
  const sourceBytes = Buffer.byteLength(selected.content, "utf8");
  const content = truncateUtf8(selected.content, maxBytes);
  const sourceContentHash = upstreamSourceContentHash ?? sha256Hex(selected.content);
  return {
    sourceContentHash,
    sourceFileCount: files.length,
    contentKind: selected.contentKind,
    path: selected.path,
    content,
    contentBytes: Buffer.byteLength(content, "utf8"),
    sourceBytes,
    truncated: sourceBytes > maxBytes,
  };
}

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

async function fetchSkillsShJson<T>(path: string, options: SkillsShFetchOptions = {}): Promise<T> {
  const response = await fetchSkillsShApiResponse(path, options);
  if (response === null) throw new Error("skills.sh catalog source returned unexpected not found");
  return (await response.json()) as T;
}

async function waitForSkillsShRetry(response: Response, attempt: number) {
  const delayMs = skillsShRetryAfterMs(response, attempt);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function skillsShRetryAfterMs(response: Response, attempt: number) {
  const header = response.headers.get("retry-after")?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1_000;
    }
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }
  return Math.min(5_000, 250 * 2 ** attempt);
}

function requestUrl(input: string | URL | Request) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function createRequestPacer(minimumIntervalMs: number) {
  let nextRequestAt = 0;
  let queue = Promise.resolve();
  return async () => {
    const turn = queue.then(async () => {
      const delayMs = Math.max(0, nextRequestAt - Date.now());
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      nextRequestAt = Date.now() + minimumIntervalMs;
    });
    queue = turn.catch(() => undefined);
    await turn;
  };
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

function validateSkillsShMirrorProofEvidence(value: unknown): SkillsShMirrorProofEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("skills.sh mirror proof evidence is invalid");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROOF_SNAPSHOT_BYTES) {
    throw new Error("skills.sh mirror proof evidence is too large");
  }
  const record = value as Record<string, unknown>;
  if (
    !record.pagination ||
    typeof record.pagination !== "object" ||
    Array.isArray(record.pagination) ||
    !record.fields ||
    typeof record.fields !== "object" ||
    Array.isArray(record.fields)
  ) {
    throw new Error("skills.sh mirror proof evidence is invalid");
  }
  return value as SkillsShMirrorProofEvidence;
}

function sortedObjectKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function sortedArrayObjectKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((entry) => sortedObjectKeys(entry)))).sort();
}

function collectObjectKeys(value: unknown, keys = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectObjectKeys(entry, keys);
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    collectObjectKeys(entry, keys);
  }
  return keys;
}

function normalizedTaxonomyFields(value: unknown) {
  return Array.from(collectObjectKeys(value))
    .filter((key) => /^(?:category|categories|topic|topics|tags)$/i.test(key))
    .sort();
}

function skillsShPageIdentityHash(rows: SkillsShCatalogListRow[]) {
  return sha256Hex(rows.map((row) => `${row.id.trim().toLowerCase()}\n`).join(""));
}

function capturedSkillsShCatalogRows(rows: SkillsShCatalogListRow[]) {
  return rows.map((row) => ({
    id: row.id,
    installUrl: row.installUrl,
    installs: row.installs,
    name: row.name,
    slug: row.slug,
    source: row.source,
    sourceType: row.sourceType,
    url: row.url,
  }));
}

function skillsShPageContentHash(rows: SkillsShCatalogListRow[]) {
  return sha256Hex(JSON.stringify(capturedSkillsShCatalogRows(rows)));
}

function parseSkillsShPageFieldEvidence(html: string) {
  const document = parse(html);
  const jsonLdValues = htmlElements(
    document,
    (element) =>
      element.tagName === "script" &&
      htmlAttribute(element, "type")?.toLowerCase() === "application/ld+json",
  ).flatMap((element): unknown[] => {
    try {
      const value = JSON.parse(htmlText(element)) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
    } catch {
      return [];
    }
  });
  const jsonLdDocuments = jsonLdValues.map((value) => {
    const record = value as Record<string, unknown>;
    return {
      type: typeof record["@type"] === "string" ? record["@type"] : null,
      keys: sortedObjectKeys(value),
    };
  });
  return {
    jsonLdDocuments,
    taxonomyFields: normalizedTaxonomyFields(jsonLdValues),
  };
}

function parseSkillsShRscFieldEvidence(rsc: string) {
  const values: unknown[] = [];
  for (const line of rsc.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    let encoded = line.slice(separator + 1);
    if (encoded.startsWith("I[")) encoded = encoded.slice(1);
    if (!["[", "{", '"'].includes(encoded[0] ?? "") && !/^(?:null|true|false|-?\d)/.test(encoded)) {
      continue;
    }
    try {
      values.push(JSON.parse(encoded));
    } catch {
      // Flight control rows are not all standalone JSON values.
    }
  }
  return {
    objectKeys: Array.from(collectObjectKeys(values)).sort(),
    taxonomyFields: normalizedTaxonomyFields(values),
  };
}

function exactSkillsShProofMetadataUrl(value: string, expectedPath: string, rsc: boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const searchKeys = Array.from(url.searchParams.keys());
  const validSearch = rsc
    ? searchKeys.length === 1 &&
      searchKeys[0] === "_rsc" &&
      url.searchParams.get("_rsc") === "clawhub-proof"
    : searchKeys.length === 0;
  return url.protocol === "https:" &&
    ["skills.sh", "www.skills.sh"].includes(url.hostname.toLowerCase()) &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.pathname.toLowerCase() === expectedPath &&
    validSearch
    ? url
    : null;
}

async function fetchSkillsShProofText(
  url: string,
  options: {
    fetchImpl: typeof fetch;
    headers?: Record<string, string>;
    expectedPath: string;
    rsc: boolean;
  },
) {
  const initialUrl = exactSkillsShProofMetadataUrl(url, options.expectedPath, options.rsc);
  if (!initialUrl) {
    throw new Error("skills.sh proof metadata URL is outside the exact skills.sh route");
  }
  for (let attempt = 0; attempt < MAX_SOURCE_ATTEMPTS; attempt += 1) {
    let requestUrl = initialUrl;
    let response: Response | null = null;
    for (let redirect = 0; redirect <= MAX_IDENTITY_PAGE_REDIRECTS; redirect += 1) {
      response = await options.fetchImpl(requestUrl, {
        redirect: "manual",
        headers: {
          "User-Agent": "clawhub/skills-sh-mirror-proof",
          ...options.headers,
        },
      });
      if (!isRedirectStatus(response.status)) break;
      const location = response.headers.get("location");
      const redirected = location
        ? exactSkillsShProofMetadataUrl(
            new URL(location, requestUrl).href,
            options.expectedPath,
            options.rsc,
          )
        : null;
      await cancelResponseBody(response);
      if (!redirected) {
        throw new Error("skills.sh proof metadata redirect is outside the exact skills.sh route");
      }
      if (redirect === MAX_IDENTITY_PAGE_REDIRECTS) {
        throw new Error("skills.sh proof metadata exceeded the redirect limit");
      }
      requestUrl = redirected;
    }
    if (!response) throw new Error("skills.sh proof metadata response is missing");
    if (response.ok) {
      const body = await readBoundedResponseBytes(response, MAX_PROOF_METADATA_BYTES);
      if (!body.ok || body.bytes === null) {
        throw new Error("skills.sh proof metadata response is too large");
      }
      return new TextDecoder().decode(body.bytes);
    }
    if ((response.status !== 429 && response.status < 500) || attempt === MAX_SOURCE_ATTEMPTS - 1) {
      await cancelResponseBody(response);
      throw new Error(`skills.sh proof metadata returned HTTP ${response.status}`);
    }
    await cancelResponseBody(response);
    await waitForSkillsShRetry(response, attempt);
  }
  throw new Error("skills.sh proof metadata exhausted retries");
}

export async function measureSkillsShMirrorProofSource(
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
    oidcToken?: string;
    minimumApiRequestIntervalMs?: number;
  } = {},
) {
  const minimumApiRequestIntervalMs =
    options.minimumApiRequestIntervalMs ??
    (options.fetchImpl ? 0 : MINIMUM_API_REQUEST_INTERVAL_MS);
  assertIntegerInRange("minimumApiRequestIntervalMs", minimumApiRequestIntervalMs, 0, 1_000);
  const pace = createRequestPacer(minimumApiRequestIntervalMs);
  const present = new Set<string>();
  const rowKeys = new Set<string>();
  const taxonomyFields = new Set<string>();
  const requestedPages: SkillsShMirrorProofEvidence["pagination"]["requestedPages"] = [];
  const sourcePages: SkillsShMirrorCapturedSourcePage[] = [];
  let page = 0;
  let sourceRequests = 0;
  let observedRows = 0;
  let catalogTotal: number | null = null;
  let firstPage: SkillsShCatalogPage | null = null;
  let finalNonemptyPage: SkillsShMirrorProofEvidence["pagination"]["finalNonemptyPage"] | null =
    null;
  let sampleRow: SkillsShCatalogListRow | null = null;
  while (true) {
    await pace();
    const response = await fetchSkillsShCatalogPage(
      { page, perPage: MAX_SOURCE_PAGE_SIZE },
      options,
    );
    sourceRequests += 1;
    if (
      response.pagination.page !== page ||
      response.pagination.perPage !== MAX_SOURCE_PAGE_SIZE ||
      response.data.length > MAX_SOURCE_PAGE_SIZE
    ) {
      throw new Error("skills.sh proof source returned an invalid page contract");
    }
    if (catalogTotal === null) catalogTotal = response.pagination.total;
    if (catalogTotal > MAX_PROOF_SOURCE_ROWS) {
      throw new Error(
        `skills.sh proof source total ${catalogTotal} exceeds ${MAX_PROOF_SOURCE_ROWS} rows`,
      );
    }
    if (response.pagination.total !== catalogTotal) {
      throw new Error("skills.sh catalog source total changed during proof measurement");
    }
    firstPage ??= response;
    const identityHash = skillsShPageIdentityHash(response.data);
    const contentHash = skillsShPageContentHash(response.data);
    const capturedRows = capturedSkillsShCatalogRows(response.data);
    requestedPages.push({
      page,
      count: response.data.length,
      hasMore: response.pagination.hasMore,
      identityHash,
      contentHash,
    });
    observedRows += response.data.length;
    if (observedRows > catalogTotal || observedRows > MAX_PROOF_SOURCE_ROWS) {
      throw new Error("skills.sh proof source exceeded its reported total");
    }
    if (response.data.length > 0) {
      finalNonemptyPage = {
        page,
        count: response.data.length,
        pagination: response.pagination,
      };
      const captured = {
        page,
        sourceTotal: catalogTotal,
        pageLength: response.data.length,
        hasMore: response.pagination.hasMore,
        identityHash,
        contentHash,
        sourceBytes: Buffer.byteLength(JSON.stringify(response), "utf8"),
        rows: capturedRows,
      };
      sourcePages.push({
        ...captured,
        serializedBytes: Buffer.byteLength(JSON.stringify(captured), "utf8"),
      });
    }
    for (const row of response.data) {
      present.add(row.id.trim().toLowerCase());
      for (const key of sortedObjectKeys(row)) rowKeys.add(key);
      for (const key of normalizedTaxonomyFields(row)) taxonomyFields.add(key);
      if (!sampleRow && row.id.split("/").length === 3) sampleRow = row;
    }
    if (!response.pagination.hasMore) break;
    if (
      observedRows >= catalogTotal ||
      page + 1 >= Math.ceil(MAX_PROOF_SOURCE_ROWS / MAX_SOURCE_PAGE_SIZE)
    ) {
      throw new Error("skills.sh proof source pagination exceeds its bounded total");
    }
    page += 1;
  }
  if (catalogTotal === null || catalogTotal < 1) {
    throw new Error("skills.sh proof source is empty");
  }
  if (observedRows !== catalogTotal) {
    throw new Error(`skills.sh proof source observed ${observedRows} of ${catalogTotal} rows`);
  }
  if (present.size !== observedRows) {
    throw new Error(
      `skills.sh proof source contains duplicate identities: ${observedRows - present.size}`,
    );
  }
  if (!firstPage || !finalNonemptyPage || !sampleRow) {
    throw new Error("skills.sh proof source lacks a metadata sample");
  }
  const beyondEndPageNumber = page + 1;
  await pace();
  const beyondEnd = await fetchSkillsShCatalogPage(
    { page: beyondEndPageNumber, perPage: MAX_SOURCE_PAGE_SIZE },
    options,
  );
  sourceRequests += 1;
  requestedPages.push({
    page: beyondEndPageNumber,
    count: beyondEnd.data.length,
    hasMore: beyondEnd.pagination.hasMore,
    identityHash: skillsShPageIdentityHash(beyondEnd.data),
    contentHash: skillsShPageContentHash(beyondEnd.data),
  });
  if (
    beyondEnd.pagination.page !== beyondEndPageNumber ||
    beyondEnd.pagination.perPage !== MAX_SOURCE_PAGE_SIZE ||
    beyondEnd.pagination.total !== catalogTotal ||
    beyondEnd.pagination.hasMore ||
    beyondEnd.data.length !== 0
  ) {
    throw new Error("skills.sh proof source did not return an empty beyond-end page");
  }
  await pace();
  const search = await searchSkillsShCatalog(
    {
      query: sampleRow.slug,
      owner: sampleRow.source.split("/")[0],
      limit: 10,
    },
    options,
  );
  sourceRequests += 1;
  await pace();
  const detail = await fetchSkillsShCatalogDetail(sampleRow.id, options);
  sourceRequests += 1;
  const expectedPagePath = `/${sampleRow.id.trim().toLowerCase()}`;
  const pageHtml = await fetchSkillsShProofText(sampleRow.url, {
    fetchImpl: options.fetchImpl ?? fetch,
    expectedPath: expectedPagePath,
    rsc: false,
  });
  sourceRequests += 1;
  const rscUrl = new URL(sampleRow.url);
  rscUrl.searchParams.set("_rsc", "clawhub-proof");
  const rsc = await fetchSkillsShProofText(rscUrl.href, {
    fetchImpl: options.fetchImpl ?? fetch,
    headers: {
      Accept: "text/x-component",
      RSC: "1",
    },
    expectedPath: expectedPagePath,
    rsc: true,
  });
  sourceRequests += 1;
  const pageFields = parseSkillsShPageFieldEvidence(pageHtml);
  const rscFields = parseSkillsShRscFieldEvidence(rsc);
  const searchTaxonomyFields = normalizedTaxonomyFields(search);
  const detailTaxonomyFields = normalizedTaxonomyFields(detail);
  const normalizedUpstreamTaxonomyFields = Array.from(
    new Set([
      ...taxonomyFields,
      ...searchTaxonomyFields,
      ...detailTaxonomyFields,
      ...pageFields.taxonomyFields,
      ...rscFields.taxonomyFields,
    ]),
  ).sort();
  return {
    catalogTotal,
    controlledExternalIds: [...SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS],
    controlledOverlayExternalIds: SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS.filter((externalId) =>
      present.has(externalId),
    ),
    controlledSupplementExternalIds: SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS.filter(
      (externalId) => !present.has(externalId),
    ),
    pageSize: MAX_SOURCE_PAGE_SIZE,
    sourceRequests,
    sourcePages,
    evidence: {
      pagination: {
        endpointExhausted: true,
        databaseCoverage: "leaderboard-only",
        page0: firstPage.pagination,
        requestedPages,
        finalNonemptyPage,
        firstBeyondEndPage: {
          page: beyondEndPageNumber,
          count: 0,
          pagination: beyondEnd.pagination,
        },
        uniqueIds: present.size,
        duplicateIds: observedRows - present.size,
      },
      fields: {
        sampledExternalId: sampleRow.id,
        leaderboard: {
          topLevelKeys: sortedObjectKeys(firstPage),
          paginationKeys: sortedObjectKeys(firstPage.pagination),
          rowKeys: Array.from(rowKeys).sort(),
          taxonomyFields: Array.from(taxonomyFields).sort(),
        },
        search: {
          topLevelKeys: sortedObjectKeys(search),
          rowKeys: sortedArrayObjectKeys(search.data),
          taxonomyFields: searchTaxonomyFields,
        },
        detail: {
          topLevelKeys: sortedObjectKeys(detail),
          fileKeys: sortedArrayObjectKeys(detail.files),
          taxonomyFields: detailTaxonomyFields,
        },
        page: {
          url: sampleRow.url,
          ...pageFields,
        },
        rsc: rscFields,
        normalizedUpstreamTaxonomyFields,
      },
    } satisfies SkillsShMirrorProofEvidence,
  };
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

async function fetchSkillsShMirrorDetail(id: string, options: SkillsShFetchOptions = {}) {
  return await fetchSkillsShJson<SkillsShCatalogDetail>(
    `/skills/${normalizeSkillsShId(id)}`,
    options,
  );
}

export async function fetchSkillsShMirrorBatch(
  args: {
    page: number;
    offset: number;
    limit: number;
    maxDetailBytes: number;
  },
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
    oidcToken?: string;
    minimumApiRequestIntervalMs?: number;
    beforeRequest?: () => Promise<void> | void;
    githubLocatorResolver?: typeof resolveSkillsShMirrorGitHubLocators | null;
    sourcePage?: SkillsShCatalogPage;
  } = {},
) {
  assertIntegerInRange("page", args.page, 0, 100_000);
  assertIntegerInRange("offset", args.offset, 0, MAX_SOURCE_PAGE_SIZE);
  assertIntegerInRange("limit", args.limit, 1, 50);
  assertIntegerInRange("maxDetailBytes", args.maxDetailBytes, 1, 64 * 1024);
  const baseFetch = options.fetchImpl ?? fetch;
  const minimumApiRequestIntervalMs =
    options.minimumApiRequestIntervalMs ??
    (options.fetchImpl ? 0 : MINIMUM_API_REQUEST_INTERVAL_MS);
  assertIntegerInRange("minimumApiRequestIntervalMs", minimumApiRequestIntervalMs, 0, 1_000);
  const paceApiRequest = createRequestPacer(minimumApiRequestIntervalMs);
  let sourceRequests = 0;
  // Count every list, detail, audit, and identity-page attempt through one wrapper.
  const monitoredFetch: typeof fetch = async (input, init) => {
    await options.beforeRequest?.();
    sourceRequests += 1;
    if (minimumApiRequestIntervalMs > 0 && requestUrl(input).startsWith(`${SKILLS_SH_API_BASE}/`)) {
      await paceApiRequest();
    }
    return await baseFetch(input, init);
  };
  const fetchOptions = { ...options, fetchImpl: monitoredFetch };
  const sourcePage =
    options.sourcePage ??
    (await fetchSkillsShCatalogPage(
      { page: args.page, perPage: MAX_SOURCE_PAGE_SIZE },
      fetchOptions,
    ));
  if (
    sourcePage.pagination.page !== args.page ||
    sourcePage.pagination.perPage !== MAX_SOURCE_PAGE_SIZE ||
    sourcePage.data.length > MAX_SOURCE_PAGE_SIZE
  ) {
    throw new Error("skills.sh mirror source returned an invalid page contract");
  }
  if (args.offset >= sourcePage.data.length) {
    throw new Error("skills.sh mirror offset is outside the source page");
  }
  const listRows = sourcePage.data.slice(args.offset, args.offset + args.limit);
  const rows = Array.from<
    | (ReturnType<typeof buildSkillsShMirrorObservation> & {
        upstreamScanners: SkillsShMirrorUpstreamScanners;
        sourceContentHash?: string;
        detail?: {
          contentKind: "skill-md" | "readme";
          path: string;
          content: string;
          contentBytes: number;
          sourceBytes: number;
          sourceFileCount: number;
          truncated: boolean;
        };
      })
    | ReturnType<typeof safeMirrorIdentityError>
  >({ length: listRows.length });
  const fullDetailContentByExternalId = new Map<string, string>();
  // Count only response-body bytes the mirror consumed; canceled unread bodies contribute zero.
  let rowSourceBytes = 0;
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(DETAIL_CONCURRENCY, listRows.length) }, async () => {
      while (nextIndex < listRows.length) {
        const index = nextIndex;
        nextIndex += 1;
        const listRow = listRows[index]!;
        const identity = await resolveSkillsShMirrorObservation(listRow, fetchOptions);
        rowSourceBytes += identity.identitySourceBytes;
        if ("quarantined" in identity.row) {
          rows[index] = identity.row;
          continue;
        }
        try {
          normalizeSkillsShId(identity.row.externalId);
        } catch (error) {
          rows[index] = safeMirrorIdentityError(listRow, error);
          continue;
        }
        const [detailPayload, auditPayload] = await Promise.all([
          fetchSkillsShMirrorDetail(identity.row.externalId, fetchOptions),
          fetchSkillsShMirrorAudit(identity.row.externalId, fetchOptions),
        ]);
        rowSourceBytes +=
          Buffer.byteLength(JSON.stringify(detailPayload), "utf8") +
          (auditPayload === null ? 0 : Buffer.byteLength(JSON.stringify(auditPayload), "utf8"));
        const detail = buildSkillsShMirrorDetail(detailPayload, args.maxDetailBytes);
        if (detail.contentKind !== "none") {
          const fullDetail = (detailPayload.files ?? [])
            .map(mirrorDetailFile)
            .find((file) => file?.path === detail.path);
          if (fullDetail) {
            fullDetailContentByExternalId.set(identity.row.externalId, fullDetail.content);
          }
        }
        rows[index] = {
          ...identity.row,
          ...(detail.sourceContentHash ? { sourceContentHash: detail.sourceContentHash } : {}),
          upstreamScanners: buildSkillsShMirrorUpstreamScanners(auditPayload, listRow.url),
          ...(detail.contentKind === "none"
            ? {}
            : {
                detail: {
                  contentKind: detail.contentKind,
                  path: detail.path,
                  content: detail.content,
                  contentBytes: detail.contentBytes,
                  sourceBytes: detail.sourceBytes,
                  sourceFileCount: detail.sourceFileCount,
                  truncated: detail.truncated,
                },
              }),
        };
      }
    }),
  );
  const githubLocatorResolver =
    options.githubLocatorResolver === undefined
      ? resolveSkillsShMirrorGitHubLocators
      : options.githubLocatorResolver;
  const located = githubLocatorResolver
    ? await githubLocatorResolver(rows, {
        fetchImpl: baseFetch,
        beforeRequest: options.beforeRequest,
        fullDetailContentByExternalId,
      })
    : { rows, sourceRequests: 0, sourceBytes: 0 };
  sourceRequests += located.sourceRequests;
  rowSourceBytes += located.sourceBytes;
  return {
    page: args.page,
    offset: args.offset,
    pageLength: sourcePage.data.length,
    sourceTotal: sourcePage.pagination.total,
    sourcePageIdentityHash: skillsShPageIdentityHash(sourcePage.data),
    hasMore: sourcePage.pagination.hasMore,
    sourceRequests,
    sourceBytes:
      (options.sourcePage ? 0 : Buffer.byteLength(JSON.stringify(sourcePage), "utf8")) +
      rowSourceBytes,
    rows: located.rows,
  };
}

export async function fetchSkillsShMirrorControlledBatch(
  args: {
    page: number;
    offset: number;
    limit: number;
    maxDetailBytes: number;
    sourceTotal: number;
    externalIds: string[];
  },
  options: {
    fetchImpl?: typeof fetch;
    beforeRequest?: () => Promise<void> | void;
  } = {},
) {
  const controlledExternalIds = normalizeControlledSupplementIds(args.externalIds);
  if (controlledExternalIds.length < 1) throw new Error("controlled mirror supplement is empty");
  assertIntegerInRange("offset", args.offset, 0, controlledExternalIds.length - 1);
  assertIntegerInRange("limit", args.limit, 1, 50);
  assertIntegerInRange("maxDetailBytes", args.maxDetailBytes, 1, 64 * 1024);
  const supplementsByExternalId = new Map(
    SKILLS_SH_MIRROR_CONTROLLED_SUPPLEMENTS.map((row) => [row.externalId, row]),
  );
  const selected = controlledExternalIds
    .slice(args.offset, args.offset + args.limit)
    .map((externalId) => supplementsByExternalId.get(externalId)!);
  if (selected.length < 1) throw new Error("controlled mirror supplement is exhausted");
  const fetchImpl = options.fetchImpl ?? fetch;
  let sourceBytes = 0;
  let sourceRequests = 0;
  const rows = await Promise.all(
    selected.map(async (supplement) => {
      const rawUrl =
        `https://raw.githubusercontent.com/${supplement.owner}/${supplement.repo}/` +
        `${supplement.githubCommit}/${supplement.detailPath}`;
      let response: Response | null = null;
      for (let attempt = 0; attempt < MAX_SOURCE_ATTEMPTS; attempt += 1) {
        await options.beforeRequest?.();
        sourceRequests += 1;
        try {
          response = await fetchImpl(rawUrl, {
            headers: { Accept: "text/plain", "User-Agent": "clawhub/skills-sh-mirror" },
          });
        } catch {
          response = null;
        }
        if (response?.ok) break;
        if (response && response.status !== 429 && response.status < 500) {
          await cancelResponseBody(response);
          throw new Error(
            `controlled skills.sh mirror source returned HTTP ${response.status}: ${supplement.externalId}`,
          );
        }
        if (response) {
          const retryAfterMs =
            response.status === 429 ? skillsShRetryAfterMs(response, attempt) : null;
          if (
            response.status === 429 &&
            (attempt === MAX_SOURCE_ATTEMPTS - 1 ||
              (retryAfterMs !== null && retryAfterMs > MAX_INLINE_RETRY_AFTER_MS))
          ) {
            await cancelResponseBody(response);
            throw new SkillsShSourceHttpError(
              response.status,
              retryAfterMs === null ? null : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
            );
          }
          if (attempt === MAX_SOURCE_ATTEMPTS - 1) {
            await cancelResponseBody(response);
            break;
          }
          await cancelResponseBody(response);
          await waitForSkillsShRetry(response, attempt);
        } else {
          if (attempt === MAX_SOURCE_ATTEMPTS - 1) break;
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        }
      }
      if (!response?.ok) {
        throw new Error(
          `controlled skills.sh mirror source fetch failed: ${supplement.externalId}`,
        );
      }
      const body = await readBoundedResponseBytes(response, MAX_CONTROLLED_DETAIL_BYTES);
      sourceBytes += body.sourceBytes;
      if (!body.ok || body.bytes === null) {
        throw new Error(
          `controlled skills.sh mirror source is too large: ${supplement.externalId}`,
        );
      }
      const fullContent = new TextDecoder().decode(body.bytes);
      return buildSkillsShMirrorControlledObservation(
        supplement,
        fullContent,
        body.sourceBytes,
        args.maxDetailBytes,
      );
    }),
  );
  return {
    page: args.page,
    offset: args.offset,
    pageLength: controlledExternalIds.length,
    sourceTotal: args.sourceTotal,
    hasMore: false,
    sourceRequests,
    sourceBytes,
    rows,
  };
}

export function buildSkillsShMirrorControlledObservation(
  supplement: SkillsShMirrorControlledSupplement,
  fullContent: string,
  sourceBytes: number,
  maxDetailBytes: number,
) {
  assertIntegerInRange("sourceBytes", sourceBytes, 0, MAX_CONTROLLED_DETAIL_BYTES);
  assertIntegerInRange("maxDetailBytes", maxDetailBytes, 1, 64 * 1024);
  const sourceContentHash = sha256Hex(fullContent);
  if (sourceContentHash !== supplement.sourceContentHash) {
    throw new Error(`controlled skills.sh mirror source hash changed: ${supplement.externalId}`);
  }
  const content = truncateUtf8(fullContent, maxDetailBytes);
  const unavailable = { status: "unavailable" as const };
  return {
    externalId: supplement.externalId,
    sourceType: "github" as const,
    upstreamSourceType: "controlled-github",
    owner: supplement.owner,
    repo: supplement.repo,
    slug: supplement.slug,
    displayName: supplement.displayName,
    sourceUrl: supplement.sourceUrl,
    canonicalRepoUrl: `https://github.com/${supplement.owner}/${supplement.repo}`,
    githubPath: supplement.githubPath,
    githubCommit: supplement.githubCommit,
    sourceContentHash,
    upstreamInstalls: 0,
    upstreamScanners: {
      genAgentTrustHub: unavailable,
      socket: unavailable,
      snyk: unavailable,
    },
    detail: {
      contentKind: "skill-md" as const,
      path: supplement.detailPath,
      content,
      contentBytes: Buffer.byteLength(content, "utf8"),
      sourceBytes,
      sourceFileCount: 1,
      truncated: sourceBytes > maxDetailBytes,
    },
  };
}

export function getSkillsShCatalogTestSourcePolicy(env: SkillsShCatalogSourceEnv = process.env) {
  const rollout = getClawHubRolloutCapabilities(env);
  if (!rollout.skillsSh.runtimeEnabled) {
    return {
      allowed: false as const,
      environment: rollout.environment,
      reason: "skills.sh catalog rollout is disabled",
    };
  }
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
  provenance:
    | "live-github"
    | "stored-authenticated-staging-live"
    | "stored-authenticated-staging-live+live-github";
  fetches: number;
  reused: number;
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
        skippedIncompleteDetails: number;
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
  const expectedProvenance =
    proof.reused === 0
      ? "live-github"
      : proof.fetches === 0
        ? "stored-authenticated-staging-live"
        : "stored-authenticated-staging-live+live-github";
  if (
    proof.authentication !== "clawhub-github-authenticated" ||
    !Number.isInteger(proof.fetches) ||
    proof.fetches < 0 ||
    !Number.isInteger(proof.reused) ||
    proof.reused < 0 ||
    proof.fetches + proof.reused !== selectedOwners.length ||
    proof.provenance !== expectedProvenance ||
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
    environment: "test",
  });
  if (
    verified.payload.project_id !== CLAWHUB_VERCEL_PROJECT_ID ||
    verified.payload.owner_id !== CLAWHUB_VERCEL_OWNER_ID ||
    verified.payload.environment !== "test"
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

function sha256Hex(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

type CompleteArtifactFile = { name: string; content: string };

function hasCompleteArtifactFiles(
  files: SkillsShCatalogDetail["files"],
): files is CompleteArtifactFile[] {
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.every(
      (file) =>
        typeof file.name === "string" &&
        file.name.trim().length > 0 &&
        typeof file.content === "string",
    )
  );
}

function buildArtifact(detail: SkillsShCatalogDetail) {
  if (!hasCompleteArtifactFiles(detail.files)) {
    throw new Error(`skills.sh live admission has incomplete artifact files: ${detail.id}`);
  }
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

async function selectSkillsShCatalogTestRows(
  fetchOptions: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
    oidcToken?: string;
  },
  requiredArtifactIds: ReadonlySet<string>,
) {
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
    ...requiredArtifactIds,
  ]);
  for (const row of nvidiaRows) candidates.set(row.externalId, row);
  for (const id of requiredIds) {
    if (!candidates.has(id)) throw new Error(`Required skills.sh live row is missing: ${id}`);
  }
  const candidateRows = [
    ...Array.from(requiredIds, (id) => candidates.get(id)!),
    ...Array.from(candidates.values()).filter((row) => !requiredIds.has(row.externalId)),
  ];
  const selected: Array<{
    row: ReturnType<typeof normalizeListRow>;
    detail: HashQualifiedSkillsShCatalogDetail;
  }> = [];
  let detailFetches = 0;
  let skippedIncompleteDetails = 0;
  for (
    let offset = 0;
    offset < candidateRows.length && selected.length < MAX_SOURCE_PAGE_SIZE;
    offset += DETAIL_CONCURRENCY
  ) {
    const batch = candidateRows.slice(offset, offset + DETAIL_CONCURRENCY);
    const details = await Promise.all(
      batch.map(async (row) => await fetchSkillsShCatalogDetail(row.externalId, fetchOptions)),
    );
    detailFetches += details.length;
    for (let index = 0; index < batch.length; index += 1) {
      const row = batch[index]!;
      const detail = details[index]!;
      const hasExactHash =
        detail.id.trim().toLowerCase() === row.externalId &&
        typeof detail.hash === "string" &&
        /^[a-f0-9]{64}$/i.test(detail.hash);
      if (!hasExactHash) {
        if (requiredIds.has(row.externalId) || requiredArtifactIds.has(row.externalId)) {
          throw new Error(
            `Required skills.sh live row lacks an exact detail hash: ${row.externalId}`,
          );
        }
        skippedIncompleteDetails += 1;
        continue;
      }
      if (
        requiredArtifactIds.has(row.externalId) &&
        (!Array.isArray(detail.files) || detail.files.length < 1)
      ) {
        throw new Error(`skills.sh live admission lacks artifact files: ${row.externalId}`);
      }
      if (requiredArtifactIds.has(row.externalId) && !hasCompleteArtifactFiles(detail.files)) {
        throw new Error(
          `skills.sh live admission has incomplete artifact files: ${row.externalId}`,
        );
      }
      selected.push({ row, detail: detail as HashQualifiedSkillsShCatalogDetail });
      if (selected.length === MAX_SOURCE_PAGE_SIZE) break;
    }
  }
  if (selected.length !== MAX_SOURCE_PAGE_SIZE) {
    throw new Error(`Expected ${MAX_SOURCE_PAGE_SIZE} hash-qualified live rows`);
  }
  return {
    selected,
    selectedOwners: Array.from(new Set(selected.map(({ row }) => row.owner))).sort(),
    listFetches,
    detailFetches,
    skippedIncompleteDetails,
    selection: {
      rows: selected.length,
      nvidiaRows: selected.filter(({ row }) => row.owner === "nvidia").length,
      requiredCollisionIds: REQUIRED_COLLISION_IDS,
      skippedIncompleteDetails,
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
  const admitted = new Set(
    (options.admitExternalIds ?? []).map((externalId) => externalId.trim().toLowerCase()),
  );
  if (admitted.size > authorization.maxRealScanAdmissions) {
    throw new Error(
      `skills.sh live Test admission cannot exceed ${authorization.maxRealScanAdmissions}`,
    );
  }
  const selection = await selectSkillsShCatalogTestRows(fetchOptions, admitted);
  const sourcePreflight = {
    skillsShFetches: selection.listFetches + 1 + selection.detailFetches,
    listFetches: selection.listFetches,
    searchFetches: 1,
    detailFetches: selection.detailFetches,
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
  const selected = selection.selected;
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
      skippedIncompleteDetails: selection.skippedIncompleteDetails,
    },
    metrics: {
      runtimeMs: Date.now() - startedAt,
      skillsShFetches: selection.listFetches + 1 + selection.detailFetches,
      listFetches: selection.listFetches,
      searchFetches: 1,
      detailFetches: selection.detailFetches,
      githubOwnerFetches: githubOwnerProof.fetches,
      githubOwnerIdsReused: githubOwnerProof.reused,
      githubOwnerProofProvenance: githubOwnerProof.provenance,
      skippedIncompleteDetails: selection.skippedIncompleteDetails,
    },
  };
}
