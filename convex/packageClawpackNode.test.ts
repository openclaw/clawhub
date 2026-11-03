import { gzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
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

function archive() {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: "demo-plugin", version: "1.0.0" }));
  const tar = new Uint8Array(2048);
  tar.set(new TextEncoder().encode("package/package.json"));
  tar.set(new TextEncoder().encode(bytes.length.toString(8).padStart(11, "0")), 124);
  tar[156] = 48;
  tar.set(bytes, 512);
  return gzipSync(tar);
}

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
});
