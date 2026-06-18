/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { getCatalogClassificationPageInternalHandler } from "./catalogClassification";
import { classifyCatalogInternalHandler } from "./catalogClassificationNode";

describe("catalog classification runner", () => {
  it("loads bounded latest skill evidence without scanning historical versions", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:demo",
          slug: "web-research",
          displayName: "Web Research",
          summary: "Search the web for current sources",
          latestVersionId: "skillVersions:v1",
        },
      ],
      isDone: true,
      continueCursor: "done",
    });
    const get = vi.fn().mockResolvedValue({
      _id: "skillVersions:v1",
      skillId: "skills:demo",
      files: [
        {
          path: "SKILL.md",
          size: 100,
          storageId: "storage:skill",
        },
        {
          path: "archive/README.md",
          size: 100,
          storageId: "storage:readme",
        },
      ],
    });
    const result = await getCatalogClassificationPageInternalHandler(
      {
        db: {
          query: vi.fn(() => ({
            order: vi.fn(() => ({ paginate })),
          })),
          get,
        },
      } as never,
      { targetKind: "skill", batchSize: 10 },
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        kind: "skill",
        skillId: "skills:demo",
        skillVersionId: "skillVersions:v1",
        textFile: { path: "SKILL.md", storageId: "storage:skill" },
      }),
    ]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("stores preview classifications without changing source artifacts", async () => {
    const runMutation = vi.fn().mockResolvedValue({ ok: true, upserted: 1 });
    const result = await classifyCatalogInternalHandler(
      {
        runQuery: vi.fn().mockResolvedValue({
          items: [
            {
              kind: "skill",
              skillId: "skills:demo",
              skillVersionId: "skillVersions:v1",
              slug: "web-research",
              displayName: "Web Research",
              summary: "Search the web for current research sources",
              textFile: { path: "SKILL.md", storageId: "storage:skill" },
            },
          ],
          cursor: "done",
          isDone: true,
        }),
        runMutation,
        storage: {
          get: vi
            .fn()
            .mockResolvedValue(
              new Blob([
                "---\nname: web-research\ndescription: Web search for current research sources.\n---\n# Web Research",
              ]),
            ),
        },
        scheduler: { runAfter: vi.fn() },
      } as never,
      { targetKind: "skill", batchSize: 10 },
    );

    expect(result).toMatchObject({
      ok: true,
      targetKind: "skill",
      scanned: 1,
      classified: 1,
      skipped: 0,
      failed: 0,
      isDone: true,
      scheduledNext: false,
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        results: [
          expect.objectContaining({
            targetKind: "skill",
            skillId: "skills:demo",
            skillVersionId: "skillVersions:v1",
            categories: ["research"],
            classifierVersion: "taxonomy-prototype-v9",
          }),
        ],
      }),
    );
  });

  it("skips skill-family packages in the plugin classification lane", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "packages:skill",
          family: "skill",
          latestReleaseId: "packageReleases:v1",
        },
      ],
      isDone: true,
      continueCursor: "done",
    });
    const get = vi.fn();
    const result = await getCatalogClassificationPageInternalHandler(
      {
        db: {
          query: vi.fn(() => ({
            order: vi.fn(() => ({ paginate })),
          })),
          get,
        },
      } as never,
      { targetKind: "plugin", batchSize: 10 },
    );

    expect(result.items).toEqual([{ kind: "skip", targetKind: "plugin", reason: "not-plugin" }]);
    expect(get).not.toHaveBeenCalled();
  });
});
