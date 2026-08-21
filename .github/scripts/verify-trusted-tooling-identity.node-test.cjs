const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseTrustedToolingIdentity,
  validateReleaseParentRun,
  validateWorkflowRun,
  verifyTrustedToolingIdentity,
} = require("./verify-trusted-tooling-identity.cjs");

const callerSha = "c".repeat(40);
const callerRunId = "32440000001";
const callerRef = "v2026.8.3-beta.3";
const workflow = ".github/workflows/plugin-clawhub-release.yml";
const toolingSha = "a".repeat(40);
const tagProofRunId = "32410682801";
const toolingRef = `release-publish/${toolingSha.slice(0, 12)}-${tagProofRunId}`;
const parentRunId = "32439999999";
const parentWorkflow = ".github/workflows/openclaw-release-publish.yml";

function protectedIdentity(overrides = {}) {
  return {
    version: 2,
    repository: "openclaw/openclaw",
    workflow,
    runId: callerRunId,
    runAttempt: "2",
    ref: callerRef,
    fullRef: `refs/tags/${callerRef}`,
    sha: callerSha,
    toolingRef,
    toolingFullRef: `refs/tags/${toolingRef}`,
    toolingSha,
    parentRepository: "openclaw/openclaw",
    parentWorkflow,
    parentRunId,
    parentRunAttempt: "3",
    parentRef: toolingRef,
    parentFullRef: `refs/tags/${toolingRef}`,
    parentSha: toolingSha,
    parentStatePolicy: "active",
    ...overrides,
  };
}

function mainIdentity(overrides = {}) {
  return protectedIdentity({
    toolingRef: "main",
    toolingFullRef: "refs/heads/main",
    parentRef: "main",
    parentFullRef: "refs/heads/main",
    ...overrides,
  });
}

function callerEnv(identity) {
  return {
    GITHUB_REPOSITORY: identity.repository,
    GITHUB_RUN_ID: identity.runId,
    GITHUB_RUN_ATTEMPT: identity.runAttempt,
    GITHUB_WORKFLOW_REF: `${identity.repository}/${identity.workflow}@${identity.fullRef}`,
    GITHUB_WORKFLOW_SHA: identity.sha,
    GITHUB_REF: identity.fullRef,
    GITHUB_REF_NAME: identity.ref,
    GITHUB_SHA: identity.sha,
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

function parentRunFixture(identity, overrides = {}) {
  return {
    id: Number(identity.parentRunId),
    run_attempt: Number(identity.parentRunAttempt),
    path: `${identity.parentWorkflow}@${identity.parentFullRef}`,
    head_branch: identity.parentRef,
    head_sha: identity.parentSha,
    event: "workflow_dispatch",
    status: "in_progress",
    conclusion: null,
    repository: { full_name: identity.parentRepository },
    ...overrides,
  };
}

test("binds the invoking and parent runs before re-reading the protected tooling tag", async () => {
  const identity = protectedIdentity();
  const calls = [];
  const result = await verifyTrustedToolingIdentity({
    rawIdentity: JSON.stringify(identity),
    env: callerEnv(identity),
    getJson: async (path) => {
      calls.push(path);
      if (path.includes(`/actions/runs/${identity.runId}/`)) return runFixture(identity);
      if (path.includes(`/actions/runs/${identity.parentRunId}/`)) {
        return parentRunFixture(identity);
      }
      return {
        ref: identity.toolingFullRef,
        object: { type: "commit", sha: identity.toolingSha },
      };
    },
  });

  assert.equal(result.route, "protected-tag");
  assert.deepEqual(calls, [
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/attempts/${identity.parentRunAttempt}`,
    `repos/${identity.repository}/git/ref/tags/${encodeURIComponent(identity.toolingRef)}`,
  ]);
});

test("preserves the ordinary main tooling route when its SHA remains on main", async () => {
  const identity = mainIdentity();
  const calls = [];
  const result = await verifyTrustedToolingIdentity({
    rawIdentity: JSON.stringify(identity),
    env: callerEnv(identity),
    getJson: async (path) => {
      calls.push(path);
      if (path.includes(`/actions/runs/${identity.runId}/`)) return runFixture(identity);
      if (path.includes(`/actions/runs/${identity.parentRunId}/`)) {
        return parentRunFixture(identity);
      }
      return {
        status: "ahead",
        merge_base_commit: { sha: identity.toolingSha },
      };
    },
  });

  assert.equal(result.route, "main");
  assert.equal(calls[2], `repos/${identity.repository}/compare/${identity.toolingSha}...main`);
});

test("requires the exact v2 tuple without hidden compatibility fields", () => {
  assert.throws(
    () => parseTrustedToolingIdentity(JSON.stringify({ ...protectedIdentity(), version: 3 })),
    /version must be 2/,
  );
  assert.throws(
    () => parseTrustedToolingIdentity(JSON.stringify({ ...protectedIdentity(), extra: true })),
    /must contain exactly/,
  );
  assert.throws(() => parseTrustedToolingIdentity("{"), /malformed/);
});

test("requires a known explicit parent-state policy", () => {
  const { parentStatePolicy: _parentStatePolicy, ...missingPolicy } = protectedIdentity();
  assert.throws(
    () => parseTrustedToolingIdentity(JSON.stringify(missingPolicy)),
    /must contain exactly/,
  );
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify(protectedIdentity({ parentStatePolicy: "whatever-happened" })),
      ),
    /parentStatePolicy is unknown/,
  );
});

test("requires the release parent tuple to match the trusted tooling tuple", () => {
  assert.throws(
    () =>
      parseTrustedToolingIdentity(JSON.stringify(protectedIdentity({ parentSha: "b".repeat(40) }))),
    /parent tuple does not match/,
  );
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify(protectedIdentity({ parentWorkflow: ".github/workflows/other.yml" })),
      ),
    /not the OpenClaw release publisher/,
  );
});

test("keeps the tooling tag provenance suffix separate from the invoking run", () => {
  const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));

  assert.equal(identity.runId, callerRunId);
  assert.notEqual(identity.runId, tagProofRunId);
});

test("rejects caller refs that do not match their full ref", () => {
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({
          ...protectedIdentity(),
          fullRef: "refs/heads/main",
        }),
      ),
    /caller ref does not match/,
  );
});

test("rejects tooling same-name branches and tag names with the wrong SHA prefix", () => {
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({
          ...protectedIdentity(),
          toolingFullRef: `refs/heads/${toolingRef}`,
          parentFullRef: `refs/heads/${toolingRef}`,
        }),
      ),
    /exact protected tag ref/,
  );
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({
          ...protectedIdentity(),
          toolingRef: `release-publish/${"b".repeat(12)}-${tagProofRunId}`,
          toolingFullRef: `refs/tags/release-publish/${"b".repeat(12)}-${tagProofRunId}`,
          parentRef: `release-publish/${"b".repeat(12)}-${tagProofRunId}`,
          parentFullRef: `refs/tags/release-publish/${"b".repeat(12)}-${tagProofRunId}`,
        }),
      ),
    /prefix does not match/,
  );
});

for (const [name, mutate] of [
  ["repository", (identity, env) => (env.GITHUB_REPOSITORY = "other/repo")],
  ["run", (identity, env) => (env.GITHUB_RUN_ID = "999")],
  ["run attempt", (identity, env) => (env.GITHUB_RUN_ATTEMPT = "9")],
  [
    "workflow",
    (identity, env) =>
      (env.GITHUB_WORKFLOW_REF = `${identity.repository}/.github/workflows/other.yml@${identity.fullRef}`),
  ],
  ["workflow SHA", (identity, env) => (env.GITHUB_WORKFLOW_SHA = "b".repeat(40))],
  ["full ref", (identity, env) => (env.GITHUB_REF = `refs/heads/${identity.ref}`)],
  ["ref", (identity, env) => (env.GITHUB_REF_NAME = "main")],
  ["SHA", (identity, env) => (env.GITHUB_SHA = "b".repeat(40))],
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
  ["same-name branch qualifier", { path: `${workflow}@refs/heads/${callerRef}` }],
]) {
  test(`rejects a live invoking workflow run with the wrong ${name}`, () => {
    const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));
    assert.throws(
      () => validateWorkflowRun(identity, runFixture(identity, overrides)),
      /mismatch|ambiguous/,
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
  ["same-name branch qualifier", { path: `${parentWorkflow}@refs/heads/${toolingRef}` }],
]) {
  test(`rejects a live release parent workflow run with the wrong ${name}`, () => {
    const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));
    assert.throws(
      () => validateReleaseParentRun(identity, parentRunFixture(identity, overrides)),
      /mismatch|ambiguous/,
    );
  });
}

test("accepts only an active parent for the automated policy", () => {
  const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));
  assert.doesNotThrow(() => validateReleaseParentRun(identity, parentRunFixture(identity)));
  for (const conclusion of ["success", "failure", "cancelled"]) {
    assert.throws(
      () =>
        validateReleaseParentRun(
          identity,
          parentRunFixture(identity, { status: "completed", conclusion }),
        ),
      /not allowed by policy active/,
    );
  }
});

test("allows active or successful parents for detached normal publication", () => {
  const identity = parseTrustedToolingIdentity(
    JSON.stringify(protectedIdentity({ parentStatePolicy: "active-or-success" })),
  );
  assert.doesNotThrow(() => validateReleaseParentRun(identity, parentRunFixture(identity)));
  assert.doesNotThrow(() =>
    validateReleaseParentRun(
      identity,
      parentRunFixture(identity, { status: "completed", conclusion: "success" }),
    ),
  );
  for (const conclusion of ["failure", "cancelled"]) {
    assert.throws(
      () =>
        validateReleaseParentRun(
          identity,
          parentRunFixture(identity, { status: "completed", conclusion }),
        ),
      /not allowed by policy active-or-success/,
    );
  }
});

test("limits explicit recovery to active, successful, or failed parents", () => {
  const identity = parseTrustedToolingIdentity(
    JSON.stringify(
      protectedIdentity({ parentStatePolicy: "recovery-active-or-success-or-failure" }),
    ),
  );
  assert.doesNotThrow(() => validateReleaseParentRun(identity, parentRunFixture(identity)));
  for (const conclusion of ["success", "failure"]) {
    assert.doesNotThrow(() =>
      validateReleaseParentRun(
        identity,
        parentRunFixture(identity, { status: "completed", conclusion }),
      ),
    );
  }
  assert.throws(
    () =>
      validateReleaseParentRun(
        identity,
        parentRunFixture(identity, { status: "completed", conclusion: "cancelled" }),
      ),
    /not allowed by policy recovery-active-or-success-or-failure/,
  );
});

for (const [conclusion, policy] of [
  ["cancelled", "active"],
  ["failure", "active"],
  ["cancelled", "active-or-success"],
  ["failure", "active-or-success"],
]) {
  test(`rejects a parent that becomes ${conclusion} during the approval wait under ${policy}`, async () => {
    const identity = protectedIdentity({ parentStatePolicy: policy });
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        env: callerEnv(identity),
        getJson: async (path) => {
          if (path.includes(`/actions/runs/${identity.runId}/`)) return runFixture(identity);
          if (path.includes(`/actions/runs/${identity.parentRunId}/`)) {
            return parentRunFixture(identity, { status: "completed", conclusion });
          }
          return assert.fail("tooling must not be trusted after parent rejection");
        },
      }),
      new RegExp(`not allowed by policy ${policy}`),
    );
  });
}

for (const [name, tagRef, message] of [
  ["deleted tag", undefined, /tag ref mismatch/],
  [
    "annotated tag",
    {
      ref: `refs/tags/${toolingRef}`,
      object: { type: "tag", sha: toolingSha },
    },
    /lightweight tag/,
  ],
  [
    "moved tag",
    {
      ref: `refs/tags/${toolingRef}`,
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
        getJson: async (path) => {
          if (path.includes(`/actions/runs/${identity.runId}/`)) return runFixture(identity);
          if (path.includes(`/actions/runs/${identity.parentRunId}/`)) {
            return parentRunFixture(identity);
          }
          return tagRef;
        },
      }),
      message,
    );
  });
}

test("rejects a main tooling SHA removed from current main lineage", async () => {
  const identity = mainIdentity();
  await assert.rejects(
    verifyTrustedToolingIdentity({
      rawIdentity: JSON.stringify(identity),
      env: callerEnv(identity),
      getJson: async (path) => {
        if (path.includes(`/actions/runs/${identity.runId}/`)) return runFixture(identity);
        if (path.includes(`/actions/runs/${identity.parentRunId}/`)) {
          return parentRunFixture(identity);
        }
        return { status: "diverged", merge_base_commit: { sha: "b".repeat(40) } };
      },
    }),
    /no longer reachable/,
  );
});
