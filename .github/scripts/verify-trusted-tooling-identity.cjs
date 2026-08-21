const MAX_IDENTITY_BYTES = 8 * 1024;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const WORKFLOW_PATTERN = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const PROTECTED_TAG_PATTERN =
  /^refs\/tags\/(release-publish\/([a-f0-9]{12})-[1-9][0-9]*)$/;
const MAIN_FULL_REF = "refs/heads/main";
const REQUIRED_KEYS = [
  "fullRef",
  "ref",
  "repository",
  "runAttempt",
  "runId",
  "sha",
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
    fail(`trusted tooling identity v1 must contain exactly: ${REQUIRED_KEYS.join(", ")}`);
  }
  if (value.version !== 1) {
    fail("trusted tooling identity version must be 1");
  }

  const identity = {
    version: 1,
    repository: requireString(value.repository, "repository", REPOSITORY_PATTERN),
    workflow: requireString(value.workflow, "workflow", WORKFLOW_PATTERN),
    runId: requireString(value.runId, "runId", POSITIVE_INTEGER_PATTERN),
    runAttempt: requireString(value.runAttempt, "runAttempt", POSITIVE_INTEGER_PATTERN),
    ref: requireString(value.ref, "ref"),
    fullRef: requireString(value.fullRef, "fullRef"),
    sha: requireString(value.sha, "sha", SHA_PATTERN),
  };

  if (identity.fullRef === MAIN_FULL_REF) {
    if (identity.ref !== "main") {
      fail("trusted main identity ref must be main");
    }
    return { ...identity, route: "main" };
  }

  const protectedTag = PROTECTED_TAG_PATTERN.exec(identity.fullRef);
  if (!protectedTag || identity.ref !== protectedTag[1]) {
    fail("trusted release-publish identity must use an exact protected tag ref");
  }
  if (identity.sha.slice(0, 12) !== protectedTag[2]) {
    fail("trusted release-publish tag prefix does not match its workflow SHA");
  }
  return { ...identity, route: "protected-tag" };
}

function requireContextValue(env, name) {
  return requireString(env[name], name);
}

function validateInvocationContext(identity, env) {
  const checks = [
    ["GITHUB_REPOSITORY", identity.repository],
    ["GITHUB_EVENT_NAME", "workflow_dispatch"],
  ];
  for (const [name, expected] of checks) {
    if (requireContextValue(env, name) !== expected) {
      fail(`trusted tooling identity does not match ${name}`);
    }
  }
}

function normalizeQualifiedWorkflowRef(value, route) {
  if (!value) return "";
  if (value.startsWith("refs/")) return value;
  if (route === "main" && value === "main") return MAIN_FULL_REF;
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

  const normalizedQualifiedRef = normalizeQualifiedWorkflowRef(qualifiedRef, identity.route);
  if (normalizedQualifiedRef && normalizedQualifiedRef !== identity.fullRef) {
    fail("trusted tooling workflow path ref mismatch");
  }
}

function validateProtectedTag(identity, tagRef) {
  if (tagRef?.ref !== identity.fullRef) {
    fail("trusted release-publish tag ref mismatch");
  }
  if (tagRef?.object?.type !== "commit") {
    fail("trusted release-publish ref must be a lightweight tag");
  }
  if (tagRef.object.sha !== identity.sha) {
    fail("trusted release-publish tag moved after approval");
  }
}

function validateMainLineage(identity, comparison) {
  if (
    !["ahead", "identical"].includes(String(comparison?.status ?? "")) ||
    comparison?.merge_base_commit?.sha !== identity.sha
  ) {
    fail("trusted main workflow SHA is no longer reachable from main");
  }
}

async function verifyTrustedToolingIdentity({ rawIdentity, env, getJson }) {
  const identity = parseTrustedToolingIdentity(rawIdentity);
  validateInvocationContext(identity, env);

  const run = await getJson(
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
  );
  validateWorkflowRun(identity, run);

  if (identity.route === "main") {
    const comparison = await getJson(
      `repos/${identity.repository}/compare/${identity.sha}...main`,
    );
    validateMainLineage(identity, comparison);
  } else {
    const tagRef = await getJson(
      `repos/${identity.repository}/git/ref/tags/${encodeURIComponent(identity.ref)}`,
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
    `Verified trusted tooling identity v${identity.version} for ${identity.repository} ${identity.fullRef}.`,
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
  validateWorkflowRun,
  verifyTrustedToolingIdentity,
};
