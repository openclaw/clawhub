/* @vitest-environment node */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { backfillPackageReleaseScans } from "./packages";

const auth = vi.hoisted(() => ({ requireUserFromAction: vi.fn() }));
vi.mock("./lib/access", async (original) => ({
  ...(await original<typeof import("./lib/access")>()),
  requireUserFromAction: auth.requireUserFromAction,
}));

type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };
const backfillReleaseScans = (backfillPackageReleaseScans as unknown as Handler)._handler;

describe("packages.backfillPackageReleaseScans", () => {
  it("requires admin authorization before enqueueing catalog scans", async () => {
    const args = { batchSize: 25 };
    const ctx = {
      runAction: vi.fn(async () => ({ scheduled: 0, nextCursor: null, done: true })),
    };
    auth.requireUserFromAction.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(backfillReleaseScans(ctx, args)).rejects.toThrow("Unauthorized");
    for (const role of ["user", "moderator"]) {
      auth.requireUserFromAction.mockResolvedValueOnce({ user: { role } });
      await expect(backfillReleaseScans(ctx, args)).rejects.toThrow("Forbidden");
    }
    expect(ctx.runAction).not.toHaveBeenCalled();
    auth.requireUserFromAction.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(backfillReleaseScans(ctx, args)).resolves.toMatchObject({ done: true });
    const [ref, delegated] = ctx.runAction.mock.calls[0] as unknown as [
      Parameters<typeof getFunctionName>[0],
      unknown,
    ];
    expect(getFunctionName(ref)).toBe("packages:backfillPackageReleaseScansInternal");
    expect(delegated).toEqual(args);
  });
});
