type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type JwtPayload = Record<string, unknown>;

type JwkSet = {
  keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string; kty?: string }>;
};

export type TrustedGitHubActionsPublisher = {
  repository: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryOwnerId: string;
  workflowFilename: string;
  environment?: string;
};

export type VerifiedGitHubActionsIdentity = {
  repository: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryOwnerId: string;
  workflowFilename: string;
  workflowName: string;
  workflowRef: string;
  jobWorkflowRef?: string;
  environment?: string;
  runnerEnvironment: string;
  eventName: string;
  sha: string;
  ref: string;
  refType?: string;
  actor?: string;
  actorId?: string;
  runId: string;
  runAttempt: string;
};

type VerifyGitHubActionsOidcOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type GitHubRepositoryIdentity = {
  repository: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryOwnerId: string;
};

type ParsedWorkflowRef = {
  repository: string;
  workflowFilename: string;
};

const GITHUB_ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_ACTIONS_JWKS_URL = `${GITHUB_ACTIONS_ISSUER}/.well-known/jwks`;
const TRUSTED_AUDIENCE = "clawhub";
const CLOCK_SKEW_MS = 60_000;
const JWKS_CACHE_TTL_MS = 5 * 60_000;
const OFFICIAL_REUSABLE_WORKFLOW_REPOSITORY = "openclaw/clawhub";
const OFFICIAL_REUSABLE_WORKFLOW_FILENAME = "package-publish.yml";

let cachedJwks: { value: JwkSet; fetchedAt: number } | null = null;

export async function verifyGitHubActionsTrustedPublishJwt(
  jwt: string,
  trustedPublisher: TrustedGitHubActionsPublisher,
  options: VerifyGitHubActionsOidcOptions = {},
): Promise<VerifiedGitHubActionsIdentity> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = (options.now ?? Date.now)();
  const { signingInput, signature, header, payload } = decodeJwt(jwt);

  if (header.alg !== "RS256") {
    throw new Error(
      `Unsupported GitHub OIDC signing algorithm: ${formatClaimValue(header.alg ?? "<missing>")}`,
    );
  }

  const keyId = requireString(header.kid, "kid");
  let jwks = await fetchGitHubActionsJwks(fetchImpl, now);
  let jwk = jwks.keys?.find((entry) => entry.kid === keyId);
  if (!jwk) {
    jwks = await fetchGitHubActionsJwks(fetchImpl, now, true);
    jwk = jwks.keys?.find((entry) => entry.kid === keyId);
  }
  if (!jwk) throw new Error(`Unknown GitHub OIDC signing key: ${keyId}`);

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(signingInput),
  );
  if (!verified) throw new Error("Invalid GitHub OIDC signature");

  const issuer = requireString(payload.iss, "iss");
  if (issuer !== GITHUB_ACTIONS_ISSUER) {
    throw new Error(`Unexpected GitHub OIDC issuer: ${issuer}`);
  }
  if (!claimContainsAudience(payload.aud, TRUSTED_AUDIENCE)) {
    throw new Error(`Unexpected GitHub OIDC audience: ${formatAudience(payload.aud)}`);
  }
  assertTokenTimeWindow(payload, now);

  const repository = requireString(payload.repository, "repository");
  const repositoryId = requireClaimString(payload.repository_id, "repository_id");
  const repositoryOwner = requireString(payload.repository_owner, "repository_owner");
  const repositoryOwnerId = requireClaimString(payload.repository_owner_id, "repository_owner_id");
  const workflowRef = requireString(payload.workflow_ref, "workflow_ref");
  const workflow = parseWorkflowRef(workflowRef, repository);
  const jobWorkflowRef = optionalString(payload.job_workflow_ref);
  const runnerEnvironment = requireString(payload.runner_environment, "runner_environment");
  const environment = optionalString(payload.environment);
  const eventName = requireString(payload.event_name, "event_name");
  const workflowName = requireString(payload.workflow, "workflow");
  const sha = requireString(payload.sha, "sha");
  const ref = requireString(payload.ref, "ref");
  const runId = requireClaimString(payload.run_id, "run_id");
  const runAttempt = requireClaimString(payload.run_attempt, "run_attempt");
  const refType = optionalString(payload.ref_type);
  const actor = optionalString(payload.actor);
  const actorId = optionalStringValue(payload.actor_id);

  if (repository !== trustedPublisher.repository) {
    throw new Error(`GitHub OIDC repository mismatch: expected ${trustedPublisher.repository}, got ${repository}`);
  }
  if (repositoryId !== trustedPublisher.repositoryId) {
    throw new Error(
      `GitHub OIDC repository_id mismatch: expected ${trustedPublisher.repositoryId}, got ${repositoryId}`,
    );
  }
  if (repositoryOwner !== trustedPublisher.repositoryOwner) {
    throw new Error(
      `GitHub OIDC repository_owner mismatch: expected ${trustedPublisher.repositoryOwner}, got ${repositoryOwner}`,
    );
  }
  if (repositoryOwnerId !== trustedPublisher.repositoryOwnerId) {
    throw new Error(
      `GitHub OIDC repository_owner_id mismatch: expected ${trustedPublisher.repositoryOwnerId}, got ${repositoryOwnerId}`,
    );
  }
  if (workflow.workflowFilename !== trustedPublisher.workflowFilename) {
    throw new Error(
      `GitHub OIDC workflow mismatch: expected ${trustedPublisher.workflowFilename}, got ${workflow.workflowFilename}`,
    );
  }
  if (jobWorkflowRef) {
    const reusableWorkflow = parseWorkflowRef(jobWorkflowRef);
    const usesOfficialReusableWorkflow =
      reusableWorkflow.repository === OFFICIAL_REUSABLE_WORKFLOW_REPOSITORY &&
      reusableWorkflow.workflowFilename === OFFICIAL_REUSABLE_WORKFLOW_FILENAME;
    if (!usesOfficialReusableWorkflow) {
      throw new Error(
        "Only the official ClawHub reusable workflow is supported for trusted publishing",
      );
    }
  }
  if (runnerEnvironment !== "github-hosted") {
    throw new Error(`Only GitHub-hosted runners may mint trusted publish tokens, got ${runnerEnvironment}`);
  }
  // v1 keeps secretless publishing behind a manual entry point. Environment
  // pinning is optional, but if configured it must match exactly.
  if (eventName !== "workflow_dispatch") {
    throw new Error(`Trusted publishing requires workflow_dispatch, got ${eventName}`);
  }
  if (trustedPublisher.environment && environment !== trustedPublisher.environment) {
    throw new Error(
      `GitHub OIDC environment mismatch: expected ${trustedPublisher.environment}, got ${formatClaimValue(environment ?? "<missing>")}`,
    );
  }

  return {
    repository,
    repositoryId,
    repositoryOwner,
    repositoryOwnerId,
    workflowFilename: workflow.workflowFilename,
    workflowName,
    workflowRef,
    ...(jobWorkflowRef ? { jobWorkflowRef } : {}),
    ...(environment ? { environment } : {}),
    runnerEnvironment,
    eventName,
    sha,
    ref,
    ...(refType ? { refType } : {}),
    ...(actor ? { actor } : {}),
    ...(actorId ? { actorId } : {}),
    runId,
    runAttempt,
  };
}

export async function fetchGitHubRepositoryIdentity(
  repository: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubRepositoryIdentity> {
  const normalizedRepository = normalizeGitHubRepository(repository);
  if (!normalizedRepository) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  const response = await fetchImpl(`https://api.github.com/repos/${normalizedRepository}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "clawhub/package-trusted-publisher",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub repository lookup failed for ${normalizedRepository}: ${response.status}`);
  }
  const body = (await response.json()) as {
    id?: unknown;
    full_name?: unknown;
    owner?: { login?: unknown; id?: unknown };
  };
  const resolvedRepository = requireString(body.full_name, "full_name");
  const ownerLogin = requireString(body.owner?.login, "owner.login");
  return {
    repository: resolvedRepository,
    repositoryId: requireClaimString(body.id, "id"),
    repositoryOwner: ownerLogin,
    repositoryOwnerId: requireClaimString(body.owner?.id, "owner.id"),
  };
}

export function normalizeGitHubRepository(repository: string) {
  const trimmed = repository.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export function extractWorkflowFilenameFromWorkflowRef(workflowRef: string, expectedRepository?: string) {
  return parseWorkflowRef(workflowRef, expectedRepository).workflowFilename;
}

function parseWorkflowRef(workflowRef: string, expectedRepository?: string): ParsedWorkflowRef {
  const match = /^([^/]+\/[^/]+)\/\.github\/workflows\/([^@/]+)@.+$/.exec(workflowRef.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid GitHub workflow_ref claim: ${workflowRef}`);
  }
  if (expectedRepository && match[1] !== expectedRepository) {
    throw new Error(
      `GitHub workflow_ref repository mismatch: expected ${expectedRepository}, got ${match[1]}`,
    );
  }
  return {
    repository: match[1],
    workflowFilename: match[2],
  };
}

function decodeJwt(jwt: string) {
  const parts = jwt.trim().split(".");
  if (parts.length !== 3) throw new Error("Invalid GitHub OIDC token format");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonSegment<JwtHeader>(encodedHeader, "header");
  const payload = parseJsonSegment<JwtPayload>(encodedPayload, "payload");
  return {
    header,
    payload,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: base64UrlToBytes(encodedSignature),
  };
}

function parseJsonSegment<T>(segment: string, label: string) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    throw new Error(`Invalid GitHub OIDC ${label}`);
  }
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function fetchGitHubActionsJwks(fetchImpl: typeof fetch, now: number, forceRefresh = false) {
  if (!forceRefresh && cachedJwks && now - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks.value;
  }
  const response = await fetchImpl(GITHUB_ACTIONS_JWKS_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "clawhub/github-actions-oidc",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub OIDC JWKS: ${response.status}`);
  }
  const jwks = (await response.json()) as JwkSet;
  cachedJwks = { value: jwks, fetchedAt: now };
  return jwks;
}

function claimContainsAudience(audience: unknown, expected: string) {
  if (typeof audience === "string") return audience === expected;
  if (!Array.isArray(audience)) return false;
  return audience.includes(expected);
}

function formatAudience(audience: unknown) {
  if (typeof audience === "string") return audience;
  if (Array.isArray(audience)) return audience.join(", ");
  return formatClaimValue(audience ?? "<missing>");
}

function formatClaimValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function assertTokenTimeWindow(payload: JwtPayload, now: number) {
  const expiresAt = requireNumericClaim(payload.exp, "exp") * 1000;
  if (now - CLOCK_SKEW_MS >= expiresAt) {
    throw new Error("GitHub OIDC token has expired");
  }
  const notBefore = payload.nbf === undefined ? undefined : requireNumericClaim(payload.nbf, "nbf") * 1000;
  if (typeof notBefore === "number" && now + CLOCK_SKEW_MS < notBefore) {
    throw new Error("GitHub OIDC token is not active yet");
  }
}

function requireClaimString(value: unknown, label: string) {
  const normalized = optionalStringValue(value);
  if (!normalized) throw new Error(`Missing GitHub OIDC claim: ${label}`);
  return normalized;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing GitHub OIDC claim: ${label}`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalStringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return optionalString(value);
}

function requireNumericClaim(value: unknown, label: string) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Missing GitHub OIDC claim: ${label}`);
}

export const __test = {
  base64UrlToBytes,
  claimContainsAudience,
};
