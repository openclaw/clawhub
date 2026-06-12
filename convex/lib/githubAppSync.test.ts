import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildGitHubAppInstallUrl,
  createGitHubAppJwt,
  deriveSlugFromCandidatePath,
  hashGitHubAppState,
  isPathUnderAnyRoot,
  normalizeGitHubRepoFullName,
  normalizeGitHubSyncRoots,
  signGitHubAppState,
  sourceLinkMatchesProvenance,
  verifyGitHubAppState,
  verifyGitHubWebhookSignature,
} from "./githubAppSync";

describe("github app sync helpers", () => {
  it("normalizes repository identity and sync roots", () => {
    expect(normalizeGitHubRepoFullName("https://github.com/OpenClaw/Skills.git")).toBe(
      "OpenClaw/Skills",
    );
    expect(normalizeGitHubRepoFullName("git+https://github.com/OpenClaw/Skills.git")).toBe(
      "OpenClaw/Skills",
    );
    expect(normalizeGitHubRepoFullName("git@github.com:OpenClaw/Skills.git")).toBe(
      "OpenClaw/Skills",
    );
    expect(normalizeGitHubRepoFullName("https://www.github.com/OpenClaw/Skills/tree/main")).toBe(
      "OpenClaw/Skills",
    );
    expect(normalizeGitHubRepoFullName("not a repo")).toBeNull();
    expect(isPathUnderAnyRoot("skills/demo/SKILL.md", ["skills"])).toBe(true);
    expect(isPathUnderAnyRoot("packages/demo/package.json", ["skills"])).toBe(false);
    expect(normalizeGitHubSyncRoots(["", "skills/demo"])).toEqual(["", "skills/demo"]);
    expect(() => normalizeGitHubSyncRoots(["../skills"])).toThrow(/Invalid sync root/);
  });

  it("derives stable skill slugs from candidate paths", () => {
    expect(deriveSlugFromCandidatePath("skills/Demo Skill", "OpenClaw/catalog")).toBe("demo-skill");
    expect(deriveSlugFromCandidatePath("", "OpenClaw/Catalog Repo")).toBe("catalog-repo");
  });

  it("signs setup state, verifies it, and rejects tampering", async () => {
    const secret = "state-secret";
    const state = await signGitHubAppState(
      {
        publisherId: "publishers:org",
        requestedByUserId: "users:admin",
        nonce: "nonce",
        targetAccountId: "12345",
        exp: 2_000,
      },
      secret,
      1_000,
    );
    await expect(hashGitHubAppState(state)).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyGitHubAppState(state, secret, 1_500)).resolves.toEqual({
      publisherId: "publishers:org",
      requestedByUserId: "users:admin",
      nonce: "nonce",
      targetAccountId: "12345",
      exp: 2_000,
    });
    await expect(verifyGitHubAppState(`${state}x`, secret, 1_500)).rejects.toThrow(
      /Invalid GitHub setup state/,
    );
    await expect(verifyGitHubAppState(state, secret, 2_001)).rejects.toThrow(
      /GitHub setup state expired/,
    );
  });

  it("builds the app install URL with signed state", () => {
    const url = buildGitHubAppInstallUrl({
      appSlug: "clawhub-test",
      state: "signed-state",
      targetId: "123",
    });
    expect(url).toBe(
      "https://github.com/apps/clawhub-test/installations/new?state=signed-state&target_id=123",
    );
  });

  it("creates app JWTs from PKCS#8 and GitHub-style PKCS#1 RSA private keys", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const pkcs1Pem = privateKey.export({ type: "pkcs1", format: "pem" });

    await expect(
      createGitHubAppJwt({ appId: "12345", privateKeyPem: pkcs8Pem, now: 1_700_000_000_000 }),
    ).resolves.toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    await expect(
      createGitHubAppJwt({ appId: "12345", privateKeyPem: pkcs1Pem, now: 1_700_000_000_000 }),
    ).resolves.toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
  });

  it("verifies webhook signatures and rejects bad signatures", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ zen: "Keep it logically awesome." }));
    const signature = await buildGitHubWebhookSignature(body, "webhook-secret");
    await expect(
      verifyGitHubWebhookSignature({
        body: body.buffer as ArrayBuffer,
        signatureHeader: signature,
        secret: "webhook-secret",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      verifyGitHubWebhookSignature({
        body: body.buffer as ArrayBuffer,
        signatureHeader: signature,
        secret: "wrong-secret",
      }),
    ).resolves.toEqual({ ok: false, reason: "bad-signature" });
  });

  it("requires exact source sync context for source-managed publishes", () => {
    const link = {
      repoFullName: "OpenClaw/catalog",
      path: "skills/demo",
      status: "active",
    };
    const sourceProvenance = {
      kind: "github" as const,
      repo: "openclaw/catalog",
      path: "skills/demo",
    };
    expect(
      sourceLinkMatchesProvenance({
        link,
        sourceProvenance,
        sourceSync: { sourceLinkId: "skillSourceLinks:1" },
        expectedSourceLinkId: "skillSourceLinks:1",
      }),
    ).toBe(true);
    expect(
      sourceLinkMatchesProvenance({
        link: { ...link, status: "conflict" },
        sourceProvenance,
        sourceSync: { sourceLinkId: "skillSourceLinks:1" },
        expectedSourceLinkId: "skillSourceLinks:1",
      }),
    ).toBe(true);
    expect(
      sourceLinkMatchesProvenance({
        link: { ...link, status: "disabled" },
        sourceProvenance,
        sourceSync: { sourceLinkId: "skillSourceLinks:1" },
        expectedSourceLinkId: "skillSourceLinks:1",
      }),
    ).toBe(false);
    expect(
      sourceLinkMatchesProvenance({
        link,
        sourceProvenance,
        sourceSync: undefined,
        expectedSourceLinkId: "skillSourceLinks:1",
      }),
    ).toBe(false);
    expect(
      sourceLinkMatchesProvenance({
        link,
        sourceProvenance: { ...sourceProvenance, path: "skills/other" },
        sourceSync: { sourceLinkId: "skillSourceLinks:1" },
        expectedSourceLinkId: "skillSourceLinks:1",
      }),
    ).toBe(false);
  });
});

async function buildGitHubWebhookSignature(body: Uint8Array, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, body.buffer as ArrayBuffer);
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0"));
  return `sha256=${hex.join("")}`;
}
