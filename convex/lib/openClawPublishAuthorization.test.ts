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

function recoveryReceipt() {
  const value = identity();
  return {
    version: 1,
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

function githubFetch(options: {
  parentStatus?: string;
  parentConclusion?: string | null;
  childActor?: { login: string; type: string };
  parentReceipt?: Record<string, unknown>;
  recoveryReceipt?: Record<string, unknown>;
  omitParentArtifact?: boolean;
}) {
  const value = identity();
  const parent = artifact("authorization.json", options.parentReceipt ?? parentReceipt());
  const recovery = artifact("approval.json", options.recoveryReceipt ?? recoveryReceipt());
  return vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
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
      if (options.omitParentArtifact) return Response.json({ total_count: 0, artifacts: [] });
      return Response.json({
        total_count: 1,
        artifacts: [
          {
            id: 101,
            name: parentAuthorizationArtifactName(
              parseOpenClawTrustedToolingIdentity(JSON.stringify(value)),
            ),
            expired: false,
            digest: parent.digest,
            archive_download_url: "https://api.github.com/artifacts/101/zip",
            workflow_run: { id: Number(value.parentRunId), head_sha: value.toolingSha },
          },
        ],
      });
    }
    if (url.includes(`/actions/runs/${value.runId}/artifacts?`)) {
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

  it("rejects GitHub App and bot-suffixed recovery actors", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        fetchImpl: githubFetch({
          parentStatus: "completed",
          parentConclusion: "failure",
          childActor: { login: "release-service", type: "App" },
          recoveryReceipt: recoveryReceipt(),
        }),
      }),
    ).rejects.toThrow("cannot use release recovery");
    await expect(
      verifyOpenClawPublishAuthorization({
        rawIdentity: JSON.stringify(identity()),
        packageName: "@openclaw/demo-plugin",
        version: "1.0.0",
        inventoryDigest,
        oidc: oidc(),
        fetchImpl: githubFetch({
          parentStatus: "completed",
          parentConclusion: "failure",
          childActor: { login: "release-app[bot]", type: "User" },
          recoveryReceipt: recoveryReceipt(),
        }),
      }),
    ).rejects.toThrow("cannot use release recovery");
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
