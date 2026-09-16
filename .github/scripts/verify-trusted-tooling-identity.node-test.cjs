const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  deriveAuthorizationRoute,
  parentArtifactName,
  parseParentAuthorizationReceipt,
  parseRecoveryApprovalReceipt,
  parseTrustedToolingIdentity,
  recoveryArtifactName,
  validateArtifactResponse,
  validateReleaseParentRun,
  validateWorkflowRun,
  verifyTrustedToolingIdentity,
} = require("./verify-trusted-tooling-identity.cjs");

const callerSha = "c".repeat(40);
const callerRunId = "32440000001";
const callerRef = "v2026.8.3-beta.3";
const childWorkflow = ".github/workflows/plugin-clawhub-release.yml";
const toolingSha = "a".repeat(40);
const tagProofRunId = "32410682801";
const toolingRef = `release-publish/${toolingSha.slice(0, 12)}-${tagProofRunId}`;
const parentRunId = "32439999999";
const parentWorkflow = ".github/workflows/openclaw-release-publish.yml";
const botActor = "github-actions[bot]";
const humanActor = "release-maintainer";
const digest = `sha256:${"d".repeat(64)}`;
const inventoryDigest = "e".repeat(64);
const originalChild = { runId: "32439999998", runAttempt: "1" };

test("accepts a complete 89-package parent authorization inventory", () => {
  const packages = Array.from({ length: 89 }, (_, index) => ({
    name: `@openclaw/release-plugin-${index}`,
    version: "2026.8.2",
    inventoryDigest,
  }));
  const raw = JSON.stringify(parentReceipt(protectedIdentity(), { packages }));
  assert.ok(Buffer.byteLength(raw) > 8 * 1024);
  assert.deepEqual(parseParentAuthorizationReceipt(raw).packages, packages);
});

test("bounds parent receipts at 64 KiB while identity and recovery stay at 8 KiB", () => {
  for (const [parse, value, limit] of [
    [parseParentAuthorizationReceipt, parentReceipt(protectedIdentity()), 64 * 1024],
    [parseTrustedToolingIdentity, protectedIdentity(), 8 * 1024],
    [parseRecoveryApprovalReceipt, recoveryReceipt(protectedIdentity()), 8 * 1024],
  ]) {
    const raw = JSON.stringify(value);
    const exact = raw + " ".repeat(limit - Buffer.byteLength(raw));
    assert.doesNotThrow(() => parse(exact));
    assert.throws(() => parse(`${exact} `), new RegExp(`${limit / 1024} KiB limit`));
  }
});

test("applies the parent-only 64 KiB limit before reading receipt files", () => {
  const directory = mkdtempSync(join(tmpdir(), "clawhub-receipt-limit-"));
  try {
    const receiptPath = join(directory, "receipt.json");
    for (const [variable, limit] of [
      ["PARENT_AUTHORIZATION_RECEIPT_PATH", 64 * 1024],
      ["RECOVERY_APPROVAL_RECEIPT_PATH", 8 * 1024],
    ]) {
      const run = () =>
        spawnSync(process.execPath, [require.resolve("./verify-trusted-tooling-identity.cjs")], {
          env: { GH_TOKEN: "fixture", [variable]: receiptPath },
          encoding: "utf8",
        });
      writeFileSync(receiptPath, " ".repeat(limit));
      assert.doesNotMatch(run().stderr, /not a bounded regular file/);
      writeFileSync(receiptPath, " ".repeat(limit + 1));
      assert.match(run().stderr, /not a bounded regular file/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function protectedIdentity(overrides = {}) {
  return {
    version: 2,
    repository: "openclaw/openclaw",
    workflow: childWorkflow,
    runId: callerRunId,
    runAttempt: "2",
    ref: callerRef,
    fullRef: `refs/tags/${callerRef}`,
    sha: callerSha,
    candidateRepository: "openclaw/openclaw",
    candidateSha: "b".repeat(40),
    toolingRef,
    toolingFullRef: `refs/tags/${toolingRef}`,
    toolingSha,
    parentRepository: "openclaw/openclaw",
    parentWorkflow,
    parentRunId,
    parentRunAttempt: "3",
    ...overrides,
  };
}

function mainIdentity(overrides = {}) {
  return protectedIdentity({
    toolingRef: "main",
    toolingFullRef: "refs/heads/main",
    ...overrides,
  });
}

function parentReceipt(identity, overrides = {}) {
  return {
    version: 2,
    kind: "openclaw-clawhub-parent-authorization",
    repository: identity.parentRepository,
    workflow: identity.parentWorkflow,
    runId: identity.parentRunId,
    runAttempt: identity.parentRunAttempt,
    ref: identity.toolingRef,
    fullRef: identity.toolingFullRef,
    headSha: identity.toolingSha,
    childRepository: identity.repository,
    childWorkflow: identity.workflow,
    childRunId: identity.runId,
    childRunAttempt: identity.runAttempt,
    childRef: identity.ref,
    childFullRef: identity.fullRef,
    childHeadSha: identity.sha,
    candidateRepository: identity.candidateRepository,
    candidateSha: identity.candidateSha,
    toolingRef: identity.toolingRef,
    toolingFullRef: identity.toolingFullRef,
    toolingSha: identity.toolingSha,
    packages: [
      {
        name: "@openclaw/demo",
        version: "1.0.0",
        inventoryDigest,
      },
    ],
    authorizationRoute: "automated-awaited",
    ...overrides,
  };
}

function recoveryReceipt(identity, overrides = {}) {
  return {
    version: 2,
    authorizedChildRunId: originalChild.runId,
    authorizedChildRunAttempt: originalChild.runAttempt,
    kind: "openclaw-clawhub-recovery-approval",
    repository: identity.repository,
    workflow: identity.workflow,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    actor: humanActor,
    environment: "clawhub-plugin-release",
    approvalJob: "approve_plugins_clawhub_release",
    authorizationRoute: "explicit-recovery",
    parentRunId: identity.parentRunId,
    parentRunAttempt: identity.parentRunAttempt,
    ...overrides,
  };
}

function callerEnv(identity, actor = botActor) {
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
    GITHUB_ACTOR: actor,
  };
}

function runFixture(identity, actor = botActor, overrides = {}) {
  return {
    id: Number(identity.runId),
    run_attempt: Number(identity.runAttempt),
    path: `${identity.workflow}@${identity.fullRef}`,
    head_branch: identity.ref,
    head_sha: identity.sha,
    event: "workflow_dispatch",
    actor: { login: actor, type: actor === botActor ? "Bot" : "User" },
    repository: { full_name: identity.repository },
    ...overrides,
  };
}

function parentRunFixture(identity, receipt, overrides = {}) {
  return {
    id: Number(identity.parentRunId),
    run_attempt: Number(identity.parentRunAttempt),
    path: identity.parentWorkflow,
    head_branch: receipt.ref,
    head_sha: receipt.headSha,
    event: "workflow_dispatch",
    status: "in_progress",
    conclusion: null,
    repository: { full_name: identity.parentRepository },
    ...overrides,
  };
}

function artifactFixture(name, runId, headSha, overrides = {}) {
  return {
    total_count: 1,
    artifacts: [
      {
        name,
        expired: false,
        digest,
        workflow_run: { id: Number(runId), head_sha: headSha },
        ...overrides,
      },
    ],
  };
}

function apiFixture({
  identity,
  receipt,
  actor = botActor,
  recovery,
  parentRun = parentRunFixture(identity, receipt),
  final,
}) {
  return async (path) => {
    if (path.includes(`/actions/runs/${identity.runId}/attempts/`)) {
      return runFixture(identity, actor);
    }
    if (path.includes(`/actions/runs/${identity.parentRunId}/artifacts?`)) {
      const name = parentArtifactName(identity, {
        runId: receipt.childRunId,
        runAttempt: receipt.childRunAttempt,
      });
      if (new URL(path, "https://api.github.com/").searchParams.get("name") !== name) {
        return { total_count: 0, artifacts: [] };
      }
      return artifactFixture(name, identity.parentRunId, identity.toolingSha);
    }
    if (path.includes(`/actions/runs/${identity.runId}/artifacts?`)) {
      assert.ok(recovery);
      return artifactFixture(recoveryArtifactName(identity), identity.runId, identity.sha);
    }
    if (path.includes(`/actions/runs/${identity.parentRunId}/attempts/`)) {
      return parentRun;
    }
    return (
      final ?? {
        ref: identity.toolingFullRef,
        object: { type: "commit", sha: identity.toolingSha },
      }
    );
  };
}

test("binds bot publication to the immutable awaited parent receipt", async () => {
  const identity = protectedIdentity();
  const receipt = parentReceipt(identity);
  const calls = [];
  const getJson = apiFixture({ identity, receipt });
  const result = await verifyTrustedToolingIdentity({
    rawIdentity: JSON.stringify(identity),
    rawParentReceipt: JSON.stringify(receipt),
    env: callerEnv(identity),
    getJson: async (path) => {
      calls.push(path);
      return getJson(path);
    },
  });

  assert.equal(result.toolingRoute, "protected-tag");
  assert.equal(result.authorizationRoute, "automated-awaited");
  assert.deepEqual(calls, [
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/attempts/${identity.parentRunAttempt}`,
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/artifacts?name=${encodeURIComponent(parentArtifactName(identity))}`,
    `repos/${identity.repository}/git/ref/tags/${encodeURIComponent(identity.toolingRef)}`,
  ]);
});

test("preserves main tooling lineage under the receipt-backed route", async () => {
  const identity = mainIdentity();
  const receipt = parentReceipt(identity);
  const result = await verifyTrustedToolingIdentity({
    rawIdentity: JSON.stringify(identity),
    rawParentReceipt: JSON.stringify(receipt),
    env: callerEnv(identity),
    getJson: apiFixture({
      identity,
      receipt,
      final: { status: "ahead", merge_base_commit: { sha: identity.toolingSha } },
    }),
  });
  assert.equal(result.toolingRoute, "main");
});

test("requires the exact v2 identity without caller-selected policy or route", () => {
  assert.throws(
    () => parseTrustedToolingIdentity(JSON.stringify({ ...protectedIdentity(), version: 1 })),
    /version must be 2/,
  );
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({ ...protectedIdentity(), parentStatePolicy: "recovery" }),
      ),
    /must contain exactly/,
  );
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({ ...protectedIdentity(), authorizationRoute: "explicit-recovery" }),
      ),
    /must contain exactly/,
  );
});

test("requires the designated child and parent workflows", () => {
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({
          ...protectedIdentity(),
          workflow: ".github/workflows/other.yml",
        }),
      ),
    /not the OpenClaw ClawHub publisher/,
  );
  assert.throws(
    () =>
      parseTrustedToolingIdentity(
        JSON.stringify({
          ...protectedIdentity(),
          parentWorkflow: ".github/workflows/other.yml",
        }),
      ),
    /not the OpenClaw release publisher/,
  );
});

test("rejects unknown parent-produced authorization routes", () => {
  const identity = protectedIdentity();
  assert.throws(
    () =>
      parseParentAuthorizationReceipt(
        JSON.stringify(parentReceipt(identity, { authorizationRoute: "explicit-recovery" })),
      ),
    /route is unknown/,
  );
});

test("rejects same-name branches even when the SHA and short name match", () => {
  const identity = protectedIdentity({ toolingFullRef: `refs/heads/${toolingRef}` });
  assert.throws(
    () => parseTrustedToolingIdentity(JSON.stringify(identity)),
    /exact protected tag ref/,
  );
});

test("does not infer parent full ref from an unqualified run path", () => {
  const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));
  const receipt = parseParentAuthorizationReceipt(JSON.stringify(parentReceipt(identity)));
  assert.doesNotThrow(() =>
    validateReleaseParentRun(
      identity,
      parentRunFixture(identity, receipt, { path: identity.parentWorkflow }),
    ),
  );
});

test("rejects same-name branch parent paths when the receipt proves a tag", () => {
  const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));
  const receipt = parseParentAuthorizationReceipt(JSON.stringify(parentReceipt(identity)));
  assert.throws(
    () =>
      validateReleaseParentRun(
        identity,
        parentRunFixture(identity, receipt, {
          path: `${identity.parentWorkflow}@refs/heads/${identity.toolingRef}`,
        }),
      ),
    /path ref mismatch/,
  );
});

for (const [name, mutate] of [
  ["repository", (identity, env) => (env.GITHUB_REPOSITORY = "other/repo")],
  ["run", (identity, env) => (env.GITHUB_RUN_ID = "999")],
  ["run attempt", (identity, env) => (env.GITHUB_RUN_ATTEMPT = "9")],
  ["workflow SHA", (identity, env) => (env.GITHUB_WORKFLOW_SHA = "b".repeat(40))],
  ["full ref", (identity, env) => (env.GITHUB_REF = `refs/heads/${identity.ref}`)],
  ["SHA", (identity, env) => (env.GITHUB_SHA = "b".repeat(40))],
  ["event", (identity, env) => (env.GITHUB_EVENT_NAME = "push")],
]) {
  test(`rejects an invocation context with the wrong ${name}`, async () => {
    const identity = protectedIdentity();
    const receipt = parentReceipt(identity);
    const env = callerEnv(identity);
    mutate(identity, env);
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
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
  ["actor", { actor: { login: "other", type: "User" } }],
]) {
  test(`rejects a live invoking workflow run with the wrong ${name}`, () => {
    const identity = parseTrustedToolingIdentity(JSON.stringify(protectedIdentity()));
    assert.throws(
      () => validateWorkflowRun(identity, runFixture(identity, botActor, overrides), botActor),
      /mismatch/,
    );
  });
}

test("rejects a missing receipt even with the same parent branch and SHA", async () => {
  const identity = protectedIdentity();
  await assert.rejects(
    verifyTrustedToolingIdentity({
      rawIdentity: JSON.stringify(identity),
      rawParentReceipt: "",
      env: callerEnv(identity),
      getJson: apiFixture({ identity, receipt: parentReceipt(identity) }),
    }),
    /authorization receipt JSON is required/,
  );
});

for (const [name, overrides, message] of [
  ["moved full ref", { fullRef: `refs/heads/${toolingRef}` }, /full ref mismatch/],
  ["wrong SHA", { headSha: "b".repeat(40) }, /head SHA mismatch/],
  ["wrong run", { runId: "999" }, /run id mismatch/],
  [
    "wrong child route",
    { childWorkflow: ".github/workflows/other.yml" },
    /child workflow mismatch/,
  ],
]) {
  test(`rejects a ${name} parent receipt`, async () => {
    const identity = protectedIdentity();
    const receipt = parentReceipt(identity, overrides);
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
        env: callerEnv(identity),
        getJson: apiFixture({ identity, receipt: parentReceipt(identity) }),
      }),
      message,
    );
  });
}

test("rejects a parent receipt artifact moved from another run", () => {
  const identity = protectedIdentity();
  assert.throws(
    () =>
      validateArtifactResponse(
        artifactFixture(parentArtifactName(identity), identity.parentRunId, identity.toolingSha, {
          workflow_run: { id: 999, head_sha: identity.toolingSha },
        }),
        {
          headSha: identity.toolingSha,
          name: parentArtifactName(identity),
          runId: identity.parentRunId,
        },
      ),
    /identity is invalid/,
  );
});

test("rejects missing, expired, or mutable-looking artifact identities", () => {
  const identity = protectedIdentity();
  const name = parentArtifactName(identity);
  assert.throws(
    () =>
      validateArtifactResponse(
        { total_count: 0, artifacts: [] },
        { headSha: identity.toolingSha, name, runId: parentRunId },
      ),
    /missing or ambiguous/,
  );
  assert.throws(
    () =>
      validateArtifactResponse(
        artifactFixture(name, parentRunId, identity.toolingSha, { expired: true }),
        {
          headSha: identity.toolingSha,
          name,
          runId: parentRunId,
        },
      ),
    /identity is invalid/,
  );
  assert.throws(
    () =>
      validateArtifactResponse(
        artifactFixture(name, parentRunId, identity.toolingSha, { digest: "" }),
        {
          headSha: identity.toolingSha,
          name,
          runId: parentRunId,
        },
      ),
    /identity is invalid/,
  );
  assert.throws(
    () =>
      validateArtifactResponse(artifactFixture(name, parentRunId, "b".repeat(40)), {
        headSha: identity.toolingSha,
        name,
        runId: parentRunId,
      }),
    /identity is invalid/,
  );
});

test("bot actors cannot select recovery even with a recovery receipt", () => {
  const identity = protectedIdentity();
  const receipt = parseParentAuthorizationReceipt(JSON.stringify(parentReceipt(identity)));
  const recovery = recoveryReceipt(identity, { actor: botActor });
  assert.throws(
    () => deriveAuthorizationRoute(identity, runFixture(identity), receipt, recovery),
    /cannot select the recovery route/,
  );
});

test("GitHub App actors cannot select recovery without a bot-suffixed login", () => {
  const identity = protectedIdentity();
  const receipt = parseParentAuthorizationReceipt(JSON.stringify(parentReceipt(identity)));
  const recovery = recoveryReceipt(identity, { actor: "release-service" });
  assert.throws(
    () =>
      deriveAuthorizationRoute(
        identity,
        runFixture(identity, "release-service", {
          actor: { login: "release-service", type: "App" },
        }),
        receipt,
        recovery,
      ),
    /cannot select the recovery route/,
  );
});

test("bot publication rejects recovery before artifact resolution", async () => {
  const identity = protectedIdentity();
  const receipt = parentReceipt(identity);
  const recovery = recoveryReceipt(identity, { actor: botActor });
  const calls = [];
  const getJson = apiFixture({ identity, receipt, recovery });
  await assert.rejects(
    verifyTrustedToolingIdentity({
      rawIdentity: JSON.stringify(identity),
      rawParentReceipt: JSON.stringify(receipt),
      rawRecoveryReceipt: JSON.stringify(recovery),
      env: callerEnv(identity),
      getJson: async (path) => {
        calls.push(path);
        return getJson(path);
      },
    }),
    /cannot select the recovery route/,
  );
  assert.deepEqual(calls, [
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/attempts/${identity.parentRunAttempt}`,
  ]);
});

for (const [name, overrides, message] of [
  ["wrong workflow", { workflow: ".github/workflows/other.yml" }, /workflow mismatch/],
  ["wrong environment", { environment: "other" }, /environment mismatch/],
  ["wrong approval job", { approvalJob: "other" }, /approval job mismatch/],
  ["wrong route", { authorizationRoute: "automated-detached" }, /route is invalid/],
  ["wrong actor", { actor: "other" }, /actor mismatch/],
  ["wrong parent", { parentRunId: "999" }, /parent run id mismatch/],
]) {
  test(`rejects recovery approval evidence with the ${name}`, async () => {
    const identity = protectedIdentity();
    const receipt = parentReceipt(identity);
    const recovery = recoveryReceipt(identity, overrides);
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
        rawRecoveryReceipt: JSON.stringify(recovery),
        env: callerEnv(identity, humanActor),
        getJson: apiFixture({ identity, receipt, actor: humanActor, recovery }),
      }),
      message,
    );
  });
}

test("detached normal publication permits only active or successful parents", async () => {
  const identity = protectedIdentity();
  const receipt = parentReceipt(identity, { authorizationRoute: "automated-detached" });
  for (const [status, conclusion] of [
    ["in_progress", null],
    ["completed", "success"],
  ]) {
    await assert.doesNotReject(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
        env: callerEnv(identity),
        getJson: apiFixture({
          identity,
          receipt,
          parentRun: parentRunFixture(identity, receipt, { status, conclusion }),
        }),
      }),
    );
  }
  for (const conclusion of ["failure", "cancelled"]) {
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
        env: callerEnv(identity),
        getJson: apiFixture({
          identity,
          receipt,
          parentRun: parentRunFixture(identity, receipt, {
            status: "completed",
            conclusion,
          }),
        }),
      }),
      /not allowed by authorization route automated-detached/,
    );
  }
});

test("human dispatch requires the recovery receipt path and names its artifact", async () => {
  const identity = protectedIdentity();
  const receipt = parentReceipt(identity);
  await assert.rejects(
    verifyTrustedToolingIdentity({
      rawIdentity: JSON.stringify(identity),
      rawParentReceipt: JSON.stringify(receipt),
      env: callerEnv(identity, humanActor),
      getJson: apiFixture({ identity, receipt, actor: humanActor }),
    }),
    new RegExp(`RECOVERY_APPROVAL_RECEIPT_PATH is required.*${recoveryArtifactName(identity)}`),
  );
});

test("human recovery reuses the failed parent's receipt bound to its original bot child", async () => {
  const identity = protectedIdentity();
  const receipt = parentReceipt(identity, {
    childRunId: originalChild.runId,
    childRunAttempt: originalChild.runAttempt,
  });
  const recovery = recoveryReceipt(identity);
  const calls = [];
  const getJson = apiFixture({
    identity,
    receipt,
    actor: humanActor,
    recovery,
    parentRun: parentRunFixture(identity, receipt, {
      status: "completed",
      conclusion: "failure",
    }),
  });
  const result = await verifyTrustedToolingIdentity({
    rawIdentity: JSON.stringify(identity),
    rawParentReceipt: JSON.stringify(receipt),
    rawRecoveryReceipt: JSON.stringify(recovery),
    env: callerEnv(identity, humanActor),
    getJson: async (path) => {
      calls.push(path);
      return getJson(path);
    },
  });
  assert.equal(result.authorizationRoute, "explicit-recovery");
  assert.deepEqual(calls, [
    `repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/attempts/${identity.parentRunAttempt}`,
    `repos/${identity.repository}/actions/runs/${identity.runId}/artifacts?name=${encodeURIComponent(recoveryArtifactName(identity))}`,
    `repos/${identity.parentRepository}/actions/runs/${identity.parentRunId}/artifacts?name=${encodeURIComponent(parentArtifactName(identity, originalChild))}`,
    `repos/${identity.repository}/git/ref/tags/${encodeURIComponent(identity.toolingRef)}`,
  ]);
});

for (const [name, overrides, message] of [
  [
    "authorized child without a parent receipt",
    { childRunId: callerRunId },
    /missing or ambiguous/,
  ],
  ["child SHA changed", { childHeadSha: "f".repeat(40) }, /child head SHA mismatch/],
  [
    "child ref changed",
    { childRef: "other", childFullRef: "refs/heads/other" },
    /child ref mismatch/,
  ],
]) {
  test(`recovery fails closed for ${name}`, async () => {
    const identity = protectedIdentity();
    const receipt = parentReceipt(identity, {
      childRunId: originalChild.runId,
      childRunAttempt: originalChild.runAttempt,
      ...overrides,
    });
    const recovery = recoveryReceipt(identity);
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
        rawRecoveryReceipt: JSON.stringify(recovery),
        env: callerEnv(identity, humanActor),
        getJson: apiFixture({ identity, receipt, actor: humanActor, recovery }),
      }),
      message,
    );
  });
}

test("rejects v1 recovery approval and non-positive authorized child attempts", () => {
  assert.throws(
    () =>
      parseRecoveryApprovalReceipt(
        JSON.stringify(recoveryReceipt(protectedIdentity(), { version: 1 })),
      ),
    /version must be 2/,
  );
  const legacy = recoveryReceipt(protectedIdentity(), { version: 1 });
  delete legacy.authorizedChildRunId;
  delete legacy.authorizedChildRunAttempt;
  assert.throws(
    () => parseRecoveryApprovalReceipt(JSON.stringify(legacy)),
    /v2 must contain exactly/,
  );
  for (const field of ["authorizedChildRunId", "authorizedChildRunAttempt"]) {
    for (const value of ["0", "-1", "1.5", 1]) {
      assert.throws(
        () =>
          parseRecoveryApprovalReceipt(
            JSON.stringify(recoveryReceipt(protectedIdentity(), { [field]: value })),
          ),
        new RegExp(`${field} is invalid`),
      );
    }
  }
});

for (const [actor, route, recovery, conclusion] of [
  [botActor, "automated-awaited", undefined, "failure"],
  [botActor, "automated-awaited", undefined, "cancelled"],
  [botActor, "automated-detached", undefined, "failure"],
  [botActor, "automated-detached", undefined, "cancelled"],
  [humanActor, "automated-awaited", recoveryReceipt(protectedIdentity()), "cancelled"],
]) {
  test(`rejects ${conclusion} parent during approval wait for ${actor}/${route}`, async () => {
    const identity = protectedIdentity();
    const receipt = parentReceipt(identity, {
      authorizationRoute: route,
      ...(recovery
        ? { childRunId: originalChild.runId, childRunAttempt: originalChild.runAttempt }
        : {}),
    });
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
        rawRecoveryReceipt: recovery ? JSON.stringify(recovery) : "",
        env: callerEnv(identity, actor),
        getJson: apiFixture({
          identity,
          receipt,
          actor,
          recovery,
          parentRun: parentRunFixture(identity, receipt, {
            status: "completed",
            conclusion,
          }),
        }),
      }),
      /not allowed by authorization route/,
    );
  });
}

for (const [name, tagRef, message] of [
  ["deleted", {}, /tag ref mismatch/],
  [
    "annotated",
    { ref: `refs/tags/${toolingRef}`, object: { type: "tag", sha: toolingSha } },
    /lightweight tag/,
  ],
  [
    "moved",
    { ref: `refs/tags/${toolingRef}`, object: { type: "commit", sha: "b".repeat(40) } },
    /moved after approval/,
  ],
]) {
  test(`rejects a ${name} tooling tag after approval`, async () => {
    const identity = protectedIdentity();
    const receipt = parentReceipt(identity);
    await assert.rejects(
      verifyTrustedToolingIdentity({
        rawIdentity: JSON.stringify(identity),
        rawParentReceipt: JSON.stringify(receipt),
        env: callerEnv(identity),
        getJson: apiFixture({ identity, receipt, final: tagRef }),
      }),
      message,
    );
  });
}

test("rejects a main tooling SHA removed from current main lineage", async () => {
  const identity = mainIdentity();
  const receipt = parentReceipt(identity);
  await assert.rejects(
    verifyTrustedToolingIdentity({
      rawIdentity: JSON.stringify(identity),
      rawParentReceipt: JSON.stringify(receipt),
      env: callerEnv(identity),
      getJson: apiFixture({
        identity,
        receipt,
        final: { status: "diverged", merge_base_commit: { sha: "b".repeat(40) } },
      }),
    }),
    /no longer reachable/,
  );
});
