/* @vitest-environment node */
import { getFunctionName, type FunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { streamClawPackRelease } from "./packageArchiveHttp";
import type { PublicPackageDocLike, ReleaseLike } from "./packageReadProjection";

const pkg = { _id: "package-id", name: "@maker/brief" } as PublicPackageDocLike;
function fixture(overrides: Partial<ReleaseLike> = {}) {
  const release = {
    version: "1.0.0",
    artifactKind: "npm-pack",
    clawpackStorageId: "stored",
    clawpackSha256: "a".repeat(64),
    npmIntegrity: "sha512-original",
    npmShasum: "original-shasum",
    npmTarballName: "brief-1.0.0.tgz",
    ...overrides,
  } as ReleaseLike;
  const get = vi.fn(async () => new Blob(["unaltered archive bytes"]));
  const runMutation = vi.fn(async () => null);
  const ctx = { storage: { get }, runMutation } as unknown as ActionCtx;
  return { ctx, release, get, runMutation };
}
const request = () =>
  new Request(
    "https://example.invalid/api/v1/packages/%40maker%2Fbrief/versions/1.0.0/artifact/download",
  );
describe("shared package archive stream", () => {
  it.each(["quarantined", "revoked"] as const)(
    "denies %s releases before accessing storage",
    async (state) => {
      const f = fixture({ manualModeration: { state } as ReleaseLike["manualModeration"] });
      const response = await streamClawPackRelease(f.ctx, request(), {}, pkg, f.release, null);
      expect(response.status).toBe(403);
      expect(f.get).not.toHaveBeenCalled();
      expect(f.runMutation).not.toHaveBeenCalled();
    },
  );
  it("denies malicious scan verdicts before accessing storage", async () => {
    const f = fixture({ llmAnalysis: { verdict: "malicious" } as ReleaseLike["llmAnalysis"] });
    expect((await streamClawPackRelease(f.ctx, request(), {}, pkg, f.release, null)).status).toBe(
      403,
    );
    expect(f.get).not.toHaveBeenCalled();
  });
  it("preserves missing artifact and missing stored object failures", async () => {
    const f = fixture({ clawpackStorageId: undefined });
    expect((await streamClawPackRelease(f.ctx, request(), {}, pkg, f.release, null)).status).toBe(
      404,
    );
    expect(f.get).not.toHaveBeenCalled();
    const missing = fixture();
    missing.get.mockResolvedValue(null as unknown as Blob);
    expect(
      (await streamClawPackRelease(missing.ctx, request(), {}, pkg, missing.release, null)).status,
    ).toBe(404);
  });
  it("streams original bytes with all integrity and quota headers", async () => {
    const f = fixture();
    const response = await streamClawPackRelease(
      f.ctx,
      request(),
      { "X-Quota-Test": "kept" },
      pkg,
      f.release,
      null,
    );
    expect(await response.text()).toBe("unaltered archive bytes");
    expect(response.headers.get("X-ClawHub-Artifact-Type")).toBe("npm-pack-tarball");
    expect(response.headers.get("X-ClawHub-Artifact-Sha256")).toBe("a".repeat(64));
    expect(response.headers.get("ETag")).toBe('"sha256:' + "a".repeat(64) + '"');
    expect(response.headers.get("X-ClawHub-Npm-Integrity")).toBe("sha512-original");
    expect(response.headers.get("X-ClawHub-Npm-Shasum")).toBe("original-shasum");
    expect(response.headers.get("X-Quota-Test")).toBe("kept");
    expect(response.headers.get("Content-Disposition")).toContain("brief-1.0.0.tgz");
  });
  it("retains install recording and treats metrics failure as best effort", async () => {
    const f = fixture();
    f.runMutation.mockRejectedValue(new Error("metrics failed"));
    const response = await streamClawPackRelease(
      f.ctx,
      request(),
      {},
      pkg,
      f.release,
      "viewer" as Id<"users">,
      "install",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("unaltered archive bytes");
    const call = f.runMutation.mock.calls[0] as unknown as [
      FunctionReference<"mutation">,
      Record<string, unknown>,
    ];
    expect(getFunctionName(call[0])).toBe("packages:recordPackageInstallInternal");
    expect(call[1]).toMatchObject({ packageId: pkg._id, identityKind: "user" });
  });
});
