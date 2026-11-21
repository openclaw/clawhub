/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import {
  __test,
  generateChangelogForPublish,
  generateChangelogPreview,
  generatePackageChangelogPreview,
} from "./changelog";

describe("changelog utils", () => {
  it("summarizes file diffs", () => {
    const diff = __test.summarizeFileDiff(
      [
        { path: "a.txt", sha256: "aaa" },
        { path: "b.txt", sha256: "bbb" },
      ],
      [
        { path: "a.txt", sha256: "aaa" },
        { path: "b.txt", sha256: "ccc" },
        { path: "c.txt", sha256: "ddd" },
      ],
    );

    expect(diff.added).toEqual(["c.txt"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual(["b.txt"]);
    expect(__test.formatDiffSummary(diff)).toBe("1 added, 1 changed");
  });

  it("generates a fallback initial release note", () => {
    const text = __test.generateFallback({
      oldReadme: null,
      fileDiff: null,
    });
    expect(text).toBe("- Initial release.");
  });

  it("generates a package-specific fallback update note", () => {
    const text = __test.generateFallback(
      { oldReadme: "old", fileDiff: { added: ["src/index.ts"], changed: [], removed: [] } },
      "README and package contents",
    );
    expect(text).toContain("Updated README and package contents");
    expect(text).not.toContain("SKILL.md");
  });

  it.each(["SKILL.md and bundle contents", "README and package contents"])(
    "preserves file-count ordering and wording for %s",
    (updatedContents) => {
      const text = __test.generateFallback(
        { oldReadme: " ", fileDiff: { added: ["a", "b"], changed: ["c"], removed: ["d"] } },
        updatedContents,
      );
      expect(text).toBe(`- added 2, updated 1, removed 1 file(s).\n- Updated ${updatedContents}.`);
    },
  );

  describe("OpenAI changelog fetch deadline", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("passes an abort signal with the changelog timeout", async () => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      let seenSignal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          seenSignal = init?.signal ?? undefined;
          return new Response(
            JSON.stringify({
              output: [{ type: "message", content: [{ type: "output_text", text: "- Updated." }] }],
            }),
            { status: 200 },
          );
        }),
      );

      const text = await __test.generateWithOpenAI({
        slug: "demo",
        version: "1.0.1",
        oldReadme: "old",
        nextReadme: "new",
        fileDiff: null,
      });

      expect(text).toBe("- Updated.");
      expect(seenSignal).toBeInstanceOf(AbortSignal);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/responses",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("aborts a hung OpenAI changelog fetch instead of waiting forever", async () => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      vi.useFakeTimers();
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 20);
        return controller.signal;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
            });
          });
        }),
      );

      const pending = expect(
        __test.generateWithOpenAI({
          slug: "demo",
          version: "1.0.1",
          oldReadme: "old",
          nextReadme: "new",
          fileDiff: null,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(20);
      await pending;
      expect(timeoutSpy).toHaveBeenCalledWith(__test.CHANGELOG_TIMEOUT_MS);
    });
  });
});

describe("changelog preparation failures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(
    (["publish", "preview", "package"] as const).flatMap((flow) =>
      (["missing", "get-error", "text-error"] as const).map((failure) => ({ flow, failure })),
    ),
  )("preserves $flow fallback after $failure", async ({ flow, failure }) => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const previous = {
      files: [
        {
          path: flow === "package" ? "README.mdx" : "SKILLS.md",
          storageId: "first-readme",
          sha256: "first",
        },
        {
          path: flow === "package" ? "README.md" : "SKILL.md",
          storageId: "second-readme",
          sha256: "second",
        },
      ],
    };
    const text = vi.fn(async () => {
      throw new Error("storage text failed");
    });
    const get = vi.fn(async () => {
      if (failure === "get-error") throw new Error("storage read failed");
      return failure === "missing" ? null : { text };
    });
    const runQuery = vi.fn().mockResolvedValue(previous);
    if (flow === "publish") runQuery.mockResolvedValueOnce({ latestVersionId: "previous" });
    const ctx = { runQuery, storage: { get } } as unknown as ActionCtx;
    const args = { slug: "fixture", version: "2.0.0", readmeText: "New README" };

    const result =
      flow === "publish"
        ? await generateChangelogForPublish(ctx, { ...args, files: [] })
        : flow === "preview"
          ? await generateChangelogPreview(ctx, { ...args, previous: previous as never })
          : await generatePackageChangelogPreview(ctx, {
              name: args.slug,
              version: args.version,
              readmeText: args.readmeText,
              latestReleaseId: "previous" as never,
            });

    expect(result).toBe(
      failure === "missing"
        ? "- Initial release."
        : flow === "package"
          ? "- Updated package."
          : "- Updated skill.",
    );
    expect(get).toHaveBeenCalledExactlyOnceWith("first-readme");
    expect(text).toHaveBeenCalledTimes(failure === "text-error" ? 1 : 0);
    expect(provider).not.toHaveBeenCalled();
  });
});
