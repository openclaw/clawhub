/* @vitest-environment node */

import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerifiedGitHubActionsIdentity } from "./githubActionsOidc";
import {
  parentAuthorizationArtifactName,
  parseOpenClawTrustedToolingIdentity,
  verifyOpenClawPublishAuthorization,
} from "./openClawPublishAuthorization";

const childSha = "c".repeat(40);
const candidateSha = "b".repeat(40);
const toolingSha = "a".repeat(40);
const inventoryDigest = "d".repeat(64);
const originalChild = { runId: "32439999998", runAttempt: "1" };
const toolingRef = `release-publish/${toolingSha.slice(0, 12)}-32410682801`;

function identity(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    repository: "openclaw/openclaw",
    workflow: ".github/workflows/plugin-clawhub-release.yml",
    runId: "32440000001",
    runAttempt: "2",
    ref: "release/2026.8.3",
    fullRef: "refs/heads/release/2026.8.3",
    sha: childSha,
    candidateRepository: "openclaw/openclaw",
    candidateSha,
    toolingRef,
    toolingFullRef: `refs/tags/${toolingRef}`,
    toolingSha,
    parentRepository: "openclaw/openclaw",
    parentWorkflow: ".github/workflows/openclaw-release-publish.yml",
    parentRunId: "32439999999",
    parentRunAttempt: "3",
    ...overrides,
  };
}

function parentReceipt(overrides: Record<string, unknown> = {}) {
  const value = identity();
  return {
    version: 2,
    kind: "openclaw-clawhub-parent-authorization",
    repository: value.parentRepository,
    workflow: value.parentWorkflow,
    runId: value.parentRunId,
    runAttempt: value.parentRunAttempt,
    ref: value.toolingRef,
    fullRef: value.toolingFullRef,
    headSha: value.toolingSha,
    childRepository: value.repository,
    childWorkflow: value.workflow,
    childRunId: value.runId,
    childRunAttempt: value.runAttempt,
    childRef: value.ref,
    childFullRef: value.fullRef,
    childHeadSha: value.sha,
    candidateRepository: value.candidateRepository,
    candidateSha: value.candidateSha,
    toolingRef: value.toolingRef,
    toolingFullRef: value.toolingFullRef,
    toolingSha: value.toolingSha,
    authorizationRoute: "automated-awaited",
    packages: [
      {
        name: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
      },
    ],
    ...overrides,
  };
}

function recoveryReceipt(overrides: Record<string, unknown> = {}) {
  const value = identity();
  return {
    version: 2,
    authorizedChildRunId: originalChild.runId,
    authorizedChildRunAttempt: originalChild.runAttempt,
    kind: "openclaw-clawhub-recovery-approval",
    repository: value.repository,
    workflow: value.workflow,
    runId: value.runId,
    runAttempt: value.runAttempt,
    actor: "release-maintainer",
    environment: "clawhub-plugin-release",
    approvalJob: "approve_plugins_clawhub_release",
    authorizationRoute: "explicit-recovery",
    parentRunId: value.parentRunId,
    parentRunAttempt: value.parentRunAttempt,
    ...overrides,
  };
}

function oidc(): VerifiedGitHubActionsIdentity {
  const value = identity();
  return {
    repository: value.repository,
    repositoryId: "1",
    repositoryOwner: "openclaw",
    repositoryOwnerId: "2",
    workflowFilename: "plugin-clawhub-release.yml",
    workflowName: "Plugin ClawHub Release",
    workflowRef: `${value.repository}/${value.workflow}@${value.fullRef}`,
    runnerEnvironment: "github-hosted",
    eventName: "workflow_dispatch",
    sha: value.sha,
    ref: value.fullRef,
    runId: value.runId,
    runAttempt: value.runAttempt,
  };
}

function artifact(filename: string, value: unknown) {
  const bytes = zipSync({ [filename]: strToU8(JSON.stringify(value)) });
  return {
    bytes,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function requestUrl(input: string | URL | Request) {
  return input instanceof Request ? input.url : input instanceof URL ? input.href : input;
}

function githubFetch(options: {
  parentStatus?: string;
  parentConclusion?: string | null;
  childActor?: { login: string; type: string };
  parentReceipt?: Record<string, unknown>;
  recoveryReceipt?: Record<string, unknown>;
  omitParentArtifact?: boolean;
  parentArtifactChild?: { runId: string; runAttempt: string };
  omitRecoveryArtifact?: boolean;
}) {
  const value = identity();
  const parentName = parentAuthorizationArtifactName(
    parseOpenClawTrustedToolingIdentity(JSON.stringify(value)),
    options.parentArtifactChild,
  );
  const parent = artifact("authorization.json", options.parentReceipt ?? parentReceipt());
  const recovery = artifact("approval.json", options.recoveryReceipt ?? recoveryReceipt());
  return vi.fn(async (input: string | URL | Request) => {
    const url = requestUrl(input);
    if (url.includes(`/actions/runs/${value.runId}/attempts/${value.runAttempt}`)) {
      return Response.json({
        id: Number(value.runId),
        run_attempt: Number(value.runAttempt),
        path: value.workflow,
        head_branch: value.ref,
        head_sha: value.sha,
        event: "workflow_dispatch",
        status: "in_progress",
        conclusion: null,
        actor: options.childActor ?? { login: "github-actions[bot]", type: "Bot" },
        repository: { full_name: value.repository },
      });
    }
    if (url.includes(`/actions/runs/${value.parentRunId}/attempts/${value.parentRunAttempt}`)) {
      return Response.json({
        id: Number(value.parentRunId),
        run_attempt: Number(value.parentRunAttempt),
        path: value.parentWorkflow,
        head_branch: value.toolingRef,
        head_sha: value.toolingSha,
        event: "workflow_dispatch",
        status: options.parentStatus ?? "in_progress",
        conclusion: options.parentConclusion ?? null,
        repository: { full_name: value.parentRepository },
      });
    }
    if (url.includes(`/actions/runs/${value.parentRunId}/artifacts?`)) {
      if (options.omitParentArtifact || new URL(url).searchParams.get("name") !== parentName) {
        return Response.json({ total_count: 0, artifacts: [] });
      }
      return Response.json({
        total_count: 1,
        artifacts: [
          {
            id: 101,
            name: parentName,
            expired: false,
            digest: parent.digest,
            archive_download_url: "https://api.github.com/artifacts/101/zip",
            workflow_run: { id: Number(value.parentRunId), head_sha: value.toolingSha },
          },
        ],
      });
    }
    if (url.includes(`/actions/runs/${value.runId}/artifacts?`)) {
      if (options.omitRecoveryArtifact) return Response.json({ total_count: 0, artifacts: [] });
      return Response.json({
        total_count: 1,
        artifacts: [
          {
            id: 102,
            name: `openclaw-clawhub-recovery-approval-${value.runId}-${value.runAttempt}`,
            expired: false,
            digest: recovery.digest,
            archive_download_url: "https://api.github.com/artifacts/102/zip",
            workflow_run: { id: Number(value.runId), head_sha: value.sha },
          },
        ],
      });
    }
    if (url.endsWith("/artifacts/101/zip")) return new Response(parent.bytes);
    if (url.endsWith("/artifacts/102/zip")) return new Response(recovery.bytes);
    if (url.includes("/git/ref/tags/")) {
      return Response.json({
        ref: value.toolingFullRef,
        object: { type: "commit", sha: value.toolingSha },
      });
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
}

function recoveryFetch(options: Parameters<typeof githubFetch>[0] = {}) {
  return githubFetch({
    parentStatus: "completed",
    parentConclusion: "failure",
    childActor: { login: "release-maintainer", type: "User" },
    parentArtifactChild: originalChild,
    parentReceipt: parentReceipt({
      childRunId: originalChild.runId,
      childRunAttempt: originalChild.runAttempt,
    }),
    ...options,
  });
}

function verify(
  fetchImpl: typeof fetch,
  requiredParentState: "submission" | "terminal" = "submission",
  digest = inventoryDigest,
) {
  process.env.GITHUB_TOKEN = "test-token";
  return verifyOpenClawPublishAuthorization({
    rawIdentity: JSON.stringify(identity()),
    packageName: "@openclaw/demo-plugin",
    version: "1.0.0",
    inventoryDigest: digest,
    oidc: oidc(),
    requiredParentState,
    fetchImpl,
  });
}

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe("OpenClaw package publish authorization", () => {
  it("binds split-ref child tooling and frozen candidate identities", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const result = await verifyOpenClawPublishAuthorization({
      rawIdentity: JSON.stringify(identity()),
      packageName: "@openclaw/demo-plugin",
      version: "1.0.0",
      inventoryDigest,
      oidc: oidc(),
      fetchImpl: githubFetch({}),
    });

    expect(result.identity.sha).toBe(childSha);
    expect(result.identity.candidateSha).toBe(candidateSha);
    expect(result.authorizationRoute).toBe("automated-awaited");
    expect(result.transactionKey).toContain(candidateSha);
  });

  it("rejects a missing or moved parent receipt", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        fetchImpl: githubFetch({ omitParentArtifact: true }),
      }),
    ).rejects.toThrow("missing or ambiguous");
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        fetchImpl: githubFetch({ parentReceipt: parentReceipt({ childRunId: "9" }) }),
      }),
    ).rejects.toThrow("child run id mismatch");
  });

  it("rejects a parent cancelled after the local check but before server mint", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        fetchImpl: githubFetch({ parentStatus: "completed", parentConclusion: "cancelled" }),
      }),
    ).rejects.toThrow("not authorized");
  });

  it("withholds public finalization until an automated parent succeeds", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        requiredParentState: "terminal",
        fetchImpl: githubFetch({}),
      }),
    ).rejects.toThrow("public publication remains pending");

    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        requiredParentState: "terminal",
        fetchImpl: githubFetch({ parentStatus: "completed", parentConclusion: "success" }),
      }),
    ).resolves.toMatchObject({ authorizationRoute: "automated-awaited" });
  });

  it("terminally rejects cancellation before a staged release becomes public", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        requiredParentState: "terminal",
        fetchImpl: githubFetch({ parentStatus: "completed", parentConclusion: "cancelled" }),
      }),
    ).rejects.toThrow(
      "OpenClaw release parent terminal state completed/cancelled is not authorized",
    );
  });

  it("terminally rejects a failed automated parent without fetching recovery evidence", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const fetchImpl = githubFetch({
      parentStatus: "completed",
      parentConclusion: "failure",
      omitRecoveryArtifact: true,
    });
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        requiredParentState: "terminal",
        fetchImpl,
      }),
    ).rejects.toThrow(
      "OpenClaw release parent terminal state completed/failure is not authorized by automated-awaited",
    );
    expect(
      fetchImpl.mock.calls.some(([url]) => requestUrl(url).includes("recovery-approval")),
    ).toBe(false);
  });

  it.each([
    { login: "github-actions[bot]", type: "Bot" },
    { login: "release-service", type: "App" },
    { login: "release-app[bot]", type: "User" },
  ])("keeps automated actor $login on the parent route after failure", async (childActor) => {
    const fetchImpl = githubFetch({
      parentStatus: "completed",
      parentConclusion: "failure",
      childActor,
    });
    await expect(verify(fetchImpl)).rejects.toThrow(
      "release parent state completed/failure is not authorized by automated-awaited",
    );
    expect(
      fetchImpl.mock.calls.some(([url]) => requestUrl(url).includes("recovery-approval")),
    ).toBe(false);
  });

  it.each(["submission", "terminal"] as const)(
    "authorizes human recovery through the original bot child receipt in %s mode",
    async (mode) => {
      const fetchImpl = recoveryFetch();
      const result = await verify(fetchImpl, mode);
      expect(result).toMatchObject({ authorizationRoute: "explicit-recovery", artifactId: "101" });
      expect(result.artifactDigest).toBe(
        artifact(
          "authorization.json",
          parentReceipt({
            childRunId: originalChild.runId,
            childRunAttempt: originalChild.runAttempt,
          }),
        ).digest,
      );
      expect(result.transactionKey).toContain(`:${identity().runId}:${identity().runAttempt}:`);
      const requests = fetchImpl.mock.calls.map(([url]) => requestUrl(url));
      expect(requests.filter((url) => url.includes("/artifacts?"))).toEqual([
        expect.stringContaining(
          `openclaw-clawhub-recovery-approval-${identity().runId}-${identity().runAttempt}`,
        ),
        expect.stringContaining(
          parentAuthorizationArtifactName(
            parseOpenClawTrustedToolingIdentity(JSON.stringify(identity())),
            originalChild,
          ),
        ),
      ]);
    },
  );

  it("requires a human child's recovery artifact even while its parent is active", async () => {
    await expect(
      verify(
        recoveryFetch({
          parentStatus: "in_progress",
          parentConclusion: null,
          omitRecoveryArtifact: true,
        }),
      ),
    ).rejects.toThrow(
      "authorization artifact openclaw-clawhub-recovery-approval-32440000001-2 is missing or ambiguous",
    );
  });

  it("requires a parent artifact for the recovery receipt's authorized child", async () => {
    await expect(verify(recoveryFetch({ parentArtifactChild: identity() }))).rejects.toThrow(
      `authorization artifact openclaw-clawhub-parent-authorization-v2-${identity().parentRunId}-${identity().parentRunAttempt}-${originalChild.runId}-${originalChild.runAttempt} is missing or ambiguous`,
    );
  });

  it.each([
    [{ childHeadSha: "f".repeat(40) }, "child head SHA mismatch"],
    [{ childRef: "other", childFullRef: "refs/heads/other" }, "child ref mismatch"],
    [{ candidateSha: "f".repeat(40) }, "candidate SHA mismatch"],
    [{ toolingSha: "f".repeat(40) }, "receipt tooling SHA mismatch"],
  ])("preserves recovery parent bindings: %s", async (overrides, message) => {
    await expect(
      verify(
        recoveryFetch({
          parentReceipt: parentReceipt({
            childRunId: originalChild.runId,
            childRunAttempt: originalChild.runAttempt,
            ...overrides,
          }),
        }),
      ),
    ).rejects.toThrow(message);
  });

  it.each([
    [{ version: 1 }, "version must be 2"],
    [{ authorizedChildRunId: "0" }, "authorizedChildRunId is invalid"],
    [{ authorizedChildRunAttempt: "1.5" }, "authorizedChildRunAttempt is invalid"],
    [{ parentRunId: "999" }, "parent run id mismatch"],
    [{ parentRunAttempt: "4" }, "parent run attempt mismatch"],
    [{ actor: "other" }, "actor mismatch"],
    [{ environment: "other" }, "environment mismatch"],
    [{ approvalJob: "other" }, "approval job mismatch"],
    [{ workflow: ".github/workflows/other.yml" }, "workflow mismatch"],
    [{ repository: "other/repo" }, "repository mismatch"],
    [{ kind: "other" }, "kind mismatch"],
    [{ runId: "999" }, "run id mismatch"],
    [{ runAttempt: "4" }, "run attempt mismatch"],
    [{ authorizationRoute: "automated-awaited" }, "route mismatch"],
    [{ extra: true }, "must contain exactly"],
    [{ actor: "a".repeat(8192) }, "missing or too large"],
  ])("rejects invalid recovery approval: %s", async (overrides, message) => {
    await expect(
      verify(recoveryFetch({ recoveryReceipt: recoveryReceipt(overrides) })),
    ).rejects.toThrow(message);
  });

  it("terminally rejects cancelled parents on the recovery route", async () => {
    await expect(
      verify(recoveryFetch({ parentConclusion: "cancelled" }), "terminal"),
    ).rejects.toThrow(
      "OpenClaw release parent terminal state completed/cancelled is not authorized by explicit-recovery",
    );
  });

  it("rejects changed inventory on the recovery route", async () => {
    await expect(verify(recoveryFetch(), "terminal", "f".repeat(64))).rejects.toThrow(
      "one exact package transaction",
    );
  });

  it("rejects package transaction replay against another inventory", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest: "f".repeat(64),
        oidc: oidc(),
        fetchImpl: githubFetch({}),
      }),
    ).rejects.toThrow("one exact package transaction");
  });
});
