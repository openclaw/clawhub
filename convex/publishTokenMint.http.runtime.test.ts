/// <reference types="vite/client" />
/* @vitest-environment node */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { mintPublishTokenV1Handler } from "./httpApiV1/packagesV1";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const rejection =
  "Publish token request could not be verified. Ask a package manager to check the trusted-publisher configuration and the workflow's GitHub Actions OIDC claims.";

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

async function postMint(
  t: ReturnType<typeof convexTest>,
  packageName: string,
  token = "not-a-jwt",
) {
  const { status, body } = await postMintWithHeaders(t, packageName, token);
  return { status, body };
}

async function postMintWithHeaders(
  t: ReturnType<typeof convexTest>,
  packageName: string,
  token: string,
) {
  return await t.action(async (ctx) => {
    const response = await mintPublishTokenV1Handler(
      ctx as unknown as ActionCtx,
      new Request("https://example.com/api/v1/publish/token/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageName,
          version: "1.0.0",
          githubOidcToken: token,
        }),
      }),
    );
    return {
      status: response.status,
      body: await response.text(),
      retryAfter: response.headers.get("Retry-After"),
    };
  });
}

describe("publish token mint through the real Convex handler", () => {
  it("uses one rejection for a missing name, a hidden package, and a bad OIDC token", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiterV2");
    const ownerUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { handle: "secret-owner" });
    });
    const hiddenId = await insertPackage(t, ownerUserId, {
      name: "secret-plugin",
      channel: "private",
      scanStatus: "malicious",
    });
    await insertPackage(t, ownerUserId, {
      name: "configured-plugin",
      channel: "private",
      scanStatus: "clean",
    });
    const configuredId = await t.run(async (ctx) => {
      const pkg = await ctx.db
        .query("packages")
        .filter((q) => q.eq(q.field("name"), "configured-plugin"))
        .unique();
      if (!pkg) throw new Error("missing configured package");
      await ctx.db.insert("packageTrustedPublishers", {
        packageId: pkg._id,
        provider: "github-actions",
        repository: "private/secret",
        repositoryId: "91",
        repositoryOwner: "private",
        repositoryOwnerId: "92",
        workflowFilename: "release.yml",
        createdByUserId: ownerUserId,
        updatedByUserId: ownerUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      return pkg._id;
    });

    const missing = await postMint(t, "missing-plugin");
    const hidden = await postMint(t, "secret-plugin");
    const badToken = await postMint(t, "configured-plugin", "not-a-jwt");

    expect(missing).toEqual({ status: 400, body: rejection });
    expect(hidden).toEqual(missing);
    expect(badToken).toEqual(missing);
    expect(badToken.body).not.toContain("private/secret");
    expect(badToken.body).not.toContain("not-a-jwt");

    const audit = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditLogs")
        .filter((q) => q.eq(q.field("targetId"), String(configuredId)))
        .collect();
    });
    expect(audit.some((entry) => entry.action === "package.publish_token.mint_rejected")).toBe(
      true,
    );
    expect(hiddenId).toBeTruthy();
    expect(configuredId).not.toBe(hiddenId);
  });
});

describe("publish token mint verifier failures through the real handler and verifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one rejection and an audit record when token text imitates a platform error", async () => {
    const { t, configuredId } = await setupConfiguredPackage();
    const { jwk } = await signToken(matchingClaims(), "imitation-key");
    stubJwksFetch(async () => Response.json({ keys: [jwk] }));

    // Neither of the first two tokens is signed: anyone can send them.
    const imitations = [
      {
        token: unsignedToken({
          alg: "InternalServerError: Your request couldn't be completed. Try again later.",
        }),
        reason:
          "Unsupported GitHub OIDC signing algorithm: InternalServerError: Your request couldn't be completed. Try again later.",
      },
      {
        token: unsignedToken({ alg: "RS256", kid: "Transient error while executing action" }),
        reason: "Unknown GitHub OIDC signing key: Transient error while executing action",
      },
      {
        // GitHub signs whatever audience the workflow asks for.
        token: (await signToken({ ...matchingClaims(), aud: "write conflict" }, "imitation-key"))
          .token,
        reason: "Unexpected GitHub OIDC audience: write conflict",
      },
    ];

    const missing = await postMintWithHeaders(t, "missing-plugin", imitations[0]!.token);
    expect(missing).toEqual({ status: 400, body: rejection, retryAfter: null });
    for (const imitation of imitations) {
      expect(await postMintWithHeaders(t, "configured-plugin", imitation.token)).toEqual(missing);
    }

    expect(await rejectionReasons(t, configuredId)).toEqual(
      imitations.map((imitation) => imitation.reason),
    );
  });

  it("stores a bounded audit reason for an oversized unsigned token", async () => {
    const { t, configuredId } = await setupConfiguredPackage();

    const result = await postMintWithHeaders(
      t,
      "configured-plugin",
      unsignedToken({ alg: `oversized\ud800${"x".repeat(2_000_000)}` }),
    );

    expect(result).toEqual({ status: 400, body: rejection, retryAfter: null });
    const reasons = await rejectionReasons(t, configuredId);
    expect(reasons).toEqual([
      `${`Unsupported GitHub OIDC signing algorithm: oversized\ufffd${"x".repeat(2_000_000)}`.slice(0, 1000)}…`,
    ]);
  });

  it("answers a retryable 503 for a signing-key outage, then mints once the keys load", async () => {
    const { t, configuredId } = await setupConfiguredPackage();
    // A key id no earlier test cached, so the verifier must fetch the keys.
    const { token, jwk } = await signToken(matchingClaims(), "outage-key");

    for (const outage of [
      async () => new Response("unavailable", { status: 503 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("<html>bad gateway</html>", { status: 200 }),
    ]) {
      stubJwksFetch(outage);
      expect(await postMintWithHeaders(t, "configured-plugin", token)).toEqual({
        status: 503,
        body: "GitHub Actions OIDC signing keys are temporarily unavailable. The request was not rejected for validation; retrying usually succeeds.",
        retryAfter: "2",
      });
    }
    expect(await rejectionReasons(t, configuredId)).toEqual([]);

    stubJwksFetch(async () => Response.json({ keys: [jwk] }));
    const minted = await postMintWithHeaders(t, "configured-plugin", token);
    expect(minted.status).toBe(200);
    expect(JSON.parse(minted.body)).toEqual({
      token: expect.any(String),
      expiresAt: expect.any(Number),
    });
    const actions = await t.run(async (ctx) => {
      const entries = await ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) =>
          q.eq("targetType", "package").eq("targetId", String(configuredId)),
        )
        .take(10);
      return entries.map((entry) => entry.action);
    });
    expect(actions).toEqual(["package.publish_token.mint"]);
  });
});

async function setupConfiguredPackage() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const ownerUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { handle: "secret-owner" });
  });
  const configuredId = await insertPackage(t, ownerUserId, {
    name: "configured-plugin",
    channel: "private",
    scanStatus: "clean",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("packageTrustedPublishers", {
      packageId: configuredId,
      provider: "github-actions",
      repository: "private/secret",
      repositoryId: "91",
      repositoryOwner: "private",
      repositoryOwnerId: "92",
      workflowFilename: "release.yml",
      createdByUserId: ownerUserId,
      updatedByUserId: ownerUserId,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return { t, configuredId };
}

async function rejectionReasons(
  // Keeps the schema's index types, which `ReturnType<typeof convexTest>` drops.
  t: Awaited<ReturnType<typeof setupConfiguredPackage>>["t"],
  packageId: Id<"packages">,
) {
  return await t.run(async (ctx) => {
    const entries = await ctx.db
      .query("auditLogs")
      .withIndex("by_target_action", (q) =>
        q
          .eq("targetType", "package")
          .eq("targetId", String(packageId))
          .eq("action", "package.publish_token.mint_rejected"),
      )
      .take(10);
    return entries.map((entry) => (entry.metadata as { reason?: unknown }).reason);
  });
}

function stubJwksFetch(respond: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBe("https://token.actions.githubusercontent.com/.well-known/jwks");
      return await respond();
    }),
  );
}

// Claims GitHub would sign for the workflow the configured package trusts.
function matchingClaims() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    iss: "https://token.actions.githubusercontent.com",
    aud: "clawhub",
    exp: nowSeconds + 300,
    iat: nowSeconds - 5,
    repository: "private/secret",
    repository_id: "91",
    repository_owner: "private",
    repository_owner_id: "92",
    workflow_ref: "private/secret/.github/workflows/release.yml@refs/heads/main",
    runner_environment: "github-hosted",
    event_name: "workflow_dispatch",
    workflow: "Release",
    sha: "deadbeef",
    ref: "refs/heads/main",
    ref_type: "branch",
    actor: "release-bot",
    actor_id: "42",
    run_id: "100",
    run_attempt: "1",
  };
}

function unsignedToken(header: Record<string, unknown>) {
  return `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson({})}.AAAA`;
}

async function signToken(payload: Record<string, unknown>, kid: string) {
  const keyPair = await signingKeyPairPromise;
  const signingInput = `${base64UrlEncodeJson({ alg: "RS256", kid, typ: "JWT" })}.${base64UrlEncodeJson(payload)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  const jwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & {
    kid?: string;
  };
  jwk.kid = kid;
  return { token: `${signingInput}.${base64UrlEncodeBytes(signature)}`, jwk };
}

function base64UrlEncodeJson(value: unknown) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function insertPackage(
  t: ReturnType<typeof convexTest>,
  ownerUserId: Id<"users">,
  options: { name: string; channel: "private"; scanStatus: "clean" | "malicious" },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("packages", {
      name: options.name,
      normalizedName: options.name,
      displayName: options.name,
      ownerUserId,
      family: "code-plugin",
      channel: options.channel,
      isOfficial: false,
      scanStatus: options.scanStatus,
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
  });
}
