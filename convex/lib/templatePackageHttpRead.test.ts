/* @vitest-environment node */
import { getFunctionName, type FunctionReference } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { readPackageDetailForRequest, readPackageVersionForRequest } from "./packageHttpRead";
import type { PublicPackageDocLike, ReleaseLike } from "./packageReadProjection";
const { rate, token, stream } = vi.hoisted(() => ({
  rate: vi.fn(),
  token: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("./httpRateLimit", () => ({ applyRateLimit: rate }));
vi.mock("./apiTokenAuth", () => ({ getOptionalApiTokenUserId: token }));
vi.mock("./packageArchiveHttp", () => ({ streamClawPackRelease: stream }));
import { readTemplatePackageHttp } from "./templatePackageHttpRead";
function fixture(
  options: { family?: string; missing?: boolean; missingVersion?: boolean; legacy?: boolean } = {},
) {
  const pkg = {
    _id: "package-id",
    name: "@maker/brief",
    displayName: "Brief",
    family: options.family ?? "template",
    channel: "community",
    isOfficial: false,
    tags: {},
    createdAt: 1,
    updatedAt: 2,
    stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
  } as PublicPackageDocLike;
  const release = {
    _id: "release-id" as Id<"packageReleases">,
    packageId: pkg._id,
    version: "1.0.0",
    createdAt: 1,
    changelog: "Initial",
    files: [],
    artifactKind: options.legacy ? "legacy-zip" : "npm-pack",
    clawpackStorageId: "private-storage-marker" as Id<"_storage">,
    clawpackSha256: "a".repeat(64),
  } as ReleaseLike;
  const runQuery = vi.fn(async (ref: unknown) => {
    const name = getFunctionName(ref as FunctionReference<"query">);
    if (name.endsWith("getByNameForViewerInternal"))
      return options.missing ? null : { package: pkg, latestRelease: release, owner: null };
    if (name.endsWith("getVersionByNameForViewerInternal"))
      return options.missingVersion ? null : { package: pkg, version: release };
    if (name.endsWith("getTagsForViewerInternal")) return { latest: "1.0.0" };
    throw new Error("Unexpected query: " + name);
  });
  const getUserIdentity = vi.fn(async (): Promise<unknown> => null);
  const ctx = { runQuery, auth: { getUserIdentity } } as unknown as ActionCtx;
  return { ctx, pkg, release, runQuery, getUserIdentity };
}
const req = (suffix = "", init?: RequestInit) =>
  new Request("https://example.invalid/api/v1/packages/%40maker%2Fbrief" + suffix, init);
beforeEach(() => {
  rate.mockReset().mockResolvedValue({ ok: true, headers: { "X-Test-Rate": "kept" } });
  token.mockReset().mockResolvedValue(null);
  stream.mockReset().mockResolvedValue(new Response("archive"));
});
describe("anonymous scoped Template HTTP reads", () => {
  it("returns the existing metadata projection and preserves response policy", async () => {
    const f = fixture();
    const response = await readTemplatePackageHttp(f.ctx, req());
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(response?.headers.get("X-Test-Rate")).toBe("kept");
    expect(await response?.json()).toMatchObject({
      package: { name: "@maker/brief", family: "template", tags: { latest: "1.0.0" } },
    });
    expect(f.runQuery).toHaveBeenCalledTimes(2);
  });
  it("reads an exact release without exposing storage handles", async () => {
    const f = fixture();
    const response = await readTemplatePackageHttp(f.ctx, req("/versions/1.0.0"));
    const body = await response?.json();
    expect(body).toMatchObject({
      package: { name: "@maker/brief", family: "template" },
      version: { version: "1.0.0" },
    });
    expect(JSON.stringify(body)).not.toContain("private-storage-marker");
    expect(f.runQuery).toHaveBeenLastCalledWith(expect.anything(), {
      name: "@maker/brief",
      version: "1.0.0",
      viewerUserId: undefined,
    });
  });
  it("delegates exact archive safety, storage, integrity headers and metrics to the unchanged streamer", async () => {
    const f = fixture(),
      request = req("/versions/1.0.0/artifact/download");
    const response = await readTemplatePackageHttp(f.ctx, request);
    expect(await response?.text()).toBe("archive");
    expect(rate).toHaveBeenCalledExactlyOnceWith(f.ctx, request, "download");
    expect(stream).toHaveBeenCalledExactlyOnceWith(
      f.ctx,
      request,
      { "X-Test-Rate": "kept" },
      f.pkg,
      f.release,
      null,
    );
  });
  it.each(["authorization", "cookie"])(
    "leaves %s requests entirely with the existing authenticated router",
    async (header) => {
      const f = fixture();
      expect(
        await readTemplatePackageHttp(f.ctx, req("", { headers: { [header]: "present" } })),
      ).toBeNull();
      expect(rate).not.toHaveBeenCalled();
      expect(f.runQuery).not.toHaveBeenCalled();
    },
  );
  it("does not reinterpret another authenticated transport as anonymous", async () => {
    const f = fixture();
    f.getUserIdentity.mockResolvedValue({ subject: "actor" });
    expect(await readTemplatePackageHttp(f.ctx, req())).toBeNull();
    expect(f.runQuery).not.toHaveBeenCalled();
  });
  it("leaves token identities and auth errors to the compatibility router", async () => {
    const f = fixture();
    token.mockResolvedValueOnce("actor").mockRejectedValueOnce(new Error("auth failed"));
    expect(await readTemplatePackageHttp(f.ctx, req())).toBeNull();
    expect(await readTemplatePackageHttp(f.ctx, req())).toBeNull();
    expect(f.runQuery).not.toHaveBeenCalled();
  });
  it.each([
    "/versions",
    "/versions/1.0.0/security",
    "/versions/1.0.0/artifact",
    "/file?path=CLAW.md",
    "/moderation",
  ])("does not intercept unsupported read shape %s", async (suffix) => {
    const f = fixture();
    expect(await readTemplatePackageHttp(f.ctx, req(suffix))).toBeNull();
    expect(f.runQuery).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
  });
  it("does not intercept reserved or unscoped package routes", async () => {
    const f = fixture();
    for (const path of [
      "search",
      "validation-report",
      "reports",
      "moderation/queue",
      "plain-package",
    ])
      expect(
        await readTemplatePackageHttp(
          f.ctx,
          new Request("https://example.invalid/api/v1/packages/" + path),
        ),
      ).toBeNull();
    expect(f.runQuery).not.toHaveBeenCalled();
  });
  it("retains quota denial before any package lookup", async () => {
    const f = fixture(),
      denial = new Response("limited", { status: 429 });
    rate.mockResolvedValue({ ok: false, response: denial });
    expect(await readTemplatePackageHttp(f.ctx, req())).toBe(denial);
    expect(f.runQuery).not.toHaveBeenCalled();
  });
  it("does not expand missing or non-Template visibility and reuses the fallback lookup", async () => {
    for (const options of [{ missing: true }, { family: "code-plugin" }]) {
      const f = fixture(options),
        request = req();
      expect(await readTemplatePackageHttp(f.ctx, request)).toBeNull();
      await readPackageDetailForRequest(f.ctx, request, "@maker/brief");
      expect(f.runQuery).toHaveBeenCalledTimes(1);
    }
  });
  it("preserves unavailable exact-release failure", async () => {
    const f = fixture({ missingVersion: true });
    const response = await readTemplatePackageHttp(f.ctx, req("/versions/1.0.0/artifact/download"));
    expect(response?.status).toBe(404);
    expect(stream).not.toHaveBeenCalled();
  });
  it("keeps historical ZIP handling in compatibility without a duplicate release query", async () => {
    const f = fixture({ legacy: true }),
      request = req("/versions/1.0.0/artifact/download");
    expect(await readTemplatePackageHttp(f.ctx, request)).toBeNull();
    await readPackageVersionForRequest(f.ctx, request, "@maker/brief", "1.0.0");
    expect(f.runQuery).toHaveBeenCalledTimes(2);
    expect(stream).not.toHaveBeenCalled();
  });
  it("propagates backend failures without converting them to fallback or empty data", async () => {
    const f = fixture(),
      error = new Error("query failed");
    f.runQuery.mockRejectedValue(error);
    await expect(readTemplatePackageHttp(f.ctx, req())).rejects.toBe(error);
  });
});
