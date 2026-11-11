/// <reference types="vite/client" />
/* @vitest-environment node */
import { generateKeyPairSync } from "node:crypto";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const commit = "e0dd6d1cc1f2e88722a2837fa58f3259e153352c";
const url = "https://github.com/maximskorohod/agentkeygate/tree/main/skills/agentkeygate-mcp";
const skillPath = "skills/agentkeygate-mcp/SKILL.md";
const skillMarkdown = [
  "---",
  "name: AgentKeyGate",
  "description: Authorize MCP actions through an owner-controlled gateway.",
  "---",
  "# AgentKeyGate",
  "## Setup",
  "Connect your MCP client to the gateway configured by its owner. Request a scoped pass before invoking a third-party API. Describe the intended operation, destination, duration, and call budget so the owner can make an informed decision.",
  "- Keep provider credentials inside the gateway; never copy them into a conversation.",
  "- Wait for explicit approval before sending requests that modify customer records.",
  "- Stop when a pass expires or is revoked instead of silently requesting broader access.",
  "## Recovery",
  "If authorization is denied, explain which operation remains blocked and ask the owner to review the scope. Inspect the returned status without exposing tokens, private response bodies, or internal infrastructure details.",
].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setupImportFixture(
  commitStatus?: number | "network" | "invalid-json" | "invalid-sha",
  repo = { private: false, ownerId: 123 },
  rateLimitRemaining = "0",
) {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { handle: "maximskorohod", githubCreatedAt: 1 });
    await ctx.db.insert("authAccounts", {
      userId: id,
      provider: "github",
      providerAccountId: "123",
    });
    return id;
  });
  const caller = t.withIdentity({ subject: userId });
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GITHUB_APP_ID", "4476");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "4476");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey);
  const anonymousCommitRequests: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (target.endsWith("/access_tokens"))
      return Response.json({
        token: "fixture-installation-token",
        expires_at: "2099-01-01T00:00:00Z",
      });
    if (target.endsWith("/commits/main") && commitStatus) {
      if (commitStatus === "network") throw new Error("private-network-secret");
      if (commitStatus === "invalid-json") return new Response("upstream-private-secret");
      if (commitStatus === "invalid-sha") return Response.json({ sha: "upstream-private-secret" });
      return Response.json(
        { message: "upstream-private-secret" },
        {
          status: commitStatus,
          headers: { "x-ratelimit-remaining": rateLimitRemaining },
        },
      );
    }
    const authenticated =
      new Headers(init?.headers).get("authorization") === "Bearer fixture-installation-token";
    if (target.endsWith("/commits/main") && !authenticated) {
      anonymousCommitRequests.push(target);
      return Response.json(
        { message: "API rate limit exceeded for fixture" },
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        },
      );
    }
    if (!authenticated) throw new Error("Unexpected anonymous request");
    if (target.endsWith("/user/123")) return Response.json({ id: 123, login: "maximskorohod" });
    if (target.endsWith("/repos/maximskorohod/agentkeygate"))
      return Response.json({
        private: repo.private,
        visibility: repo.private ? "private" : "public",
        owner: { id: repo.ownerId, login: "maximskorohod" },
      });
    if (target.endsWith("/commits/main")) return Response.json({ sha: commit });
    if (target.includes("/git/trees/"))
      return Response.json({
        tree: [{ type: "blob", path: skillPath, sha: "b".repeat(40), size: 80 }],
      });
    if (target.includes("/git/blobs/")) return new Response(skillMarkdown);
    throw new Error("Unexpected GitHub request: " + target);
  });
  return { t, caller, anonymousCommitRequests };
}

const importArgs = {
  url,
  commit,
  candidatePath: "skills/agentkeygate-mcp",
  selectedPaths: [skillPath],
  slug: "agentkeygate-mcp",
  displayName: "AgentKeyGate",
  version: "0.1.0",
  tags: ["latest"],
  ownerHandle: "maximskorohod",
  acceptLicenseTerms: true,
};

it("previews and stages an owned nested skill with App auth when the anonymous commit quota is exhausted", async () => {
  const { t, caller, anonymousCommitRequests } = await setupImportFixture();
  const preview = await caller.action(api.githubImport.previewGitHubImportCandidate, {
    url,
    candidatePath: "skills/agentkeygate-mcp",
  });
  expect(preview.resolved.commit).toBe(commit);
  expect(preview.defaults.selectedPaths).toEqual([skillPath]);
  const imported = await caller.action(api.githubImport.importGitHubSkill, {
    url,
    commit: preview.resolved.commit,
    candidatePath: preview.candidate.path,
    selectedPaths: preview.defaults.selectedPaths,
    slug: "agentkeygate-mcp",
    displayName: "AgentKeyGate",
    version: "0.1.0",
    tags: ["latest"],
    ownerHandle: "maximskorohod",
    acceptLicenseTerms: true,
  });
  expect(imported).toMatchObject({
    slug: "agentkeygate-mcp",
    status: "pending",
    publicationStatus: "pending",
  });
  expect(
    await t.query(api.skills.getBySlug, { slug: "agentkeygate-mcp", ownerHandle: "maximskorohod" }),
  ).toBeNull();
  const version = await t.run((ctx) => ctx.db.get(imported.versionId));
  expect(version?.parsed.metadata?.source).toMatchObject({
    kind: "github",
    repo: "maximskorohod/agentkeygate",
    commit,
    path: "skills/agentkeygate-mcp",
  });
  expect(anonymousCommitRequests).toEqual([]);
});

const commitFailures = [
  [
    403,
    "GitHub API rate limit exceeded. Wait a few minutes, then try again; your selections are kept.",
  ],
  [
    404,
    "GitHub branch or commit was not found. Return to Select skills and refresh your repositories.",
  ],
  [
    429,
    "GitHub API rate limit exceeded. Wait a few minutes, then try again; your selections are kept.",
  ],
  [
    401,
    "GitHub authentication is temporarily unavailable. Try again later or contact ClawHub support.",
  ],
  [
    422,
    "GitHub branch or commit was not found. Return to Select skills and refresh your repositories.",
  ],
  [503, "GitHub is temporarily unavailable. Try again; your selections are kept."],
  ["network", "Could not reach GitHub. Try again; your selections are kept."],
  [
    "invalid-json",
    "GitHub returned an invalid commit. Try previewing again; your selections are kept.",
  ],
  [
    "invalid-sha",
    "GitHub returned an invalid commit. Try previewing again; your selections are kept.",
  ],
] as const;

it.each(commitFailures)(
  "returns a safe actionable %s error from preview and import",
  async (status, message) => {
    const { caller } = await setupImportFixture(status);
    await expect(
      caller.action(api.githubImport.previewGitHubImportCandidate, {
        url,
        candidatePath: "skills/agentkeygate-mcp",
      }),
    ).rejects.toMatchObject({ data: message });
    await expect(
      caller.action(api.githubImport.importGitHubSkill, importArgs),
    ).rejects.toMatchObject({ data: message });
  },
);

it("does not mislabel a forbidden request as rate limiting when quota remains", async () => {
  const { caller } = await setupImportFixture(403, undefined, "60");
  const expected = {
    data: "GitHub authentication is temporarily unavailable. Try again later or contact ClawHub support.",
  };
  await expect(
    caller.action(api.githubImport.previewGitHubImportCandidate, {
      url,
      candidatePath: "skills/agentkeygate-mcp",
    }),
  ).rejects.toMatchObject(expected);
  await expect(caller.action(api.githubImport.importGitHubSkill, importArgs)).rejects.toMatchObject(
    expected,
  );
});

it.each([
  { private: true, ownerId: 123 },
  { private: false, ownerId: 456 },
])("still rejects non-owned/non-public repository %j", async (repo) => {
  const { caller } = await setupImportFixture(undefined, repo);
  await expect(
    caller.action(api.githubImport.previewGitHubImportCandidate, {
      url,
      candidatePath: "skills/agentkeygate-mcp",
    }),
  ).rejects.toThrow(/only import public repositories owned/);
  await expect(caller.action(api.githubImport.importGitHubSkill, importArgs)).rejects.toThrow(
    /only import public repositories owned/,
  );
});

it("keeps authentication, license, source-freshness, and publisher-authorization gates", async () => {
  const { t, caller } = await setupImportFixture();
  await expect(
    t.action(api.githubImport.previewGitHubImportCandidate, {
      url,
      candidatePath: "skills/agentkeygate-mcp",
    }),
  ).rejects.toThrow(/Unauthorized/);
  await expect(
    caller.action(api.githubImport.importGitHubSkill, {
      ...importArgs,
      acceptLicenseTerms: false,
    }),
  ).rejects.toThrow(/license terms must be accepted/);
  await expect(
    caller.action(api.githubImport.importGitHubSkill, {
      ...importArgs,
      commit: "a".repeat(40),
    }),
  ).rejects.toThrow(/out of date/);
  await t.run((ctx) =>
    ctx.db.insert("publishers", {
      kind: "org",
      handle: "another-publisher",
      displayName: "Another Publisher",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await expect(
    caller.action(api.githubImport.importGitHubSkill, {
      ...importArgs,
      ownerHandle: "another-publisher",
    }),
  ).rejects.toThrow(/do not have publish access/);
});
