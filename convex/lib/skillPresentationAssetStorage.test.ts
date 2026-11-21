/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  isDecodableSkillPresentationRaster,
  storeSkillPresentationAsset,
} from "./skillPresentationAssetStorage";

const sha256 = "a".repeat(64);

function context() {
  return {
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async () => ({ storageId: "winner", sha256 })),
    storage: {
      store: vi.fn(async (_blob: Blob) => "owned"),
      delete: vi.fn(async (_id: string) => {}),
    },
  };
}

describe("presentation asset storage", () => {
  it("keeps the registered winner and deletes only the redundant blob", async () => {
    const ctx = context();
    const result = await storeSkillPresentationAsset(ctx as never, {
      bytes: Uint8Array.from([7, 11, 13]),
      sha256,
      contentType: "image/png",
    });
    expect(result).toBe(`/api/v1/skill-icons/${sha256}`);
    expect(ctx.storage.delete.mock.calls).toEqual([["owned"]]);
  });

  it.each(["registration", "first cleanup", "registration and cleanup", "both cleanups"] as const)(
    "preserves error identity and cleanup attempts after %s fails",
    async (failure) => {
      const ctx = context();
      const registrationError = new Error("registration");
      const firstCleanupError = new Error("first cleanup");
      const secondCleanupError = new Error("second cleanup");
      if (failure.startsWith("registration")) ctx.runMutation.mockRejectedValue(registrationError);
      if (failure !== "registration") ctx.storage.delete.mockRejectedValueOnce(firstCleanupError);
      if (failure === "both cleanups") ctx.storage.delete.mockRejectedValueOnce(secondCleanupError);
      const expected =
        failure === "registration"
          ? registrationError
          : failure === "both cleanups"
            ? secondCleanupError
            : firstCleanupError;
      await expect(
        storeSkillPresentationAsset(ctx as never, {
          bytes: new Uint8Array(),
          sha256,
          contentType: "image/png",
        }),
      ).rejects.toBe(expected);
      const attempts = failure === "first cleanup" || failure === "both cleanups" ? 2 : 1;
      expect(ctx.storage.delete.mock.calls).toEqual(
        Array.from({ length: attempts }, () => ["owned"]),
      );
    },
  );

  it("passes only the selected byte view to raster validation", async () => {
    const backing = Uint8Array.from([99, 7, 11, 13, 88]);
    const runAction = vi.fn(async (_ref: unknown, args: { bytes: ArrayBuffer }) => {
      backing.fill(0);
      expect([...new Uint8Array(args.bytes)]).toEqual([7, 11, 13]);
      return true;
    });
    expect(
      await isDecodableSkillPresentationRaster({ runAction } as never, {
        bytes: backing.subarray(1, 4),
        contentType: "image/png",
      }),
    ).toBe(true);
  });
});
