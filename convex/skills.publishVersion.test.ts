import { getAuthUserId } from "@convex-dev/auth/server";
import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { generateEmbedding } from "./lib/embeddings";
import { publishVersion } from "./skills";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/embeddings")>()),
  generateEmbedding: vi.fn(async () => [0, 1, 2]),
}));

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const publishVersionHandler = (
  publishVersion as unknown as WrappedHandler<Record<string, unknown>, unknown>
)._handler;

const skillMarkdown = [
  "---",
  "name: Release Notes Helper",
  "description: Drafts release notes from merged pull requests and changelog entries.",
  "---",
  "# Release Notes Helper",
  "",
  "Collect merged pull requests since the previous tag, group them by area,",
  "and draft concise release notes that call out breaking changes first.",
  "",
  "## Steps",
  "",
  "1. List merged pull requests since the last release tag.",
  "2. Group changes by package and summarize user-visible behavior.",
  "3. Highlight breaking changes, migrations, and deprecations.",
  "",
].join("\n");

describe("skills.publishVersion", () => {
  it("stages web publishes as pending versions until pre-publication checks finish", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const owner = { _id: "users:owner", handle: "owner", role: "admin", createdAt: 1 };
    const runQuery = vi.fn(async (ref: FunctionReference<"query">) => {
      const name = getFunctionName(ref);
      if (name === "users:getByIdInternal") return owner;
      if (name === "skills:getOwnerSkillActivityInternal") return [];
      return null;
    });
    const runMutation = vi.fn(
      async (ref: FunctionReference<"mutation">, args: Record<string, unknown>) => {
        const name = getFunctionName(ref);
        if (name === "publishers:resolvePublishTargetForUserInternal") {
          return { publisherId: "publishers:owner", handle: "owner" };
        }
        if (name === "skills:insertVersion") {
          return {
            skillId: "skills:release-notes",
            versionId: "skillVersions:pending",
            publicationStatus: args.publicationStatus,
            createdNewParent: true,
          };
        }
        if (name === "publishAttempts:createSkillPublishAttemptInternal") {
          return { attemptId: "publishAttempts:web", status: "pending_checks" };
        }
        throw new Error(`unexpected mutation ${name}`);
      },
    );
    const ctx = {
      auth: { getUserIdentity: vi.fn(async () => ({ subject: "users:owner|session" })) },
      runQuery,
      runMutation,
      runAction: vi.fn(async () => true),
      scheduler: { runAfter: vi.fn() },
      storage: { get: vi.fn(async () => new Blob([skillMarkdown], { type: "text/markdown" })) },
    };

    const result = await publishVersionHandler(ctx, {
      slug: "release-notes-helper",
      displayName: "Release Notes Helper",
      version: "1.0.0",
      changelog: "Initial release",
      acceptLicenseTerms: true,
      files: [
        {
          path: "SKILL.md",
          size: skillMarkdown.length,
          storageId: "_storage:skill",
          sha256: "a".repeat(64),
          contentType: "text/markdown",
        },
      ],
    });

    expect(result).toEqual({
      skillId: "skills:release-notes",
      versionId: "skillVersions:pending",
      status: "pending",
      slug: "release-notes-helper",
      version: "1.0.0",
      publicationStatus: "pending",
      attemptId: "publishAttempts:web",
    });
    expect(runMutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual([
      "publishers:resolvePublishTargetForUserInternal",
      "skills:insertVersion",
      "publishAttempts:createSkillPublishAttemptInternal",
    ]);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      publicationStatus: "pending",
      ownerPublisherId: "publishers:owner",
      embedding: [],
    });
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
      skillVersionId: "skillVersions:pending",
      ownerPublisherId: "publishers:owner",
      artifactFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    // No scans, webhooks, or AI enrichment run against the unscanned artifact.
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});
