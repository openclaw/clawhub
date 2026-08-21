const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseTrustedToolingIdentity,
  validateWorkflowRun,
  verifyTrustedToolingIdentity,
} = require("./verify-trusted-tooling-identity.cjs");

const sha = "a".repeat(40);
const tagProofRunId = "32410682801";
const runId = "32440000001";
const tag = `release-publish/${sha.slice(0, 12)}-${tagProofRunId}`;
const workflow = ".github/workflows/openclaw-release-publish.yml";

function protectedIdentity(overrides = {}) {
  return {
    version: 1,
    repository: "openclaw/openclaw",
    workflow,
    runId,
    runAttempt: "2",
    ref: tag,
    fullRef: `refs/tags/${tag}`,
    sha,
    ...overrides,
  };
}

function mainIdentity(overrides = {}) {
  return protectedIdentity({
    ref: "main",
    fullRef: "refs/heads/main",
    ...overrides,
  });
}

function callerEnv(identity) {
  return {
    GITHUB_REPOSITORY: identity.repository,
    GITHUB_EVENT_NAME: "workflow_dispatch",
  };
}

function runFixture(identity, overrides = {}) {
  return {
    id: Number(identity.runId),
    run_attempt: Number(identity.runAttempt),
    path: `${identity.workflow}@${identity.fullRef}`,
    head_branch: identity.ref,
    head_sha: identity.sha,
    event: "workflow_dispatch",
    repository: { full_name: identity.repository },
    ...overrides,
  };
}

test("accepts the exact protected tooling run and re-reads the lightweight tag last", async () => {
  const identity = protectedIdentity();
  const calls = [];
  const result = await verifyTrustedToolingIdentity({
    rawIdentity: JSON.stringify(identity),
    env: callerEnv(identity),
    getJson: async (path) => {
      calls.push(path);
      if (path.includes("/actions/runs/")) return runFixture(identity);
      return {
        ref: identity.fullRef,
        object: { type: "commit", sha: identity.sha },
      };
    },
  });

  assert.equal(result.route, "protected-tag");
  assert.deepEqual(calls, [
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
    `repos/${identity.repository}/git/ref/tags/${encodeURIComponent(identity.ref)}`,
  ]);
});

test("preserves the ordinary main route when the workflow SHA remains on main", async () => {
  const identity = mainIdentity();
  const calls = [];
  const result = await verifyTrustedToolingIdentity({
    rawIdentity: JSON.stringify(identity),
    env: callerEnv(identity),
    getJson: async (path) => {
      calls.push(path);
      if (path.includes("/actions/runs/")) {
        return runFixture(identity, { path: `${identity.workflow}@main` });
      }
      return {
        status: "ahead",
        merge_base_commit: { sha: identity.sha },
      };
    },
  });

  assert.equal(result.route, "main");
  assert.equal(calls[1], `repos/${identity.repository}/compare/${identity.sha}...main`);
});

test("requires the exact v1 tuple without hidden compatibility fields", () => {
  assert.throws(
    () => parseTrustedToolingIdentity(JSON.stringify({ ...protectedIdentity(), version: 2 })),
    /version must be 1/,
  );
  assert.throws(
    () => parseTrustedToolingIdentity(JSON.stringify({ ...protectedIdentity(), extra: true })),
    /must contain exactly/,
  );
  assert.throws(() => parseTrustedToolingIdentity("{"), /malformed/);
});

test("keeps the tag provenance suffix separate from the approving workflow run", () => {
  const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));

  assert.equal(identity.runId, runId);
  assert.notEqual(identity.runId, tagProofRunId);
});

test("rejects same-name branches and tag names with the wrong SHA prefix", () => {
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({
          ...protectedIdentity(),
          fullRef: `refs/heads/${tag}`,
        }),
      ),
    /exact protected tag ref/,
  );
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({
          ...protectedIdentity(),
          ref: `release-publish/${"b".repeat(12)}-32410682801`,
          fullRef: `refs/tags/release-publish/${"b".repeat(12)}-32410682801`,
        }),
    ),
    /prefix does not match/,
  );
});

for (const [name, mutate] of [
  ["repository", (identity, env) => (env.GITHUB_REPOSITORY = "other/repo")],
  ["event", (identity, env) => (env.GITHUB_EVENT_NAME = "push")],
]) {
  test(`rejects an invocation context with the wrong ${name}`, async () => {
    const identity = protectedIdentity();
    const env = callerEnv(identity);
    mutate(identity, env);
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        env,
        getJson: async () => assert.fail("GitHub API must not be called"),
      }),
      /does not match/,
    );
  });
}

for (const [name, overrides] of [
  ["repository", { repository: { full_name: "other/repo" } }],
  ["run", { id: 999 }],
  ["run attempt", { run_attempt: 9 }],
  ["workflow", { path: ".github/workflows/other.yml" }],
  ["head branch", { head_branch: "main" }],
  ["head SHA", { head_sha: "b".repeat(40) }],
  ["event", { event: "push" }],
  [
    "same-name branch qualifier",
    { path: `${workflow}@refs/heads/${tag}` },
  ],
]) {
  test(`rejects a live workflow run with the wrong ${name}`, () => {
    const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));
    assert.throws(
      () => validateWorkflowRun(identity, runFixture(identity, overrides)),
      /mismatch|ambiguous/,
    );
  });
}

for (const [name, tagRef, message] of [
  [
    "deleted tag",
    undefined,
    /tag ref mismatch/,
  ],
  [
    "annotated tag",
    {
      ref: `refs/tags/${tag}`,
      object: { type: "tag", sha },
    },
    /lightweight tag/,
  ],
  [
    "moved tag",
    {
      ref: `refs/tags/${tag}`,
      object: { type: "commit", sha: "b".repeat(40) },
    },
    /moved after approval/,
  ],
]) {
  test(`rejects ${name === "annotated tag" ? "an" : "a"} ${name} after workflow approval`, async () => {
    const identity = protectedIdentity();
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        env: callerEnv(identity),
        getJson: async (path) =>
          path.includes("/actions/runs/") ? runFixture(identity) : tagRef,
      }),
      message,
    );
  });
}

test("rejects a main workflow SHA removed from current main lineage", async () => {
  const identity = mainIdentity();
  await assert.rejects(
    verifyTrustedToolingIdentity({
      rawIdentity: JSON.stringify(identity),
      env: callerEnv(identity),
      getJson: async (path) =>
        path.includes("/actions/runs/")
          ? runFixture(identity)
          : { status: "diverged", merge_base_commit: { sha: "b".repeat(40) } },
    }),
    /no longer reachable/,
  );
});
