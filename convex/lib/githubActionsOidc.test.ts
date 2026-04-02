/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  extractWorkflowFilenameFromWorkflowRef,
  verifyGitHubActionsTrustedPublishJwt,
  type TrustedGitHubActionsPublisher,
} from "./githubActionsOidc";

const trustedPublisher: TrustedGitHubActionsPublisher = {
  repository: "openclaw/openclaw",
  repositoryId: "123456",
  repositoryOwner: "openclaw",
  repositoryOwnerId: "7890",
  workflowFilename: "plugin-clawhub-release.yml",
  environment: "clawhub-plugin-release",
};
const trustedPublisherWithoutEnvironment: TrustedGitHubActionsPublisher = {
  ...trustedPublisher,
  environment: undefined,
};
const signingKeyPairPromise = crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);

describe("extractWorkflowFilenameFromWorkflowRef", () => {
  it("extracts the workflow filename from workflow_ref", () => {
    expect(
      extractWorkflowFilenameFromWorkflowRef(
        "openclaw/openclaw/.github/workflows/plugin-clawhub-release.yml@refs/heads/main",
        "openclaw/openclaw",
      ),
    ).toBe("plugin-clawhub-release.yml");
  });
});

describe("verifyGitHubActionsTrustedPublishJwt", () => {
  it("accepts a valid GitHub Actions token", async () => {
    const { token, jwks } = await createSignedToken({
      repository: trustedPublisher.repository,
      repository_id: trustedPublisher.repositoryId,
      repository_owner: trustedPublisher.repositoryOwner,
      repository_owner_id: trustedPublisher.repositoryOwnerId,
      workflow_ref:
        "openclaw/openclaw/.github/workflows/plugin-clawhub-release.yml@refs/heads/main",
      runner_environment: "github-hosted",
      environment: trustedPublisher.environment,
      event_name: "workflow_dispatch",
      workflow: "Plugin ClawHub Release",
      sha: "deadbeef",
      ref: "refs/heads/main",
      ref_type: "branch",
      actor: "onur",
      actor_id: "42",
      run_id: "100",
      run_attempt: "2",
      iss: "https://token.actions.githubusercontent.com",
      aud: "clawhub",
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000) - 5,
    });

    const identity = await verifyGitHubActionsTrustedPublishJwt(token, trustedPublisher, {
      fetchImpl: async () =>
        new Response(JSON.stringify({ keys: [jwks] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(identity).toMatchObject({
      repository: trustedPublisher.repository,
      repositoryId: trustedPublisher.repositoryId,
      repositoryOwner: trustedPublisher.repositoryOwner,
      repositoryOwnerId: trustedPublisher.repositoryOwnerId,
      workflowFilename: trustedPublisher.workflowFilename,
      environment: trustedPublisher.environment,
      runId: "100",
      runAttempt: "2",
      sha: "deadbeef",
    });
  });

  it("accepts a valid GitHub Actions token when no environment is pinned", async () => {
    const { token, jwks } = await createSignedToken({
      repository: trustedPublisher.repository,
      repository_id: trustedPublisher.repositoryId,
      repository_owner: trustedPublisher.repositoryOwner,
      repository_owner_id: trustedPublisher.repositoryOwnerId,
      workflow_ref:
        "openclaw/openclaw/.github/workflows/plugin-clawhub-release.yml@refs/heads/main",
      runner_environment: "github-hosted",
      event_name: "workflow_dispatch",
      workflow: "Plugin ClawHub Release",
      sha: "deadbeef",
      ref: "refs/heads/main",
      ref_type: "branch",
      actor: "onur",
      actor_id: "42",
      run_id: "100",
      run_attempt: "2",
      iss: "https://token.actions.githubusercontent.com",
      aud: "clawhub",
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000) - 5,
    });

    const identity = await verifyGitHubActionsTrustedPublishJwt(token, trustedPublisherWithoutEnvironment, {
      fetchImpl: async () =>
        new Response(JSON.stringify({ keys: [jwks] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(identity).toMatchObject({
      repository: trustedPublisher.repository,
      repositoryId: trustedPublisher.repositoryId,
      repositoryOwner: trustedPublisher.repositoryOwner,
      repositoryOwnerId: trustedPublisher.repositoryOwnerId,
      workflowFilename: trustedPublisher.workflowFilename,
      runId: "100",
      runAttempt: "2",
      sha: "deadbeef",
    });
    expect(identity.environment).toBeUndefined();
  });

  it("rejects reusable workflow tokens", async () => {
    const { token, jwks } = await createSignedToken({
      repository: trustedPublisher.repository,
      repository_id: trustedPublisher.repositoryId,
      repository_owner: trustedPublisher.repositoryOwner,
      repository_owner_id: trustedPublisher.repositoryOwnerId,
      workflow_ref:
        "openclaw/openclaw/.github/workflows/plugin-clawhub-release.yml@refs/heads/main",
      job_workflow_ref:
        "openclaw/shared/.github/workflows/reusable-plugin-release.yml@refs/heads/main",
      runner_environment: "github-hosted",
      environment: trustedPublisher.environment,
      event_name: "workflow_dispatch",
      workflow: "Plugin ClawHub Release",
      sha: "deadbeef",
      ref: "refs/heads/main",
      run_id: "100",
      run_attempt: "1",
      iss: "https://token.actions.githubusercontent.com",
      aud: "clawhub",
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000) - 5,
    });

    await expect(
      verifyGitHubActionsTrustedPublishJwt(token, trustedPublisher, {
        fetchImpl: async () =>
        new Response(JSON.stringify({ keys: [jwks] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      }),
    ).rejects.toThrow("Only the official ClawHub reusable workflow is supported");
  });

  it("accepts the official ClawHub reusable workflow", async () => {
    const { token, jwks } = await createSignedToken({
      repository: trustedPublisher.repository,
      repository_id: trustedPublisher.repositoryId,
      repository_owner: trustedPublisher.repositoryOwner,
      repository_owner_id: trustedPublisher.repositoryOwnerId,
      workflow_ref:
        "openclaw/openclaw/.github/workflows/plugin-clawhub-release.yml@refs/heads/main",
      job_workflow_ref: "openclaw/clawhub/.github/workflows/package-publish.yml@refs/heads/main",
      runner_environment: "github-hosted",
      environment: trustedPublisher.environment,
      event_name: "workflow_dispatch",
      workflow: "Plugin ClawHub Release",
      sha: "deadbeef",
      ref: "refs/heads/main",
      run_id: "100",
      run_attempt: "1",
      iss: "https://token.actions.githubusercontent.com",
      aud: "clawhub",
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000) - 5,
    });

    await expect(
      verifyGitHubActionsTrustedPublishJwt(token, trustedPublisher, {
        fetchImpl: async () =>
          new Response(JSON.stringify({ keys: [jwks] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).resolves.toMatchObject({
      repository: trustedPublisher.repository,
      workflowFilename: trustedPublisher.workflowFilename,
      jobWorkflowRef: "openclaw/clawhub/.github/workflows/package-publish.yml@refs/heads/main",
    });
  });

  it("rejects environment mismatches", async () => {
    const { token, jwks } = await createSignedToken({
      repository: trustedPublisher.repository,
      repository_id: trustedPublisher.repositoryId,
      repository_owner: trustedPublisher.repositoryOwner,
      repository_owner_id: trustedPublisher.repositoryOwnerId,
      workflow_ref:
        "openclaw/openclaw/.github/workflows/plugin-clawhub-release.yml@refs/heads/main",
      runner_environment: "github-hosted",
      environment: "other-environment",
      event_name: "workflow_dispatch",
      workflow: "Plugin ClawHub Release",
      sha: "deadbeef",
      ref: "refs/heads/main",
      run_id: "100",
      run_attempt: "1",
      iss: "https://token.actions.githubusercontent.com",
      aud: "clawhub",
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000) - 5,
    });

    await expect(
      verifyGitHubActionsTrustedPublishJwt(token, trustedPublisher, {
        fetchImpl: async () =>
          new Response(JSON.stringify({ keys: [jwks] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toThrow("GitHub OIDC environment mismatch");
  });

  it("refreshes JWKS on signing-key cache misses", async () => {
    const now = Date.now() + 10 * 60_000;
    const { token, jwks } = await createSignedToken(
      {
        repository: trustedPublisher.repository,
        repository_id: trustedPublisher.repositoryId,
        repository_owner: trustedPublisher.repositoryOwner,
        repository_owner_id: trustedPublisher.repositoryOwnerId,
        workflow_ref:
          "openclaw/openclaw/.github/workflows/plugin-clawhub-release.yml@refs/heads/main",
        runner_environment: "github-hosted",
        environment: trustedPublisher.environment,
        event_name: "workflow_dispatch",
        workflow: "Plugin ClawHub Release",
        sha: "deadbeef",
        ref: "refs/heads/main",
        ref_type: "branch",
        actor: "onur",
        actor_id: "42",
        run_id: "100",
        run_attempt: "2",
        iss: "https://token.actions.githubusercontent.com",
        aud: "clawhub",
        exp: Math.floor(now / 1000) + 300,
        iat: Math.floor(now / 1000) - 5,
      },
      "rotated-key",
    );
    const staleJwk = { ...jwks, kid: "stale-key" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [staleJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [jwks] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(
      verifyGitHubActionsTrustedPublishJwt(token, trustedPublisher, {
        fetchImpl: fetchMock,
        now: () => now,
      }),
    ).resolves.toMatchObject({
      repository: trustedPublisher.repository,
      workflowFilename: trustedPublisher.workflowFilename,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

async function createSignedToken(payload: Record<string, unknown>, kid = "test-key") {
  const keyPair = await signingKeyPairPromise;
  const header = { alg: "RS256", kid, typ: "JWT" };
  const encodedHeader = base64UrlEncodeJson(header);
  const encodedPayload = base64UrlEncodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput)),
  );
  const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & {
    kid?: string;
  };
  publicJwk.kid = kid;
  return {
    token: `${signingInput}.${base64UrlEncodeBytes(signature)}`,
    jwks: publicJwk,
  };
}

function base64UrlEncodeJson(value: unknown) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
