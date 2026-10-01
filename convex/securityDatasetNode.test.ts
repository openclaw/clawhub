/* @vitest-environment node */
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { listArtifactExportBatchCompressed } from "./securityDatasetNode";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listArtifactExportBatchCompressedHandler = (
  listArtifactExportBatchCompressed as unknown as WrappedHandler<
    {
      token: string;
      sourceKind: "skill";
      paginationOpts: { cursor: string | null; numItems: number };
      pageCount: number;
    },
    { encoding: "gzip-base64-json"; payload: string }
  >
)._handler;

describe("security dataset worker export", () => {
  it("requires the shared worker token", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    await expect(
      listArtifactExportBatchCompressedHandler(makeCtx(), {
        token: "wrong",
        sourceKind: "skill",
        paginationOpts: { cursor: null, numItems: 1 },
        pageCount: 1,
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("returns redacted storage-backed content without storage ids", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");
    const result = await listArtifactExportBatchCompressedHandler(makeCtx(), {
      token: "worker-secret",
      sourceKind: "skill",
      paginationOpts: { cursor: null, numItems: 1 },
      pageCount: 1,
    });

    const decoded = JSON.parse(
      gunzipSync(Buffer.from(result.payload, "base64")).toString("utf8"),
    ) as {
      page: Array<{
        skillMdContentRedacted: string;
        bundleFilesRedacted: Array<{ path: string; content: string }>;
        files: Array<Record<string, unknown>>;
      }>;
    };

    expect(decoded.page).toEqual([
      expect.objectContaining({
        skillMdContentRedacted: "Use this skill. [REDACTED_SECRET]",
        bundleFilesRedacted: [
          {
            path: "scripts/run.sh",
            content: "echo [REDACTED_SECRET]\n",
          },
        ],
        files: [
          expect.not.objectContaining({ storageId: expect.anything() }),
          expect.not.objectContaining({ storageId: expect.anything() }),
        ],
      }),
    ]);
  });
});

function makeCtx() {
  return {
    runQuery: vi.fn(async () => ({
      page: [
        {
          sourceKind: "skill",
          sourceDocId: "skillVersions:1",
          parentDocId: "skills:1",
          publicName: "Demo",
          publicOwnerHandle: "owner",
          publicSlug: "demo",
          version: "1.0.0",
          artifactSha256: "a".repeat(64),
          createdAt: 1,
          softDeletedAt: null,
          files: [
            {
              path: "SKILL.md",
              size: 42,
              sha256: "skill-sha",
              storageId: "storage:skill",
              contentType: "text/markdown",
            },
            {
              path: "scripts/run.sh",
              size: 32,
              sha256: "script-sha",
              storageId: "storage:script",
              contentType: "text/x-shellscript",
            },
          ],
          packageFamily: null,
          packageChannel: null,
          sourceRepoHost: null,
          vtAnalysis: null,
          skillSpectorAnalysis: null,
          staticScan: null,
          llmAnalysis: null,
          moderationConsensus: null,
        },
      ],
      isDone: true,
      continueCursor: "",
      exportMode: "public",
    })),
    storage: {
      get: vi.fn(async (id: string) => {
        if (id === "storage:skill") {
          return new Blob(["Use this skill. token=supersecret123"]);
        }
        if (id === "storage:script") {
          return new Blob(["echo password=scriptsecret123\n"]);
        }
        return null;
      }),
    },
  };
}
