/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { readPackageDetailForRequest, readPackageVersionForRequest } from "./packageHttpRead";
function context() {
  const runQuery = vi.fn(async () => null);
  return { runQuery, ctx: { runQuery } as unknown as ActionCtx };
}
describe("request-local package snapshots", () => {
  it("joins the same lookup, including missing data, within the same action/request", async () => {
    const { ctx, runQuery } = context();
    const request = new Request("https://example.invalid");
    await readPackageDetailForRequest(ctx, request, "@maker/brief");
    await readPackageDetailForRequest(ctx, request, "@maker/brief");
    expect(runQuery).toHaveBeenCalledTimes(1);
  });
  it("does not reuse a result across HTTP requests or action contexts", async () => {
    const a = context(),
      b = context();
    const request = new Request("https://example.invalid");
    await readPackageDetailForRequest(a.ctx, request, "@maker/brief");
    await readPackageDetailForRequest(a.ctx, new Request(request), "@maker/brief");
    await readPackageDetailForRequest(b.ctx, request, "@maker/brief");
    expect(a.runQuery).toHaveBeenCalledTimes(2);
    expect(b.runQuery).toHaveBeenCalledTimes(1);
  });
  it("isolates viewer identities and exact release coordinates", async () => {
    const { ctx, runQuery } = context();
    const request = new Request("https://example.invalid");
    await readPackageDetailForRequest(ctx, request, "@maker/brief");
    await readPackageDetailForRequest(ctx, request, "@maker/brief", "viewer" as Id<"users">);
    await readPackageVersionForRequest(ctx, request, "@maker/brief", "1.0.0");
    await readPackageVersionForRequest(ctx, request, "@maker/brief", "1.0.0");
    await readPackageVersionForRequest(ctx, request, "@maker/brief", "2.0.0");
    await readPackageVersionForRequest(ctx, request, "@other/brief", "1.0.0");
    expect(runQuery).toHaveBeenCalledTimes(5);
  });
  it("propagates a rejected read without leaking it into a later request", async () => {
    const { ctx, runQuery } = context();
    const error = new Error("read failed");
    runQuery.mockRejectedValueOnce(error);
    await expect(
      readPackageDetailForRequest(ctx, new Request("https://example.invalid"), "@maker/brief"),
    ).rejects.toBe(error);
    await expect(
      readPackageDetailForRequest(ctx, new Request("https://example.invalid"), "@maker/brief"),
    ).resolves.toBeNull();
  });
});
