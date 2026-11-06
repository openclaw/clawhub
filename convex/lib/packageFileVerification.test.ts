/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { sha256Hex } from "./clawpack";
import { verifyPublishFileStorageMetadata } from "./packageFileVerification";

function files(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    path: `file-${i}.txt`,
    storageId: `storage-${i}`,
    size: 999,
    sha256: "untrusted-client-hash",
    contentType: i === 0 ? " text/plain " : undefined,
  }));
}

function context(get: (id: string) => Promise<Blob | null>) {
  return { storage: { get } } as Pick<ActionCtx, "storage">;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("package file verification", () => {
  it("verifies a large plugin without exceeding storage capacity and preserves manifest bytes/order", async () => {
    const input = files(1861);
    let active = 0;
    let peak = 0;
    const get = vi.fn(async (id: string) => {
      active++;
      peak = Math.max(peak, active);
      try {
        if (active > 16) throw new Error("storage capacity exceeded");
        await new Promise((resolve) => setImmediate(resolve));
        return new Blob([id], { type: "application/octet-stream" });
      } finally {
        active--;
      }
    });
    const result = await verifyPublishFileStorageMetadata(context(get), input);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(16);
    expect(active).toBe(0);
    expect(get.mock.calls.map(([id]) => id)).toEqual(input.map((file) => file.storageId));
    expect(result.files).toHaveLength(input.length);
    for (const [i, file] of result.files.entries()) {
      const bytes = new TextEncoder().encode(input[i].storageId);
      expect(file).toEqual({
        ...input[i],
        size: bytes.length,
        sha256: await sha256Hex(bytes),
        contentType: i === 0 ? "text/plain" : "application/octet-stream",
      });
      expect(result.legacyZipEntries[i]).toEqual({ path: input[i].path, bytes });
    }
  });

  it.each(["missing", "read", "body"] as const)(
    "drains peers after a %s failure and never starts a later batch",
    async (failure) => {
      const peer = deferred();
      const started = deferred();
      const fault = new Error("storage failure");
      let active = 0;
      const get = vi.fn(async (id: string) => {
        if (id === "storage-0") {
          if (failure === "missing") return null;
          if (failure === "read") throw fault;
          const blob = new Blob([id]);
          blob.arrayBuffer = async () => {
            throw fault;
          };
          return blob;
        }
        active++;
        started.resolve();
        await peer.promise;
        active--;
        return new Blob([id]);
      });
      let settled = false;
      const result = verifyPublishFileStorageMetadata(context(get), files(33));
      const observed = result.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await started.promise;
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(get).toHaveBeenCalledTimes(16);
      expect(active).toBe(15);
      peer.resolve();
      if (failure === "missing")
        await expect(result).rejects.toThrow("Uploaded file no longer exists: file-0.txt");
      else await expect(result).rejects.toBe(fault);
      await observed;
      expect(active).toBe(0);
      expect(get).toHaveBeenCalledTimes(16);
    },
  );

  it("handles an empty inventory without storage calls", async () => {
    const get = vi.fn();
    expect(await verifyPublishFileStorageMetadata(context(get), [])).toEqual({
      files: [],
      legacyZipEntries: [],
    });
    expect(get).not.toHaveBeenCalled();
  });
});
