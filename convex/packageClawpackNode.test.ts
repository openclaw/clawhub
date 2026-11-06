import { gzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { prepareClawPackInternal } from "./packageClawpackNode";

type PrepareArgs = { artifactStorageId: string; metadataJson: string };
const prepare = (ctx: ActionCtx, args: PrepareArgs) =>
  (
    prepareClawPackInternal as unknown as {
      _handler: (
        ctx: ActionCtx,
        args: PrepareArgs,
      ) => Promise<{ payloadJson: string; requestStorageIds: string[] }>;
    }
  )._handler(ctx, args);

function archive(extraFiles: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  const files = {
    "package.json": JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
    ...extraFiles,
  };
  const blocks: Uint8Array[] = [];
  for (const [path, contents] of Object.entries(files)) {
    const bytes = encoder.encode(contents);
    const header = new Uint8Array(512);
    header.set(encoder.encode(`package/${path}`));
    header.set(encoder.encode(bytes.length.toString(8).padStart(11, "0")), 124);
    header[156] = 48;
    const body = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
    body.set(bytes);
    blocks.push(header, body);
  }
  blocks.push(new Uint8Array(1024));
  const tar = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }
  return gzipSync(tar);
}

const transientStoreError = () =>
  new Error(
    "[Request ID: 60064f4c549599fd] Server Error\nUncaught Error: InternalServerError: Transient error while running generate upload url",
  );

const metadata = {
  name: "demo-plugin",
  family: "code-plugin",
  version: "1.0.0",
  changelog: "init",
};

describe("prepareClawPackInternal", () => {
  it("returns stored-file metadata and integrity without transferring archive bytes", async () => {
    const bytes = archive();
    const store = vi.fn(async (_blob: Blob) => "storage:file");
    const remove = vi.fn();
    const result = await prepare(
      {
        storage: {
          get: vi.fn(async () => new Blob([bytes])),
          store,
          delete: remove,
        },
      } as unknown as ActionCtx,
      { artifactStorageId: "storage:archive", metadataJson: JSON.stringify(metadata) },
    );
    const payload = JSON.parse(result.payloadJson);
    expect(result.requestStorageIds).toEqual(["storage:file"]);
    expect(payload.artifact).toMatchObject({
      storageId: "storage:archive",
      size: bytes.length,
      npmFileCount: 1,
    });
    expect(payload.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.files).toEqual([
      expect.objectContaining({ path: "package.json", storageId: "storage:file" }),
    ]);
    expect(await store.mock.calls[0]?.[0]?.text()).toContain('"name":"demo-plugin"');
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    { name: "other-plugin" },
    { version: "2.0.0" },
    { expectedArtifactSha256: "0".repeat(64) },
  ])(
    "rejects mismatched Template identity before storing extracted files: %j",
    async (mismatch) => {
      const store = vi.fn();
      const remove = vi.fn();
      await expect(
        prepare(
          {
            storage: {
              get: vi.fn(async () => new Blob([archive()])),
              store,
              delete: remove,
            },
          } as unknown as ActionCtx,
          {
            artifactStorageId: "storage:archive",
            metadataJson: JSON.stringify({
              ...metadata,
              family: "template",
              expectedArtifactSha256: "0".repeat(64),
              ...mismatch,
            }),
          },
        ),
      ).rejects.toThrow(/mismatch/);
      expect(store).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it("retains the staged source when parsing fails", async () => {
    const store = vi.fn();
    const remove = vi.fn();
    await expect(
      prepare(
        {
          storage: {
            get: vi.fn(async () => new Blob(["invalid archive"])),
            store,
            delete: remove,
          },
        } as unknown as ActionCtx,
        { artifactStorageId: "storage:archive", metadataJson: JSON.stringify(metadata) },
      ),
    ).rejects.toThrow();
    expect(store).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  describe("transient storage store failures", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function prepareWithStore(
      bytes: ReturnType<typeof archive>,
      store: (blob: Blob) => Promise<string>,
      remove = vi.fn(),
    ) {
      // Only fake setTimeout: archive parsing/hashing still needs real I/O turns.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const result = prepare(
        {
          storage: { get: vi.fn(async () => new Blob([bytes])), store, delete: remove },
        } as unknown as ActionCtx,
        { artifactStorageId: "storage:archive", metadataJson: JSON.stringify(metadata) },
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      // Advance backoff timers until the store/cleanup chain settles.
      for (;;) {
        const settled = await Promise.race([
          result.then(() => true),
          new Promise<false>((resolve) => setImmediate(() => resolve(false))),
        ]);
        if (settled) return result;
        await vi.advanceTimersByTimeAsync(1_000);
      }
    }

    it("retries a transient upload-url failure and then succeeds", async () => {
      const store = vi
        .fn<(blob: Blob) => Promise<string>>()
        .mockRejectedValueOnce(transientStoreError())
        .mockResolvedValueOnce("storage:file");
      const remove = vi.fn();
      const outcome = await prepareWithStore(archive(), store, remove);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.requestStorageIds).toEqual(["storage:file"]);
      expect(store).toHaveBeenCalledTimes(2);
      expect(await store.mock.calls[1]?.[0]?.text()).toContain('"name":"demo-plugin"');
      expect(remove).not.toHaveBeenCalled();
    });

    it("fails after bounded attempts and cleans up blobs stored by sibling files", async () => {
      const store = vi.fn(async (blob: Blob) => {
        if ((await blob.text()).includes("demo-plugin")) throw transientStoreError();
        return "storage:readme";
      });
      const remove = vi.fn(async () => undefined);
      const outcome = await prepareWithStore(archive({ "README.md": "# demo" }), store, remove);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(String(outcome.error)).toContain("Transient error while running generate upload url");
      // 3 attempts for package.json, 1 for README.md.
      expect(store).toHaveBeenCalledTimes(4);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith("storage:readme");
    });

    it("does not retry non-transient storage errors", async () => {
      const store = vi.fn(async () => {
        throw new Error("Storage quota exceeded");
      });
      const remove = vi.fn();
      const outcome = await prepareWithStore(archive(), store, remove);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(String(outcome.error)).toContain("Storage quota exceeded");
      expect(store).toHaveBeenCalledTimes(1);
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
