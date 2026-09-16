/* @vitest-environment node */
import { getFunctionName } from "convex/server";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

vi.mock("./lib/httpRateLimit", () => ({
  applyRateLimit: async () => ({ ok: true, headers: {} }),
}));
vi.mock("./lib/apiTokenAuth", () => ({
  requireApiTokenUser: async () => ({ userId: "users:reader", user: { role: "user" } }),
  getOptionalApiTokenUserId: async () => null,
}));
vi.mock("./skills", () => ({ publishVersionForUser: vi.fn() }));

const { resolveTagsBatch } = await import("./httpApiV1/shared");
const { exportSkillsV1Handler, skillsGetRouterV1Handler, listSkillsV1Handler } =
  await import("./httpApiV1/skillsV1");

const skillId = "skills:catalog" as Id<"skills">;
const ids = {
  published: "skillVersions:published",
  legacy: "skillVersions:legacy",
  pending: "skillVersions:pending",
  blocked: "skillVersions:blocked",
  deleted: "skillVersions:deleted",
  foreign: "skillVersions:foreign",
  ownerDeleted: "skillVersions:ownerDeleted",
} as const;

function fixture(selected: keyof typeof ids = "published") {
  const versions = Object.fromEntries(
    Object.entries(ids).map(([kind, id], index) => [
      id,
      {
        _id: id,
        _creationTime: 1,
        createdBy: "users:owner" as Id<"users">,
        skillId: kind === "foreign" ? "skills:other" : skillId,
        version: `1.0.${index}`,
        createdAt: 1,
        changelog: `${kind} change`,
        ...(kind === "legacy"
          ? {}
          : { publicationStatus: kind === "pending" || kind === "blocked" ? kind : "published" }),
        ...(kind === "deleted" ? { softDeletedAt: 2 } : {}),
        ...(kind === "ownerDeleted" ? { ownerDeletedAt: 2 } : {}),
        llmAnalysis: { status: "completed", verdict: "benign" },
        files: [
          { path: "SKILL.md", size: 12, storageId: `_storage:${kind}`, sha256: "a".repeat(64) },
        ],
        parsed: { description: `${kind} description` },
      },
    ]),
  ) as unknown as Record<string, Doc<"skillVersions">>;
  const skill = {
    _id: skillId,
    slug: "catalog",
    displayName: "Catalog",
    ownerUserId: "users:owner",
    latestVersionId: ids[selected],
    tags: { latest: ids[selected], stable: ids.legacy },
    stats: { downloads: 0, stars: 0, versions: 2, comments: 0 },
    createdAt: 1,
    updatedAt: 2,
  } as unknown as Doc<"skills">;
  // Model the checked-query contract independently of the HTTP adapter:
  // only these two fixture IDs are eligible; raw queries return every row.
  function selection(args: Record<string, unknown>) {
    const id = (args.versionId ??
      (args.version
        ? Object.values(versions).find((v) => v.version === args.version)?._id
        : args.tag
          ? skill.tags[args.tag as string]
          : skill.latestVersionId)) as string | undefined;
    if (id === ids.deleted || id === ids.ownerDeleted) return { status: "deleted" };
    if (args.skillId !== skillId || (id !== ids.published && id !== ids.legacy))
      return { status: "not_found" };
    return { status: "available", skill, version: versions[id] };
  }
  const runQuery = vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(ref as never);
    if (name === "skills:getPublicVersionSelectionInternal") return selection(args);
    if (name === "skills:getPublicVersionSelectionsInternal")
      return (args.selections as Record<string, unknown>[]).map(selection);
    if (name === "skills:getBySlug" || name === "skills:getVerifyTargetBySlugInternal") {
      return {
        skill,
        latestVersion:
          selected === "published" || selected === "legacy" ? versions[ids[selected]] : null,
        owner: { handle: "owner" },
        moderationInfo: null,
      };
    }
    if (name === "skills:listPublicApiPageV1") {
      const current = versions[ids[selected]];
      return {
        items: [
          {
            skill,
            ownerHandle: "owner",
            latestVersion: {
              _id: current._id,
              skillId,
              version: current.version,
              createdAt: current.createdAt,
              changelog: current.changelog,
              parsed: current.parsed,
            },
          },
        ],
        nextCursor: null,
      };
    }
    if (name === "skills:listByDateRange")
      return { page: [{ ...skill, skillId }], nextCursor: null, hasMore: false };
    if (name === "skills:getVersionsByIdsInternal")
      return (args.versionIds as string[]).map((id) => versions[id] ?? null);
    if (name === "skills:getVersionByIdInternal" || name === "skills:getVersionById")
      return versions[args.versionId as string] ?? null;
    if (
      name === "skills:getVersionBySkillAndVersionInternal" ||
      name === "skills:getVersionBySkillAndVersion"
    )
      return Object.values(versions).find((v) => v.version === args.version) ?? null;
    if (name === "skills:listVersionFingerprintsInternal") return [];
    return null;
  });
  const storage = {
    get: vi.fn(async () => new Blob(["private body"])),
    getUrl: vi.fn(async () => "https://example.invalid/artifact"),
  };
  const ctx = { runQuery, storage } as unknown as ActionCtx;
  return { ctx, runQuery, storage, skill, versions };
}

function request(path: string) {
  return new Request(`https://example.com/api/v1/skills/${path}`);
}

describe("skill HTTP publication boundaries", () => {
  it.each(["pending", "blocked"] as const)(
    "omits %s latest and non-latest tags",
    async (status) => {
      const f = fixture(status);
      const hiddenId = ids[status] as Id<"skillVersions">;
      const result = await resolveTagsBatch(
        f.ctx,
        [{ latest: hiddenId, candidate: hiddenId, stable: ids.legacy as Id<"skillVersions"> }],
        [skillId],
      );
      expect(result).toEqual([{ stable: "1.0.1" }]);
    },
  );

  it.each(["pending", "blocked", "foreign", "deleted"] as const)(
    "does not fall back to raw %s README content",
    async (status) => {
      const f = fixture(status);
      const response = await skillsGetRouterV1Handler(f.ctx, request("catalog"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.skill.description).toBeNull();
      expect(body.latestVersion).toBeNull();
      expect(body.skill.tags).toEqual({ stable: "1.0.1" });
      expect(JSON.stringify(body)).not.toContain(ids[status]);
      expect(f.storage.get).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "blocked", "foreign", "deleted"] as const)(
    "excludes %s export artifacts before storage or signing",
    async (status) => {
      const f = fixture(status);
      const response = await exportSkillsV1Handler(f.ctx, request("export?startDate=1&endDate=2"));
      expect(response.status).toBe(200);
      const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
      expect(Object.keys(zip).some((path) => path.endsWith("SKILL.md"))).toBe(false);
      expect(
        Object.values(zip)
          .map((bytes) => strFromU8(bytes))
          .join("\n"),
      ).not.toContain("private body");
      expect(f.storage.get).not.toHaveBeenCalled();
      expect(f.storage.getUrl).not.toHaveBeenCalled();
      expect(
        Object.values(zip)
          .map((bytes) => strFromU8(bytes))
          .join("\n"),
      ).not.toContain(ids[status]);
    },
  );

  it("does not serve latest file bytes for an unknown tag", async () => {
    const f = fixture();
    const response = await skillsGetRouterV1Handler(
      f.ctx,
      request("catalog/file?path=SKILL.md&tag=missing"),
    );
    expect(response.status).toBe(404);
    expect(f.storage.get).not.toHaveBeenCalled();
  });

  it.each(["published", "legacy"] as const)("retains %s file and export bytes", async (status) => {
    const f = fixture(status);
    const response = await skillsGetRouterV1Handler(f.ctx, request("catalog/file?path=SKILL.md"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private body");
    const exported = await exportSkillsV1Handler(f.ctx, request("export?startDate=1&endDate=2"));
    expect(exported.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    expect(
      Object.entries(zip).some(
        ([path, bytes]) => path.endsWith("SKILL.md") && strFromU8(bytes) === "private body",
      ),
    ).toBe(true);
  });

  it.each(["pending", "blocked", "foreign", "deleted", "ownerDeleted"] as const)(
    "keeps %s selections out of file, card, version, scan and verification responses",
    async (status) => {
      const f = fixture(status);
      const version = f.versions[ids[status]].version;
      for (const route of [
        `file?path=SKILL.md&version=${version}`,
        `card?version=${version}`,
        `versions/${version}`,
        `scan?version=${version}`,
        `verify?version=${version}`,
      ]) {
        const response = await skillsGetRouterV1Handler(f.ctx, request(`catalog/${route}`));
        const deleted = status === "deleted" || status === "ownerDeleted";
        const metadata = route.startsWith("versions/") || route.startsWith("scan?");
        expect(response.status, route).toBe(deleted && !metadata ? 410 : 404);
      }
      expect(f.storage.get).not.toHaveBeenCalled();
    },
  );

  it("keeps published scan metadata inspectable while denying malicious file bytes", async () => {
    const f = fixture();
    f.versions[ids.published].llmAnalysis = { status: "completed", verdict: "malicious" } as never;
    const verified = await skillsGetRouterV1Handler(f.ctx, request("catalog/verify"));
    expect(verified.status).toBe(200);
    expect((await verified.json()).artifact.files).toHaveLength(1);
    const download = await skillsGetRouterV1Handler(f.ctx, request("catalog/file?path=SKILL.md"));
    expect(download.status).toBe(403);
    expect(f.storage.get).not.toHaveBeenCalled();
  });

  it("retains an older published file when a newer version is blocked", async () => {
    const f = fixture("blocked");
    Object.assign(f.skill, {
      moderationVerdict: "malicious",
      moderationSourceVersionId: ids.blocked,
    });
    const response = await skillsGetRouterV1Handler(
      f.ctx,
      request("catalog/file?path=SKILL.md&tag=stable"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private body");
  });

  it("bounds full-document tag batches and preserves parent association", async () => {
    const selections = Array.from({ length: 12 }, (_, index) => ({
      skillId: `skills:${index}` as Id<"skills">,
      versionId: `skillVersions:${index}` as Id<"skillVersions">,
    }));
    const runQuery = vi.fn(async (_ref: unknown, args: { selections: typeof selections }) =>
      args.selections.map(({ skillId: parentId, versionId }) => ({
        status: "available",
        skill: { _id: parentId, tags: { latest: versionId } },
        version: { _id: versionId, skillId: parentId, version: "1.0.0" },
      })),
    );
    const result = await resolveTagsBatch(
      { runQuery } as unknown as ActionCtx,
      selections.map(({ versionId }) => ({ latest: versionId })),
      selections.map(({ skillId: parentId }) => parentId),
    );
    expect(result).toEqual(selections.map(() => ({ latest: "1.0.0" })));
    expect(runQuery).toHaveBeenCalledTimes(3);
    expect(runQuery.mock.calls.map(([, args]) => args.selections.length)).toEqual([5, 5, 2]);
  });

  it("does not trust a cached latest tag projection without publication state", async () => {
    const f = fixture("pending");
    const pendingId = ids.pending as Id<"skillVersions">;
    const tags = await resolveTagsBatch(f.ctx, [{ latest: pendingId }], [skillId]);
    expect(tags).toEqual([{}]);
  });

  it.each(["pending", "blocked", "deleted", "foreign"] as const)(
    "does not serialize a stale %s list summary",
    async (status) => {
      const f = fixture(status);
      const response = await listSkillsV1Handler(f.ctx, request("?limit=1"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.items[0].latestVersion).toBeNull();
      expect(body.items[0].description).toBeNull();
      expect(body.items[0].tags).toEqual({ stable: "1.0.1" });
      expect(JSON.stringify(body)).not.toContain(f.versions[ids[status]].version);
    },
  );
});
