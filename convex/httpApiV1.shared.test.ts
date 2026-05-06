/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { resolveVersionTagsBatch } from "./httpApiV1/shared";

function makeCtx() {
  return {
    runQuery: vi.fn(),
  } as unknown as ActionCtx & { runQuery: ReturnType<typeof vi.fn> };
}

describe("http API v1 shared helpers", () => {
  it("resolves latest tags without reading version documents", async () => {
    const ctx = makeCtx();
    const versionId = "skillVersions:latest" as Id<"skillVersions">;

    const result = await resolveVersionTagsBatch(ctx, [{ latest: versionId }], {} as never, [
      { _id: versionId, version: "2.0.0" },
    ]);

    expect(result).toEqual([{ latest: "2.0.0" }]);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("only fetches tag versions that cannot be resolved from latest", async () => {
    const ctx = makeCtx();
    const latestId = "skillVersions:latest" as Id<"skillVersions">;
    const stableId = "skillVersions:stable" as Id<"skillVersions">;
    ctx.runQuery.mockResolvedValueOnce([{ _id: stableId, version: "1.5.0" }]);

    const result = await resolveVersionTagsBatch(
      ctx,
      [{ latest: latestId, stable: stableId }],
      {} as never,
      [{ _id: latestId, version: "2.0.0" }],
    );

    expect(ctx.runQuery).toHaveBeenCalledWith({}, { versionIds: [stableId] });
    expect(result).toEqual([{ latest: "2.0.0", stable: "1.5.0" }]);
  });
});
