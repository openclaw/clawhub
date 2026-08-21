const MAX_IDENTITY_BYTES = 8 * 1024;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const WORKFLOW_PATTERN = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const FULL_REF_PATTERN = /^refs\/(?:heads|tags)\/(.+)$/;
const PROTECTED_TAG_PATTERN = /^refs\/tags\/(release-publish\/([a-f0-9]{12})-[1-9][0-9]*)$/;
const MAIN_FULL_REF = "refs/heads/main";
const RELEASE_PARENT_WORKFLOW = ".github/workflows/openclaw-release-publish.yml";
const PARENT_STATE_POLICIES = new Set([
  "active",
  "active-or-success",
  "recovery-active-or-success-or-failure",
]);
const REQUIRED_KEYS = [
  "fullRef",
  "parentFullRef",
  "parentRef",
  "parentRepository",
  "parentRunAttempt",
  "parentRunId",
  "parentSha",
  "parentStatePolicy",
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

function parseTrustedToolingIdentity(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    fail("trusted tooling identity JSON is required");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_IDENTITY_BYTES) {
    fail("trusted tooling identity JSON exceeds the 8 KiB limit");
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("trusted tooling identity JSON is malformed");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("trusted tooling identity must be a JSON object");
  }

  const keys = Object.keys(value).sort();
  if (
    keys.length !== REQUIRED_KEYS.length ||
    keys.some((key, index) => key !== REQUIRED_KEYS[index])
  ) {
    fail(`trusted tooling identity v2 must contain exactly: ${REQUIRED_KEYS.join(", ")}`);
  }
  if (value.version !== 2) {
    fail("trusted tooling identity version must be 2");
  }

  const identity = {
    version: 2,
    repository: requireString(value.repository, "repository", REPOSITORY_PATTERN),
    workflow: requireString(value.workflow, "workflow", WORKFLOW_PATTERN),
    runId: requireString(value.runId, "runId", POSITIVE_INTEGER_PATTERN),
    runAttempt: requireString(value.runAttempt, "runAttempt", POSITIVE_INTEGER_PATTERN),
    ref: requireString(value.ref, "ref"),
    fullRef: requireString(value.fullRef, "fullRef"),
    sha: requireString(value.sha, "sha", SHA_PATTERN),
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
    parentRef: requireString(value.parentRef, "parentRef"),
    parentFullRef: requireString(value.parentFullRef, "parentFullRef"),
    parentSha: requireString(value.parentSha, "parentSha", SHA_PATTERN),
    parentStatePolicy: requireString(value.parentStatePolicy, "parentStatePolicy"),
  };
  requireMatchingRef(identity.ref, identity.fullRef, "caller");
  requireMatchingRef(identity.parentRef, identity.parentFullRef, "parent");

  if (!PARENT_STATE_POLICIES.has(identity.parentStatePolicy)) {
    fail("trusted tooling identity parentStatePolicy is unknown");
  }
  if (identity.parentWorkflow !== RELEASE_PARENT_WORKFLOW) {
    fail("trusted tooling identity parentWorkflow is not the OpenClaw release publisher");
  }
  if (
    identity.parentRepository !== identity.repository ||
    identity.parentRef !== identity.toolingRef ||
    identity.parentFullRef !== identity.toolingFullRef ||
    identity.parentSha !== identity.toolingSha
  ) {
    fail("trusted tooling identity parent tuple does not match its tooling tuple");
  }

  if (identity.toolingFullRef === MAIN_FULL_REF) {
    if (identity.toolingRef !== "main") {
      fail("trusted main tooling ref must be main");
    }
    return { ...identity, route: "main" };
  }

  const protectedTag = PROTECTED_TAG_PATTERN.exec(identity.toolingFullRef);
  if (!protectedTag || identity.toolingRef !== protectedTag[1]) {
    fail("trusted release-publish tooling must use an exact protected tag ref");
  }
  if (identity.toolingSha.slice(0, 12) !== protectedTag[2]) {
    fail("trusted release-publish tag prefix does not match its tooling SHA");
  }
  return { ...identity, route: "protected-tag" };
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
}

function normalizeQualifiedWorkflowRef(value, ref, fullRef) {
  if (!value) return "";
  if (value.startsWith("refs/")) return value;
  if (value === ref && fullRef === MAIN_FULL_REF) return MAIN_FULL_REF;
  fail("trusted tooling workflow path uses an ambiguous ref qualifier");
}

function validateWorkflowRun(identity, run) {
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

function validateReleaseParentState(identity, run) {
  const status = String(run.status ?? "");
  const conclusion = String(run.conclusion ?? "");
  const active = status === "in_progress" && conclusion === "";
  const successful = status === "completed" && conclusion === "success";
  const failed = status === "completed" && conclusion === "failure";
  const allowed =
    active ||
    (identity.parentStatePolicy === "active-or-success" && successful) ||
    (identity.parentStatePolicy === "recovery-active-or-success-or-failure" &&
      (successful || failed));

  if (!allowed) {
    fail(
      `trusted release parent state ${status || "<missing>"}/${conclusion || "none"} is not allowed by policy ${identity.parentStatePolicy}`,
    );
  }
}

function validateReleaseParentRun(identity, run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    fail("trusted release parent workflow run response is invalid");
  }

  const [workflowPath, qualifiedRef = ""] = String(run.path ?? "").split("@", 2);
  const checks = [
    ["repository", run.repository?.full_name, identity.parentRepository],
    ["run id", String(run.id ?? ""), identity.parentRunId],
    ["run attempt", String(run.run_attempt ?? ""), identity.parentRunAttempt],
    ["workflow path", workflowPath, identity.parentWorkflow],
    ["head branch", String(run.head_branch ?? ""), identity.parentRef],
    ["head SHA", String(run.head_sha ?? ""), identity.parentSha],
    ["event", String(run.event ?? ""), "workflow_dispatch"],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) {
      fail(`trusted release parent workflow ${name} mismatch`);
    }
  }

  const normalizedQualifiedRef = normalizeQualifiedWorkflowRef(
    qualifiedRef,
    identity.parentRef,
    identity.parentFullRef,
  );
  if (normalizedQualifiedRef && normalizedQualifiedRef !== identity.parentFullRef) {
    fail("trusted release parent workflow path ref mismatch");
  }
  validateReleaseParentState(identity, run);
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

async function verifyTrustedToolingIdentity({ rawIdentity, env, getJson }) {
  const identity = parseTrustedToolingIdentity(rawIdentity);
  validateInvocationContext(identity, env);

  const run = await getJson(
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
  );
  validateWorkflowRun(identity, run);

  const parentRun = await getJson(
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/attempts/${identity.parentRunAttempt}`,
  );
  validateReleaseParentRun(identity, parentRun);

  if (identity.route === "main") {
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

  return identity;
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
  const identity = await verifyTrustedToolingIdentity({
    rawIdentity: process.env.TRUSTED_TOOLING_IDENTITY_JSON,
    env: process.env,
    getJson: (path) => githubJson(path, token),
  });
  console.log(
    `Verified trusted tooling identity v${identity.version} for ${identity.repository} ${identity.toolingFullRef}.`,
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
  parseTrustedToolingIdentity,
  validateInvocationContext,
  validateMainLineage,
  validateProtectedTag,
  validateReleaseParentRun,
  validateReleaseParentState,
  validateWorkflowRun,
  verifyTrustedToolingIdentity,
};
