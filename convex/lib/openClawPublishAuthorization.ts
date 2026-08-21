import { strFromU8, unzipSync } from "fflate";
import type { VerifiedGitHubActionsIdentity } from "./githubActionsOidc";
import { buildGitHubApiHeaders } from "./githubAuth";

const MAX_JSON_BYTES = 64 * 1024;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/;
const WORKFLOW_PATTERN = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const MAIN_FULL_REF = "refs/heads/main";
const PROTECTED_TAG_PATTERN = /^refs\/tags\/(release-publish\/([a-f0-9]{12})-[1-9][0-9]*)$/;
const RELEASE_PARENT_WORKFLOW = ".github/workflows/openclaw-release-publish.yml";
const CLAWHUB_CHILD_WORKFLOW = ".github/workflows/plugin-clawhub-release.yml";
const PARENT_RECEIPT_KIND = "openclaw-clawhub-parent-authorization";
const RECOVERY_RECEIPT_KIND = "openclaw-clawhub-recovery-approval";
const RECOVERY_ENVIRONMENT = "clawhub-plugin-release";
const RECOVERY_APPROVAL_JOB = "approve_plugins_clawhub_release";
const AUTOMATED_ROUTES = new Set(["automated-awaited", "automated-detached"]);

const IDENTITY_KEYS = [
  "candidateRepository",
  "candidateSha",
  "fullRef",
  "parentRepository",
  "parentRunAttempt",
  "parentRunId",
  "parentWorkflow",
  "ref",
  "repository",
  "runAttempt",
  "runId",
  "sha",
  "toolingFullRef",
  "toolingRef",
  "toolingSha",
  "version",
  "workflow",
];

const PARENT_RECEIPT_KEYS = [
  "authorizationRoute",
  "candidateRepository",
  "candidateSha",
  "childFullRef",
  "childHeadSha",
  "childRef",
  "childRepository",
  "childRunAttempt",
  "childRunId",
  "childWorkflow",
  "fullRef",
  "headSha",
  "kind",
  "packages",
  "ref",
  "repository",
  "runAttempt",
  "runId",
  "toolingFullRef",
  "toolingRef",
  "toolingSha",
  "version",
  "workflow",
];

const PACKAGE_TRANSACTION_KEYS = ["inventoryDigest", "name", "version"];
const RECOVERY_RECEIPT_KEYS = [
  "actor",
  "approvalJob",
  "authorizationRoute",
  "environment",
  "kind",
  "parentRunAttempt",
  "parentRunId",
  "repository",
  "runAttempt",
  "runId",
  "version",
  "workflow",
];

type JsonRecord = Record<string, unknown>;

export type OpenClawTrustedToolingIdentity = {
  version: 2;
  repository: string;
  workflow: string;
  runId: string;
  runAttempt: string;
  ref: string;
  fullRef: string;
  sha: string;
  candidateRepository: string;
  candidateSha: string;
  toolingRef: string;
  toolingFullRef: string;
  toolingSha: string;
  parentRepository: string;
  parentWorkflow: string;
  parentRunId: string;
  parentRunAttempt: string;
};

type PackageTransaction = {
  name: string;
  version: string;
  inventoryDigest: string;
};

type ParentAuthorizationReceipt = {
  version: 2;
  kind: string;
  repository: string;
  workflow: string;
  runId: string;
  runAttempt: string;
  ref: string;
  fullRef: string;
  headSha: string;
  childRepository: string;
  childWorkflow: string;
  childRunId: string;
  childRunAttempt: string;
  childRef: string;
  childFullRef: string;
  childHeadSha: string;
  candidateRepository: string;
  candidateSha: string;
  toolingRef: string;
  toolingFullRef: string;
  toolingSha: string;
  authorizationRoute: string;
  packages: PackageTransaction[];
};

type RecoveryApprovalReceipt = {
  version: 1;
  kind: string;
  repository: string;
  workflow: string;
  runId: string;
  runAttempt: string;
  actor: string;
  environment: string;
  approvalJob: string;
  authorizationRoute: string;
  parentRunId: string;
  parentRunAttempt: string;
};

type GitHubRun = {
  id?: unknown;
  run_attempt?: unknown;
  path?: unknown;
  head_branch?: unknown;
  head_sha?: unknown;
  event?: unknown;
  status?: unknown;
  conclusion?: unknown;
  repository?: { full_name?: unknown };
  actor?: { login?: unknown; type?: unknown };
};

type GitHubArtifact = {
  id?: unknown;
  name?: unknown;
  expired?: unknown;
  digest?: unknown;
  archive_download_url?: unknown;
  workflow_run?: { id?: unknown; head_sha?: unknown };
};

type VerifyOptions = {
  rawIdentity: string;
  packageName: string;
  version: string;
  inventoryDigest: string;
  oidc: VerifiedGitHubActionsIdentity;
  requiredParentState?: "submission" | "terminal";
  fetchImpl?: typeof fetch;
};

export type VerifiedOpenClawPublishAuthorization = {
  identity: OpenClawTrustedToolingIdentity;
  authorizationRoute: string;
  artifactId: string;
  artifactDigest: string;
  transactionKey: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function requireRecord(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be a JSON object`);
  }
  return value as JsonRecord;
}

function requireExactKeys(value: JsonRecord, keys: string[], name: string) {
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail(`${name} must contain exactly: ${keys.join(", ")}`);
  }
}

function requireString(value: unknown, name: string, pattern?: RegExp) {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    fail(`${name} is invalid`);
  }
  return value;
}

function stringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function requireMatchingRef(ref: string, fullRef: string, name: string) {
  if (fullRef !== `refs/heads/${ref}` && fullRef !== `refs/tags/${ref}`) {
    fail(`${name} ref does not match its full ref`);
  }
}

function parseJson(raw: string, name: string) {
  if (!raw.trim() || new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) {
    fail(`${name} is missing or too large`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fail(`${name} is malformed`);
  }
}

export function parseOpenClawTrustedToolingIdentity(raw: string): OpenClawTrustedToolingIdentity {
  const value = requireRecord(
    parseJson(raw, "trusted tooling identity"),
    "trusted tooling identity",
  );
  requireExactKeys(value, IDENTITY_KEYS, "trusted tooling identity v2");
  if (value.version !== 2) fail("trusted tooling identity version must be 2");
  const identity: OpenClawTrustedToolingIdentity = {
    version: 2,
    repository: requireString(value.repository, "identity repository", REPOSITORY_PATTERN),
    workflow: requireString(value.workflow, "identity workflow", WORKFLOW_PATTERN),
    runId: requireString(value.runId, "identity runId", POSITIVE_INTEGER_PATTERN),
    runAttempt: requireString(value.runAttempt, "identity runAttempt", POSITIVE_INTEGER_PATTERN),
    ref: requireString(value.ref, "identity ref"),
    fullRef: requireString(value.fullRef, "identity fullRef"),
    sha: requireString(value.sha, "identity sha", SHA_PATTERN),
    candidateRepository: requireString(
      value.candidateRepository,
      "identity candidateRepository",
      REPOSITORY_PATTERN,
    ),
    candidateSha: requireString(value.candidateSha, "identity candidateSha", SHA_PATTERN),
    toolingRef: requireString(value.toolingRef, "identity toolingRef"),
    toolingFullRef: requireString(value.toolingFullRef, "identity toolingFullRef"),
    toolingSha: requireString(value.toolingSha, "identity toolingSha", SHA_PATTERN),
    parentRepository: requireString(
      value.parentRepository,
      "identity parentRepository",
      REPOSITORY_PATTERN,
    ),
    parentWorkflow: requireString(
      value.parentWorkflow,
      "identity parentWorkflow",
      WORKFLOW_PATTERN,
    ),
    parentRunId: requireString(value.parentRunId, "identity parentRunId", POSITIVE_INTEGER_PATTERN),
    parentRunAttempt: requireString(
      value.parentRunAttempt,
      "identity parentRunAttempt",
      POSITIVE_INTEGER_PATTERN,
    ),
  };
  requireMatchingRef(identity.ref, identity.fullRef, "identity child");
  requireMatchingRef(identity.toolingRef, identity.toolingFullRef, "identity tooling");
  if (
    identity.repository !== "openclaw/openclaw" ||
    identity.parentRepository !== identity.repository ||
    identity.candidateRepository !== identity.repository
  ) {
    fail("trusted tooling identity repositories must be openclaw/openclaw");
  }
  if (identity.workflow !== CLAWHUB_CHILD_WORKFLOW) {
    fail("trusted tooling identity child workflow is invalid");
  }
  if (identity.parentWorkflow !== RELEASE_PARENT_WORKFLOW) {
    fail("trusted tooling identity parent workflow is invalid");
  }
  return identity;
}

function parsePackageTransactions(value: unknown): PackageTransaction[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) {
    fail("release parent authorization packages are invalid");
  }
  return value.map((entry, index) => {
    const transaction = requireRecord(entry, `package transaction ${index}`);
    requireExactKeys(transaction, PACKAGE_TRANSACTION_KEYS, `package transaction ${index}`);
    return {
      name: requireString(transaction.name, `package transaction ${index} name`),
      version: requireString(transaction.version, `package transaction ${index} version`),
      inventoryDigest: requireString(
        transaction.inventoryDigest,
        `package transaction ${index} inventoryDigest`,
        DIGEST_PATTERN,
      ),
    };
  });
}

function parseParentReceipt(raw: string): ParentAuthorizationReceipt {
  const value = requireRecord(
    parseJson(raw, "release parent authorization receipt"),
    "release parent authorization receipt",
  );
  requireExactKeys(value, PARENT_RECEIPT_KEYS, "release parent authorization receipt v2");
  if (value.version !== 2) fail("release parent authorization receipt version must be 2");
  const receipt: ParentAuthorizationReceipt = {
    version: 2,
    kind: requireString(value.kind, "parent receipt kind"),
    repository: requireString(value.repository, "parent receipt repository", REPOSITORY_PATTERN),
    workflow: requireString(value.workflow, "parent receipt workflow", WORKFLOW_PATTERN),
    runId: requireString(value.runId, "parent receipt runId", POSITIVE_INTEGER_PATTERN),
    runAttempt: requireString(
      value.runAttempt,
      "parent receipt runAttempt",
      POSITIVE_INTEGER_PATTERN,
    ),
    ref: requireString(value.ref, "parent receipt ref"),
    fullRef: requireString(value.fullRef, "parent receipt fullRef"),
    headSha: requireString(value.headSha, "parent receipt headSha", SHA_PATTERN),
    childRepository: requireString(
      value.childRepository,
      "parent receipt childRepository",
      REPOSITORY_PATTERN,
    ),
    childWorkflow: requireString(
      value.childWorkflow,
      "parent receipt childWorkflow",
      WORKFLOW_PATTERN,
    ),
    childRunId: requireString(
      value.childRunId,
      "parent receipt childRunId",
      POSITIVE_INTEGER_PATTERN,
    ),
    childRunAttempt: requireString(
      value.childRunAttempt,
      "parent receipt childRunAttempt",
      POSITIVE_INTEGER_PATTERN,
    ),
    childRef: requireString(value.childRef, "parent receipt childRef"),
    childFullRef: requireString(value.childFullRef, "parent receipt childFullRef"),
    childHeadSha: requireString(value.childHeadSha, "parent receipt childHeadSha", SHA_PATTERN),
    candidateRepository: requireString(
      value.candidateRepository,
      "parent receipt candidateRepository",
      REPOSITORY_PATTERN,
    ),
    candidateSha: requireString(value.candidateSha, "parent receipt candidateSha", SHA_PATTERN),
    toolingRef: requireString(value.toolingRef, "parent receipt toolingRef"),
    toolingFullRef: requireString(value.toolingFullRef, "parent receipt toolingFullRef"),
    toolingSha: requireString(value.toolingSha, "parent receipt toolingSha", SHA_PATTERN),
    authorizationRoute: requireString(
      value.authorizationRoute,
      "parent receipt authorizationRoute",
    ),
    packages: parsePackageTransactions(value.packages),
  };
  requireMatchingRef(receipt.ref, receipt.fullRef, "parent receipt");
  requireMatchingRef(receipt.childRef, receipt.childFullRef, "parent receipt child");
  requireMatchingRef(receipt.toolingRef, receipt.toolingFullRef, "parent receipt tooling");
  if (receipt.kind !== PARENT_RECEIPT_KIND)
    fail("release parent authorization receipt kind is invalid");
  if (!AUTOMATED_ROUTES.has(receipt.authorizationRoute)) {
    fail("release parent authorization receipt route is unknown");
  }
  return receipt;
}

function parseRecoveryReceipt(raw: string): RecoveryApprovalReceipt {
  const value = requireRecord(
    parseJson(raw, "recovery environment approval receipt"),
    "recovery environment approval receipt",
  );
  requireExactKeys(value, RECOVERY_RECEIPT_KEYS, "recovery environment approval receipt v1");
  if (value.version !== 1) fail("recovery environment approval receipt version must be 1");
  return {
    version: 1,
    kind: requireString(value.kind, "recovery receipt kind"),
    repository: requireString(value.repository, "recovery receipt repository", REPOSITORY_PATTERN),
    workflow: requireString(value.workflow, "recovery receipt workflow", WORKFLOW_PATTERN),
    runId: requireString(value.runId, "recovery receipt runId", POSITIVE_INTEGER_PATTERN),
    runAttempt: requireString(
      value.runAttempt,
      "recovery receipt runAttempt",
      POSITIVE_INTEGER_PATTERN,
    ),
    actor: requireString(value.actor, "recovery receipt actor"),
    environment: requireString(value.environment, "recovery receipt environment"),
    approvalJob: requireString(value.approvalJob, "recovery receipt approvalJob"),
    authorizationRoute: requireString(
      value.authorizationRoute,
      "recovery receipt authorizationRoute",
    ),
    parentRunId: requireString(
      value.parentRunId,
      "recovery receipt parentRunId",
      POSITIVE_INTEGER_PATTERN,
    ),
    parentRunAttempt: requireString(
      value.parentRunAttempt,
      "recovery receipt parentRunAttempt",
      POSITIVE_INTEGER_PATTERN,
    ),
  };
}

export function parentAuthorizationArtifactName(identity: OpenClawTrustedToolingIdentity) {
  return `${PARENT_RECEIPT_KIND}-v2-${identity.parentRunId}-${identity.parentRunAttempt}-${identity.runId}-${identity.runAttempt}`;
}

function recoveryArtifactName(identity: OpenClawTrustedToolingIdentity) {
  return `${RECOVERY_RECEIPT_KIND}-${identity.runId}-${identity.runAttempt}`;
}

function assertIdentityMatchesOidc(
  identity: OpenClawTrustedToolingIdentity,
  oidc: VerifiedGitHubActionsIdentity,
) {
  const checks: Array<[string, string | undefined, string]> = [
    ["repository", oidc.repository, identity.repository],
    ["run id", oidc.runId, identity.runId],
    ["run attempt", oidc.runAttempt, identity.runAttempt],
    ["workflow", oidc.workflowFilename, identity.workflow.split("/").at(-1) ?? ""],
    ["child SHA", oidc.sha, identity.sha],
    ["child ref", oidc.ref, identity.fullRef],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) fail(`GitHub OIDC ${name} does not match trusted tooling identity`);
  }
}

function isBotActor(run: GitHubRun) {
  const login = stringOrNumber(run.actor?.login);
  const type = stringOrNumber(run.actor?.type).toLowerCase();
  return type === "bot" || type === "app" || login.toLowerCase().endsWith("[bot]");
}

function validateRun(
  run: GitHubRun,
  expected: {
    repository: string;
    workflow: string;
    runId: string;
    runAttempt: string;
    headBranch: string;
    headSha: string;
  },
  name: string,
) {
  const workflowPath = stringOrNumber(run.path).split("@", 1)[0];
  const checks: Array<[string, string, string]> = [
    ["repository", stringOrNumber(run.repository?.full_name), expected.repository],
    ["run id", stringOrNumber(run.id), expected.runId],
    ["run attempt", stringOrNumber(run.run_attempt), expected.runAttempt],
    ["workflow", workflowPath, expected.workflow],
    ["head branch", stringOrNumber(run.head_branch), expected.headBranch],
    ["head SHA", stringOrNumber(run.head_sha), expected.headSha],
    ["event", stringOrNumber(run.event), "workflow_dispatch"],
  ];
  for (const [field, actual, wanted] of checks) {
    if (actual !== wanted) fail(`${name} ${field} mismatch`);
  }
}

function validateReceipt(
  identity: OpenClawTrustedToolingIdentity,
  receipt: ParentAuthorizationReceipt,
  transaction: PackageTransaction,
) {
  const checks: Array<[string, string, string]> = [
    ["repository", receipt.repository, identity.parentRepository],
    ["workflow", receipt.workflow, identity.parentWorkflow],
    ["run id", receipt.runId, identity.parentRunId],
    ["run attempt", receipt.runAttempt, identity.parentRunAttempt],
    ["tooling ref", receipt.ref, identity.toolingRef],
    ["tooling full ref", receipt.fullRef, identity.toolingFullRef],
    ["tooling head SHA", receipt.headSha, identity.toolingSha],
    ["child repository", receipt.childRepository, identity.repository],
    ["child workflow", receipt.childWorkflow, identity.workflow],
    ["child run id", receipt.childRunId, identity.runId],
    ["child run attempt", receipt.childRunAttempt, identity.runAttempt],
    ["child ref", receipt.childRef, identity.ref],
    ["child full ref", receipt.childFullRef, identity.fullRef],
    ["child head SHA", receipt.childHeadSha, identity.sha],
    ["candidate repository", receipt.candidateRepository, identity.candidateRepository],
    ["candidate SHA", receipt.candidateSha, identity.candidateSha],
    ["receipt tooling ref", receipt.toolingRef, identity.toolingRef],
    ["receipt tooling full ref", receipt.toolingFullRef, identity.toolingFullRef],
    ["receipt tooling SHA", receipt.toolingSha, identity.toolingSha],
  ];
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) fail(`release parent authorization receipt ${field} mismatch`);
  }
  const matches = receipt.packages.filter(
    (entry) =>
      entry.name === transaction.name &&
      entry.version === transaction.version &&
      entry.inventoryDigest === transaction.inventoryDigest,
  );
  if (matches.length !== 1) {
    fail("release parent authorization receipt does not contain one exact package transaction");
  }
}

function validateParentState(
  route: string,
  run: GitHubRun,
  requiredParentState: "submission" | "terminal",
) {
  const status = stringOrNumber(run.status);
  const conclusion = stringOrNumber(run.conclusion);
  const active = status === "in_progress" && !conclusion;
  const successful = status === "completed" && conclusion === "success";
  const failed = status === "completed" && conclusion === "failure";
  if (requiredParentState === "terminal") {
    if (status !== "completed") {
      fail("OpenClaw release parent is not terminal; public publication remains pending");
    }
    if (!successful && !(route === "explicit-recovery" && failed)) {
      fail(
        `OpenClaw release parent terminal state ${status}/${conclusion || "none"} is not authorized by ${route}`,
      );
    }
    return;
  }
  if (
    !active &&
    !(route === "automated-detached" && successful) &&
    !(route === "explicit-recovery" && (successful || failed))
  ) {
    fail(`release parent state ${status}/${conclusion || "none"} is not authorized by ${route}`);
  }
}

function validateRecoveryReceipt(
  identity: OpenClawTrustedToolingIdentity,
  receipt: RecoveryApprovalReceipt,
  childRun: GitHubRun,
) {
  if (isBotActor(childRun)) fail("bot and GitHub App actors cannot use release recovery");
  const actor = stringOrNumber(childRun.actor?.login);
  const checks: Array<[string, string, string]> = [
    ["kind", receipt.kind, RECOVERY_RECEIPT_KIND],
    ["repository", receipt.repository, identity.repository],
    ["workflow", receipt.workflow, identity.workflow],
    ["run id", receipt.runId, identity.runId],
    ["run attempt", receipt.runAttempt, identity.runAttempt],
    ["actor", receipt.actor, actor],
    ["environment", receipt.environment, RECOVERY_ENVIRONMENT],
    ["approval job", receipt.approvalJob, RECOVERY_APPROVAL_JOB],
    ["route", receipt.authorizationRoute, "explicit-recovery"],
    ["parent run id", receipt.parentRunId, identity.parentRunId],
    ["parent run attempt", receipt.parentRunAttempt, identity.parentRunAttempt],
  ];
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) fail(`recovery environment approval receipt ${field} mismatch`);
  }
}

async function githubRequest(pathOrUrl: string, fetchImpl: typeof fetch, accept?: string) {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `https://api.github.com/${pathOrUrl.replace(/^\/+/, "")}`;
  const response = await fetchImpl(url, {
    headers: await buildGitHubApiHeaders({
      userAgent: "clawhub/openclaw-publish-authorization",
      ...(accept ? { accept } : {}),
      fetchImpl,
      allowAnonymous: false,
    }),
    redirect: "follow",
  });
  if (!response.ok) fail(`GitHub authorization lookup failed with HTTP ${response.status}`);
  return response;
}

async function fetchJson<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  return (await (await githubRequest(path, fetchImpl)).json()) as T;
}

async function fetchArtifactReceipt(options: {
  repository: string;
  runId: string;
  headSha: string;
  name: string;
  filename: string;
  fetchImpl: typeof fetch;
}) {
  const response = await fetchJson<{ total_count?: unknown; artifacts?: GitHubArtifact[] }>(
    `repos/${options.repository}/actions/runs/${options.runId}/artifacts?name=${encodeURIComponent(options.name)}`,
    options.fetchImpl,
  );
  if (
    response.total_count !== 1 ||
    !Array.isArray(response.artifacts) ||
    response.artifacts.length !== 1
  ) {
    fail(`authorization artifact ${options.name} is missing or ambiguous`);
  }
  const artifact = response.artifacts[0];
  const digest = requireString(artifact.digest, "authorization artifact digest");
  const digestMatch = ARTIFACT_DIGEST_PATTERN.exec(digest);
  const downloadUrl = requireString(
    artifact.archive_download_url,
    "authorization artifact download URL",
  );
  if (
    artifact.name !== options.name ||
    artifact.expired !== false ||
    stringOrNumber(artifact.workflow_run?.id) !== options.runId ||
    artifact.workflow_run?.head_sha !== options.headSha ||
    !digestMatch
  ) {
    fail(`authorization artifact ${options.name} identity is invalid`);
  }
  const archive = new Uint8Array(
    await (
      await githubRequest(downloadUrl, options.fetchImpl, "application/vnd.github+json")
    ).arrayBuffer(),
  );
  const archiveDigest = await crypto.subtle.digest("SHA-256", archive);
  const archiveDigestHex = [...new Uint8Array(archiveDigest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (archiveDigestHex !== digestMatch[1]) {
    fail(`authorization artifact ${options.name} digest mismatch`);
  }
  const entries = unzipSync(archive);
  const receiptBytes = entries[options.filename];
  if (!receiptBytes || Object.keys(entries).length !== 1) {
    fail(`authorization artifact ${options.name} contents are invalid`);
  }
  return {
    artifactId: requireString(stringOrNumber(artifact.id), "authorization artifact id"),
    artifactDigest: digest,
    rawReceipt: strFromU8(receiptBytes),
  };
}

async function validateToolingRef(
  identity: OpenClawTrustedToolingIdentity,
  fetchImpl: typeof fetch,
) {
  if (identity.toolingFullRef === MAIN_FULL_REF) {
    if (identity.toolingRef !== "main") fail("trusted main tooling ref must be main");
    const comparison = await fetchJson<{
      status?: unknown;
      merge_base_commit?: { sha?: unknown };
    }>(`repos/${identity.repository}/compare/${identity.toolingSha}...main`, fetchImpl);
    if (
      !["ahead", "identical"].includes(stringOrNumber(comparison.status)) ||
      comparison.merge_base_commit?.sha !== identity.toolingSha
    ) {
      fail("trusted tooling SHA is no longer reachable from main");
    }
    return;
  }
  const match = PROTECTED_TAG_PATTERN.exec(identity.toolingFullRef);
  if (!match || identity.toolingRef !== match[1] || identity.toolingSha.slice(0, 12) !== match[2]) {
    fail("trusted tooling ref is not an exact protected release-publish tag");
  }
  const tag = await fetchJson<{ ref?: unknown; object?: { type?: unknown; sha?: unknown } }>(
    `repos/${identity.repository}/git/ref/tags/${encodeURIComponent(identity.toolingRef)}`,
    fetchImpl,
  );
  if (
    tag.ref !== identity.toolingFullRef ||
    tag.object?.type !== "commit" ||
    tag.object.sha !== identity.toolingSha
  ) {
    fail("trusted release-publish tag moved after authorization");
  }
}

export async function verifyOpenClawPublishAuthorization(
  options: VerifyOptions,
): Promise<VerifiedOpenClawPublishAuthorization> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const identity = parseOpenClawTrustedToolingIdentity(options.rawIdentity);
  const transaction = {
    name: requireString(options.packageName, "package name"),
    version: requireString(options.version, "package version"),
    inventoryDigest: requireString(
      options.inventoryDigest,
      "package inventory digest",
      DIGEST_PATTERN,
    ),
  };
  assertIdentityMatchesOidc(identity, options.oidc);

  const childRun = await fetchJson<GitHubRun>(
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
    fetchImpl,
  );
  validateRun(
    childRun,
    {
      repository: identity.repository,
      workflow: identity.workflow,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      headBranch: identity.ref,
      headSha: identity.sha,
    },
    "trusted child run",
  );

  const parentArtifact = await fetchArtifactReceipt({
    repository: identity.parentRepository,
    runId: identity.parentRunId,
    headSha: identity.toolingSha,
    name: parentAuthorizationArtifactName(identity),
    filename: "authorization.json",
    fetchImpl,
  });
  const parentReceipt = parseParentReceipt(parentArtifact.rawReceipt);
  validateReceipt(identity, parentReceipt, transaction);

  const parentRun = await fetchJson<GitHubRun>(
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/attempts/${identity.parentRunAttempt}`,
    fetchImpl,
  );
  validateRun(
    parentRun,
    {
      repository: identity.parentRepository,
      workflow: identity.parentWorkflow,
      runId: identity.parentRunId,
      runAttempt: identity.parentRunAttempt,
      headBranch: identity.toolingRef,
      headSha: identity.toolingSha,
    },
    "trusted parent run",
  );

  let authorizationRoute = parentReceipt.authorizationRoute;
  if (
    stringOrNumber(parentRun.status) === "completed" &&
    stringOrNumber(parentRun.conclusion) === "failure"
  ) {
    const recoveryArtifact = await fetchArtifactReceipt({
      repository: identity.repository,
      runId: identity.runId,
      headSha: identity.sha,
      name: recoveryArtifactName(identity),
      filename: "approval.json",
      fetchImpl,
    });
    validateRecoveryReceipt(identity, parseRecoveryReceipt(recoveryArtifact.rawReceipt), childRun);
    authorizationRoute = "explicit-recovery";
  }
  validateParentState(authorizationRoute, parentRun, options.requiredParentState ?? "submission");
  await validateToolingRef(identity, fetchImpl);

  return {
    identity,
    authorizationRoute,
    artifactId: parentArtifact.artifactId,
    artifactDigest: parentArtifact.artifactDigest,
    transactionKey: [
      identity.parentRepository,
      identity.parentRunId,
      identity.parentRunAttempt,
      identity.runId,
      identity.runAttempt,
      identity.candidateSha,
      transaction.name,
      transaction.version,
      transaction.inventoryDigest,
    ].join(":"),
  };
}
