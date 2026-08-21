const { lstatSync, readFileSync } = require("node:fs");

const MAX_JSON_BYTES = 8 * 1024;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const WORKFLOW_PATTERN = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const FULL_REF_PATTERN = /^refs\/(?:heads|tags)\/(.+)$/;
const PROTECTED_TAG_PATTERN = /^refs\/tags\/(release-publish\/([a-f0-9]{12})-[1-9][0-9]*)$/;
const MAIN_FULL_REF = "refs/heads/main";
const RELEASE_PARENT_WORKFLOW = ".github/workflows/openclaw-release-publish.yml";
const CLAWHUB_CHILD_WORKFLOW = ".github/workflows/plugin-clawhub-release.yml";
const RECOVERY_ENVIRONMENT = "clawhub-plugin-release";
const RECOVERY_APPROVAL_JOB = "approve_plugins_clawhub_release";
const PARENT_RECEIPT_KIND = "openclaw-clawhub-parent-authorization";
const RECOVERY_RECEIPT_KIND = "openclaw-clawhub-recovery-approval";
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

function fail(message) {
  throw new Error(message);
}

function requireString(value, name, pattern) {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    fail(`trusted tooling identity ${name} is invalid`);
  }
  return value;
}

function requireMatchingRef(ref, fullRef, name) {
  const match = FULL_REF_PATTERN.exec(fullRef);
  if (!match || match[1] !== ref) {
    fail(`trusted tooling identity ${name} ref does not match its full ref`);
  }
}

function parseExactJson(raw, { name, keys, version }) {
  if (typeof raw !== "string" || !raw.trim()) {
    fail(`${name} JSON is required`);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) {
    fail(`${name} JSON exceeds the 8 KiB limit`);
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(`${name} JSON is malformed`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be a JSON object`);
  }

  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index])) {
    fail(`${name} v${version} must contain exactly: ${keys.join(", ")}`);
  }
  if (value.version !== version) {
    fail(`${name} version must be ${version}`);
  }
  return value;
}

function parseTrustedToolingIdentity(raw) {
  const value = parseExactJson(raw, {
    name: "trusted tooling identity",
    keys: IDENTITY_KEYS,
    version: 2,
  });
  const identity = {
    version: 2,
    repository: requireString(value.repository, "repository", REPOSITORY_PATTERN),
    workflow: requireString(value.workflow, "workflow", WORKFLOW_PATTERN),
    runId: requireString(value.runId, "runId", POSITIVE_INTEGER_PATTERN),
    runAttempt: requireString(value.runAttempt, "runAttempt", POSITIVE_INTEGER_PATTERN),
    ref: requireString(value.ref, "ref"),
    fullRef: requireString(value.fullRef, "fullRef"),
    sha: requireString(value.sha, "sha", SHA_PATTERN),
    candidateRepository: requireString(
      value.candidateRepository,
      "candidateRepository",
      REPOSITORY_PATTERN,
    ),
    candidateSha: requireString(value.candidateSha, "candidateSha", SHA_PATTERN),
    toolingRef: requireString(value.toolingRef, "toolingRef"),
    toolingFullRef: requireString(value.toolingFullRef, "toolingFullRef"),
    toolingSha: requireString(value.toolingSha, "toolingSha", SHA_PATTERN),
    parentRepository: requireString(value.parentRepository, "parentRepository", REPOSITORY_PATTERN),
    parentWorkflow: requireString(value.parentWorkflow, "parentWorkflow", WORKFLOW_PATTERN),
    parentRunId: requireString(value.parentRunId, "parentRunId", POSITIVE_INTEGER_PATTERN),
    parentRunAttempt: requireString(
      value.parentRunAttempt,
      "parentRunAttempt",
      POSITIVE_INTEGER_PATTERN,
    ),
  };
  requireMatchingRef(identity.ref, identity.fullRef, "caller");

  if (identity.workflow !== CLAWHUB_CHILD_WORKFLOW) {
    fail("trusted tooling identity workflow is not the OpenClaw ClawHub publisher");
  }
  if (identity.parentWorkflow !== RELEASE_PARENT_WORKFLOW) {
    fail("trusted tooling identity parentWorkflow is not the OpenClaw release publisher");
  }
  if (identity.parentRepository !== identity.repository) {
    fail("trusted tooling identity parent repository does not match its caller repository");
  }
  if (identity.candidateRepository !== identity.repository) {
    fail("trusted tooling identity candidate repository does not match its caller repository");
  }

  if (identity.toolingFullRef === MAIN_FULL_REF) {
    if (identity.toolingRef !== "main") {
      fail("trusted main tooling ref must be main");
    }
    return { ...identity, toolingRoute: "main" };
  }

  const protectedTag = PROTECTED_TAG_PATTERN.exec(identity.toolingFullRef);
  if (!protectedTag || identity.toolingRef !== protectedTag[1]) {
    fail("trusted release-publish tooling must use an exact protected tag ref");
  }
  if (identity.toolingSha.slice(0, 12) !== protectedTag[2]) {
    fail("trusted release-publish tag prefix does not match its tooling SHA");
  }
  return { ...identity, toolingRoute: "protected-tag" };
}

function parseParentAuthorizationReceipt(raw) {
  const value = parseExactJson(raw, {
    name: "release parent authorization receipt",
    keys: PARENT_RECEIPT_KEYS,
    version: 2,
  });
  const receipt = {
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
    childWorkflow: requireString(
      value.childWorkflow,
      "parent receipt childWorkflow",
      WORKFLOW_PATTERN,
    ),
    childRepository: requireString(
      value.childRepository,
      "parent receipt childRepository",
      REPOSITORY_PATTERN,
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
    packages: parsePackageTransactions(value.packages),
    authorizationRoute: requireString(
      value.authorizationRoute,
      "parent receipt authorizationRoute",
    ),
  };
  requireMatchingRef(receipt.ref, receipt.fullRef, "parent receipt");
  requireMatchingRef(receipt.childRef, receipt.childFullRef, "parent receipt child");
  requireMatchingRef(receipt.toolingRef, receipt.toolingFullRef, "parent receipt tooling");
  if (receipt.kind !== PARENT_RECEIPT_KIND) {
    fail("release parent authorization receipt kind is invalid");
  }
  if (!AUTOMATED_ROUTES.has(receipt.authorizationRoute)) {
    fail("release parent authorization receipt route is unknown");
  }
  return receipt;
}

function parsePackageTransactions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) {
    fail("release parent authorization receipt packages are invalid");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`release parent authorization receipt package ${index} is invalid`);
    }
    const actualKeys = Object.keys(entry).sort();
    if (
      actualKeys.length !== PACKAGE_TRANSACTION_KEYS.length ||
      actualKeys.some((key, keyIndex) => key !== PACKAGE_TRANSACTION_KEYS[keyIndex])
    ) {
      fail(`release parent authorization receipt package ${index} keys are invalid`);
    }
    return {
      name: requireString(entry.name, `parent receipt package ${index} name`),
      version: requireString(entry.version, `parent receipt package ${index} version`),
      inventoryDigest: requireString(
        entry.inventoryDigest,
        `parent receipt package ${index} inventoryDigest`,
        /^[a-f0-9]{64}$/,
      ),
    };
  });
}

function parseRecoveryApprovalReceipt(raw) {
  const value = parseExactJson(raw, {
    name: "recovery environment approval receipt",
    keys: RECOVERY_RECEIPT_KEYS,
    version: 1,
  });
  const receipt = {
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
  if (receipt.kind !== RECOVERY_RECEIPT_KIND) {
    fail("recovery environment approval receipt kind is invalid");
  }
  if (receipt.authorizationRoute !== "explicit-recovery") {
    fail("recovery environment approval receipt route is invalid");
  }
  return receipt;
}

function requireContextValue(env, name) {
  return requireString(env[name], name);
}

function validateInvocationContext(identity, env) {
  const expectedWorkflowRef = `${identity.repository}/${identity.workflow}@${identity.fullRef}`;
  const checks = [
    ["GITHUB_REPOSITORY", identity.repository],
    ["GITHUB_RUN_ID", identity.runId],
    ["GITHUB_RUN_ATTEMPT", identity.runAttempt],
    ["GITHUB_WORKFLOW_REF", expectedWorkflowRef],
    ["GITHUB_WORKFLOW_SHA", identity.sha],
    ["GITHUB_REF", identity.fullRef],
    ["GITHUB_REF_NAME", identity.ref],
    ["GITHUB_SHA", identity.sha],
    ["GITHUB_EVENT_NAME", "workflow_dispatch"],
  ];
  for (const [name, expected] of checks) {
    if (requireContextValue(env, name) !== expected) {
      fail(`trusted tooling identity does not match ${name}`);
    }
  }
  return requireContextValue(env, "GITHUB_ACTOR");
}

function normalizeQualifiedWorkflowRef(value, ref, fullRef) {
  if (!value) return "";
  if (value.startsWith("refs/")) return value;
  if (value === ref && fullRef === MAIN_FULL_REF) return MAIN_FULL_REF;
  fail("trusted tooling workflow path uses an ambiguous ref qualifier");
}

function validateWorkflowRun(identity, run, actor) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    fail("trusted tooling workflow run response is invalid");
  }

  const [workflowPath, qualifiedRef = ""] = String(run.path ?? "").split("@", 2);
  const checks = [
    ["repository", run.repository?.full_name, identity.repository],
    ["run id", String(run.id ?? ""), identity.runId],
    ["run attempt", String(run.run_attempt ?? ""), identity.runAttempt],
    ["workflow path", workflowPath, identity.workflow],
    ["head branch", String(run.head_branch ?? ""), identity.ref],
    ["head SHA", String(run.head_sha ?? ""), identity.sha],
    ["event", String(run.event ?? ""), "workflow_dispatch"],
    ["actor", String(run.actor?.login ?? ""), actor],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) {
      fail(`trusted tooling workflow ${name} mismatch`);
    }
  }

  const normalizedQualifiedRef = normalizeQualifiedWorkflowRef(
    qualifiedRef,
    identity.ref,
    identity.fullRef,
  );
  if (normalizedQualifiedRef && normalizedQualifiedRef !== identity.fullRef) {
    fail("trusted tooling workflow path ref mismatch");
  }
}

function parentArtifactName(identity) {
  return `${PARENT_RECEIPT_KIND}-v2-${identity.parentRunId}-${identity.parentRunAttempt}-${identity.runId}-${identity.runAttempt}`;
}

function recoveryArtifactName(identity) {
  return `${RECOVERY_RECEIPT_KIND}-${identity.runId}-${identity.runAttempt}`;
}

function validateArtifactResponse(response, { headSha, name, runId }) {
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    response.total_count !== 1 ||
    !Array.isArray(response.artifacts) ||
    response.artifacts.length !== 1
  ) {
    fail(`trusted authorization artifact ${name} is missing or ambiguous`);
  }
  const artifact = response.artifacts[0];
  if (
    artifact?.name !== name ||
    artifact?.expired !== false ||
    String(artifact?.workflow_run?.id ?? "") !== runId ||
    artifact?.workflow_run?.head_sha !== headSha ||
    !ARTIFACT_DIGEST_PATTERN.test(String(artifact?.digest ?? ""))
  ) {
    fail(`trusted authorization artifact ${name} identity is invalid`);
  }
}

function validateParentAuthorizationReceipt(identity, receipt) {
  const checks = [
    ["repository", receipt.repository, identity.parentRepository],
    ["workflow", receipt.workflow, identity.parentWorkflow],
    ["run id", receipt.runId, identity.parentRunId],
    ["run attempt", receipt.runAttempt, identity.parentRunAttempt],
    ["ref", receipt.ref, identity.toolingRef],
    ["full ref", receipt.fullRef, identity.toolingFullRef],
    ["head SHA", receipt.headSha, identity.toolingSha],
    ["child repository", receipt.childRepository, identity.repository],
    ["child workflow", receipt.childWorkflow, identity.workflow],
    ["child run id", receipt.childRunId, identity.runId],
    ["child run attempt", receipt.childRunAttempt, identity.runAttempt],
    ["child ref", receipt.childRef, identity.ref],
    ["child full ref", receipt.childFullRef, identity.fullRef],
    ["child head SHA", receipt.childHeadSha, identity.sha],
    ["candidate repository", receipt.candidateRepository, identity.candidateRepository],
    ["candidate SHA", receipt.candidateSha, identity.candidateSha],
    ["tooling ref", receipt.toolingRef, identity.toolingRef],
    ["tooling full ref", receipt.toolingFullRef, identity.toolingFullRef],
    ["tooling SHA", receipt.toolingSha, identity.toolingSha],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) {
      fail(`release parent authorization receipt ${name} mismatch`);
    }
  }
}

function isBotActor(run) {
  const login = String(run.actor?.login ?? "");
  const type = String(run.actor?.type ?? "").toLowerCase();
  return type === "bot" || type === "app" || login.toLowerCase().endsWith("[bot]");
}

function validateRecoveryApprovalReceipt(identity, receipt, actor) {
  const checks = [
    ["repository", receipt.repository, identity.repository],
    ["workflow", receipt.workflow, identity.workflow],
    ["run id", receipt.runId, identity.runId],
    ["run attempt", receipt.runAttempt, identity.runAttempt],
    ["actor", receipt.actor, actor],
    ["environment", receipt.environment, RECOVERY_ENVIRONMENT],
    ["approval job", receipt.approvalJob, RECOVERY_APPROVAL_JOB],
    ["authorization route", receipt.authorizationRoute, "explicit-recovery"],
    ["parent run id", receipt.parentRunId, identity.parentRunId],
    ["parent run attempt", receipt.parentRunAttempt, identity.parentRunAttempt],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) {
      fail(`recovery environment approval receipt ${name} mismatch`);
    }
  }
}

function deriveAuthorizationRoute(identity, run, parentReceipt, recoveryReceipt) {
  if (!recoveryReceipt) {
    return parentReceipt.authorizationRoute;
  }
  const actor = String(run.actor?.login ?? "");
  if (isBotActor(run)) {
    fail("automated ClawHub publication cannot select the recovery route");
  }
  validateRecoveryApprovalReceipt(identity, recoveryReceipt, actor);
  return "explicit-recovery";
}

function validateReleaseParentState(route, run) {
  const status = String(run.status ?? "");
  const conclusion = String(run.conclusion ?? "");
  const active = status === "in_progress" && conclusion === "";
  const successful = status === "completed" && conclusion === "success";
  const failed = status === "completed" && conclusion === "failure";
  const allowed =
    active ||
    (route === "automated-detached" && successful) ||
    (route === "explicit-recovery" && (successful || failed));

  if (!allowed) {
    fail(
      `trusted release parent state ${status || "<missing>"}/${conclusion || "none"} is not allowed by authorization route ${route}`,
    );
  }
}

function validateReleaseParentRun(identity, receipt, route, run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    fail("trusted release parent workflow run response is invalid");
  }

  const [workflowPath, qualifiedRef = ""] = String(run.path ?? "").split("@", 2);
  const checks = [
    ["repository", run.repository?.full_name, identity.parentRepository],
    ["run id", String(run.id ?? ""), identity.parentRunId],
    ["run attempt", String(run.run_attempt ?? ""), identity.parentRunAttempt],
    ["workflow path", workflowPath, identity.parentWorkflow],
    ["head branch", String(run.head_branch ?? ""), receipt.ref],
    ["head SHA", String(run.head_sha ?? ""), receipt.headSha],
    ["event", String(run.event ?? ""), "workflow_dispatch"],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) {
      fail(`trusted release parent workflow ${name} mismatch`);
    }
  }

  const normalizedQualifiedRef = normalizeQualifiedWorkflowRef(
    qualifiedRef,
    receipt.ref,
    receipt.fullRef,
  );
  if (normalizedQualifiedRef && normalizedQualifiedRef !== receipt.fullRef) {
    fail("trusted release parent workflow path ref mismatch");
  }
  validateReleaseParentState(route, run);
}

function validateProtectedTag(identity, tagRef) {
  if (tagRef?.ref !== identity.toolingFullRef) {
    fail("trusted release-publish tag ref mismatch");
  }
  if (tagRef?.object?.type !== "commit") {
    fail("trusted release-publish ref must be a lightweight tag");
  }
  if (tagRef.object.sha !== identity.toolingSha) {
    fail("trusted release-publish tag moved after approval");
  }
}

function validateMainLineage(identity, comparison) {
  if (
    !["ahead", "identical"].includes(String(comparison?.status ?? "")) ||
    comparison?.merge_base_commit?.sha !== identity.toolingSha
  ) {
    fail("trusted main tooling SHA is no longer reachable from main");
  }
}

function readBoundedReceipt(path, name) {
  const receiptPath = requireString(path, `${name} path`);
  const stat = lstatSync(receiptPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) {
    fail(`${name} file is not a bounded regular file`);
  }
  return readFileSync(receiptPath, "utf8");
}

async function verifyTrustedToolingIdentity({
  rawIdentity,
  rawParentReceipt,
  rawRecoveryReceipt = "",
  env,
  getJson,
}) {
  const identity = parseTrustedToolingIdentity(rawIdentity);
  const actor = validateInvocationContext(identity, env);

  const run = await getJson(
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
  );
  validateWorkflowRun(identity, run, actor);

  const expectedParentArtifact = parentArtifactName(identity);
  const parentArtifacts = await getJson(
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/artifacts?name=${encodeURIComponent(expectedParentArtifact)}`,
  );
  validateArtifactResponse(parentArtifacts, {
    headSha: identity.toolingSha,
    name: expectedParentArtifact,
    runId: identity.parentRunId,
  });
  const parentReceipt = parseParentAuthorizationReceipt(rawParentReceipt);
  validateParentAuthorizationReceipt(identity, parentReceipt);

  let recoveryReceipt;
  if (rawRecoveryReceipt) {
    const expectedRecoveryArtifact = recoveryArtifactName(identity);
    const recoveryArtifacts = await getJson(
      `repos/${identity.repository}/actions/runs/${identity.runId}/artifacts?name=${encodeURIComponent(expectedRecoveryArtifact)}`,
    );
    validateArtifactResponse(recoveryArtifacts, {
      headSha: identity.sha,
      name: expectedRecoveryArtifact,
      runId: identity.runId,
    });
    recoveryReceipt = parseRecoveryApprovalReceipt(rawRecoveryReceipt);
  }
  const authorizationRoute = deriveAuthorizationRoute(
    identity,
    run,
    parentReceipt,
    recoveryReceipt,
  );

  const parentRun = await getJson(
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/attempts/${identity.parentRunAttempt}`,
  );
  validateReleaseParentRun(identity, parentReceipt, authorizationRoute, parentRun);

  if (identity.toolingRoute === "main") {
    const comparison = await getJson(
      `repos/${identity.repository}/compare/${identity.toolingSha}...main`,
    );
    validateMainLineage(identity, comparison);
  } else {
    const tagRef = await getJson(
      `repos/${identity.repository}/git/ref/tags/${encodeURIComponent(identity.toolingRef)}`,
    );
    validateProtectedTag(identity, tagRef);
  }

  return { ...identity, authorizationRoute };
}

async function githubJson(path, token) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "clawhub-package-publish",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    fail(`GitHub API request failed with HTTP ${response.status}: ${path}`);
  }
  return await response.json();
}

async function main() {
  const token = requireString(process.env.GH_TOKEN, "GH_TOKEN");
  const rawRecoveryReceipt = process.env.RECOVERY_APPROVAL_RECEIPT_PATH
    ? readBoundedReceipt(
        process.env.RECOVERY_APPROVAL_RECEIPT_PATH,
        "recovery environment approval receipt",
      )
    : "";
  const identity = await verifyTrustedToolingIdentity({
    rawIdentity: process.env.TRUSTED_TOOLING_IDENTITY_JSON,
    rawParentReceipt: readBoundedReceipt(
      process.env.PARENT_AUTHORIZATION_RECEIPT_PATH,
      "release parent authorization receipt",
    ),
    rawRecoveryReceipt,
    env: process.env,
    getJson: (path) => githubJson(path, token),
  });
  console.log(
    `Verified trusted tooling identity v${identity.version} for ${identity.repository} ${identity.toolingFullRef} via ${identity.authorizationRoute}.`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `Trusted tooling identity verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  deriveAuthorizationRoute,
  parentArtifactName,
  parseParentAuthorizationReceipt,
  parseRecoveryApprovalReceipt,
  parseTrustedToolingIdentity,
  recoveryArtifactName,
  validateArtifactResponse,
  validateInvocationContext,
  validateMainLineage,
  validateParentAuthorizationReceipt,
  validateProtectedTag,
  validateRecoveryApprovalReceipt,
  validateReleaseParentRun,
  validateReleaseParentState,
  validateWorkflowRun,
  verifyTrustedToolingIdentity,
};
