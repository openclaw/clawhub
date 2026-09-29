/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import inventory from "../convex/lib/bundledPluginCategoryAssignments.json";
import { PLUGIN_CATEGORY_CLASSIFIER_VERSION } from "../convex/lib/pluginCategoryClassification";
import { reviewRow } from "../convex/lib/pluginCategoryReview";
import {
  assertReviewed,
  operate,
  parseOptions,
  previewPages,
  reviewHash,
} from "./plugin-category-operator";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const id = "a".repeat(32);
const secondId = "b".repeat(32);
const env = {
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
  CATEGORY_EXPECTED_SHA: sha,
  CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|test-only",
  CATEGORY_MODE: "preview",
  CATEGORY_RUN_ID: "claw-774-test",
};
const row = () => ({
  _id: id,
  runId: env.CATEGORY_RUN_ID,
  packageId: "package",
  releaseId: "release",
  packageName: "test-plugin",
  version: "1.0.0",
  status: "preview",
  beforeHash: "a".repeat(64),
  beforeCategories: ["tools"],
  categories: ["developer-tools"],
  classification: {
    source: "generated",
    classifierVersion: PLUGIN_CATEGORY_CLASSIFIER_VERSION,
    inputHash: "b".repeat(64),
    evidence: "Reviews code.",
  },
});
function options(mode = "preview", rows = [row()]) {
  return parseOptions({
    ...env,
    CATEGORY_MODE: mode,
    ...(["accept", "apply", "rollback"].includes(mode)
      ? {
          CATEGORY_REVIEWED_IDS: JSON.stringify(rows.map((r) => r._id)),
          CATEGORY_REVIEW_HASH: reviewHash(rows),
        }
      : {}),
  });
}
type Client = Parameters<typeof operate>[0];
function client(overrides: Partial<Client> = {}): Client {
  return {
    run: vi.fn(async () => ({ appBuildSha: sha })) as Client["run"],
    query: vi.fn(async () => []) as Client["query"],
    envNames: vi.fn(async () => ["OPENAI_API_KEY"]),
    model: vi.fn(async () => "gpt-5.6-luna"),
    taxonomyMatches: vi.fn(async () => true),
    ...overrides,
  };
}

describe("production category operator guards", () => {
  it("accepts exact named preview selection only for one cursor-free page", () => {
    const selected = {
      ...env,
      CATEGORY_PACKAGE_NAMES: '["@example/browser"]',
      CATEGORY_MAX_PAGES: "1",
    };
    expect(parseOptions(selected)).toMatchObject({ packageNames: ["@example/browser"] });
    for (const override of [
      { CATEGORY_PACKAGE_NAMES: "not-json" },
      { CATEGORY_PACKAGE_NAMES: '["@example/browser","@example/browser"]' },
      { CATEGORY_PACKAGE_NAMES: '[" @example/browser"]' },
      { CATEGORY_PACKAGE_NAMES: '["@EXAMPLE/browser"]' },
      { CATEGORY_PACKAGE_NAMES: '{"name":"plugin"}' },
      {
        CATEGORY_PACKAGE_NAMES: JSON.stringify(Array.from({ length: 11 }, (_, i) => `plugin-${i}`)),
      },
      { CATEGORY_MODE: "report" },
      { CATEGORY_MAX_PAGES: "2" },
      { CATEGORY_CURSOR: "resume" },
    ])
      expect(() => parseOptions({ ...selected, ...override })).toThrow();
  });
  it.each([
    { GITHUB_REF: "refs/heads/codex/task" },
    { GITHUB_SHA: "b".repeat(40) },
    { CATEGORY_EXPECTED_SHA: "$(echo unsafe)" },
    { CONVEX_DEPLOY_KEY: "prod:academic-chihuahua-392|test-only" },
    { CONVEX_DEPLOY_KEY: "" },
    { CATEGORY_RUN_ID: "bad; command" },
    { CATEGORY_MAX_PAGES: "21" },
    { CATEGORY_WORKERS: "5" },
    { CATEGORY_WORKERS: "1.5" },
    { CATEGORY_MODE: "eval" },
    { CATEGORY_REVIEWED_IDS: "not-json" },
    { CATEGORY_CURSOR: "bad\n" },
  ])("rejects wrong target and malformed request %j", (override) => {
    expect(() => parseOptions({ ...env, ...override })).toThrow();
  });
  it("rejects missing, duplicate, oversized, and injection-shaped review IDs", () => {
    for (const ids of [
      [],
      [id, id],
      ["');ctx.db.delete('x')"],
      Array.from({ length: 101 }, (_, n) => `a${String(n).padStart(31, "0")}`),
    ]) {
      expect(() =>
        parseOptions({
          ...env,
          CATEGORY_MODE: "apply",
          CATEGORY_REVIEWED_IDS: JSON.stringify(ids),
          CATEGORY_REVIEW_HASH: "a".repeat(64),
        }),
      ).toThrow();
    }
  });
  it("stops before any write when deployment SHA or model differs", async () => {
    const wrong = client({ run: vi.fn(async () => ({ appBuildSha: "old" })) as Client["run"] });
    await expect(operate(wrong, options(), vi.fn())).rejects.toThrow("deployed SHA");
    expect(wrong.run).toHaveBeenCalledTimes(1);
    const otherModel = client({
      envNames: async () => ["OPENAI_API_KEY", "OPENAI_PLUGIN_CATEGORY_MODEL"],
      model: async () => "other-model",
    });
    await expect(operate(otherModel, options(), vi.fn())).rejects.toThrow("gpt-5.6-luna");
    expect(otherModel.run).toHaveBeenCalledTimes(1);
    const oldTaxonomy = client({ taxonomyMatches: async () => false });
    await expect(operate(oldTaxonomy, options(), vi.fn())).rejects.toThrow("category contract");
    expect(oldTaxonomy.run).toHaveBeenCalledTimes(1);
  });
  it("requires exact inspected evidence, current classifier and a canonical single purpose", () => {
    const original = row();
    const request = options("accept", [original]);
    assertReviewed([original], request);
    expect(() => assertReviewed([{ ...original, categories: ["other"] }], request)).toThrow(
      "Review hash changed",
    );
    expect(() => assertReviewed([{ ...original, runId: "another-run" }], request)).toThrow(
      "belong",
    );
    const old = {
      ...original,
      classification: {
        ...original.classification,
        classifierVersion: "plugin-single-category-v2",
      },
    };
    expect(() => assertReviewed([old], options("accept", [old]))).toThrow(
      PLUGIN_CATEGORY_CLASSIFIER_VERSION,
    );
    const fallback = {
      ...original,
      classification: { ...original.classification, source: "fallback" },
    };
    expect(() => assertReviewed([fallback], options("accept", [fallback]))).toThrow("Fallback");
    const manifest = {
      ...original,
      categories: ["developer-tools"],
      classification: { ...original.classification, source: "manifest" },
    };
    expect(() => assertReviewed([manifest], options("accept", [manifest]))).not.toThrow();
  });
  it.each([["tools", "runtime"], ["runtime"], ["channels", "scheduling"], ["invented-category"]])(
    "refuses noncanonical reviewed manifest assignment %s",
    (...categories) => {
      const manifest = {
        ...row(),
        categories,
        classification: { ...row().classification, source: "manifest" },
      };
      expect(() => assertReviewed([manifest], options("accept", [manifest]))).toThrow(
        "current category",
      );
    },
  );
  it("checks the exact bundled source pin, input hash, and assignment", () => {
    const entry = inventory.assignments[0];
    const bundled = {
      ...row(),
      packageName: entry.packageName,
      categories: entry.categories,
      classification: {
        source: "bundled",
        classifierVersion: `bundled-product-categories:${inventory.sourceCommit}`,
        inputHash: entry.manifestSha256,
        evidence: "Reviewed manifest",
      },
    };
    assertReviewed([bundled], options("accept", [bundled]));
    const changed = {
      ...bundled,
      classification: { ...bundled.classification, inputHash: "e".repeat(64) },
    };
    expect(() => assertReviewed([changed], options("accept", [changed]))).toThrow(
      "pinned inventory",
    );
  });
  it("binds explicit corrections to selected evidence and requires workflow provenance", () => {
    const correction = {
      id,
      category: "scheduling",
      evidence: "README supplies availability and booking.",
    };
    const request = {
      ...env,
      CATEGORY_MODE: "accept",
      CATEGORY_REVIEWED_IDS: JSON.stringify([id]),
      CATEGORY_CORRECTIONS: JSON.stringify([correction]),
      CATEGORY_REVIEW_HASH: reviewHash([row()], [correction]),
      GITHUB_REPOSITORY: "openclaw/clawhub",
      GITHUB_ACTOR: "reviewer",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
    };
    const parsed = parseOptions(request);
    expect(parsed.provenance).toEqual({
      actor: "reviewer",
      repository: "openclaw/clawhub",
      runId: "123",
      runAttempt: "1",
      sha,
    });
    assertReviewed([row()], parsed);
    expect(() =>
      assertReviewed([row()], {
        ...parsed,
        corrections: [{ ...correction, category: "channels" }],
      }),
    ).toThrow("Review hash changed");
    for (const change of [
      { GITHUB_ACTOR: "" },
      { GITHUB_REPOSITORY: "another/repository" },
      { CATEGORY_MODE: "apply" },
      { CATEGORY_CORRECTIONS: JSON.stringify([{ ...correction, id: secondId }]) },
      { CATEGORY_CORRECTIONS: JSON.stringify([{ ...correction, category: "runtime" }]) },
      { CATEGORY_CORRECTIONS: JSON.stringify([{ ...correction, evidence: " " }]) },
      { CATEGORY_CORRECTIONS: JSON.stringify([{ ...correction, evidence: "x".repeat(501) }]) },
      { CATEGORY_CORRECTIONS: JSON.stringify([{ ...correction, actor: "forged" }]) },
      { CATEGORY_CORRECTIONS: JSON.stringify([correction, correction]) },
    ])
      expect(() => parseOptions({ ...request, ...change })).toThrow();
    for (const source of ["manifest", "bundled", "reviewed"]) {
      const protectedRow = { ...row(), classification: { ...row().classification, source } };
      expect(() =>
        assertReviewed([protectedRow], {
          ...parsed,
          reviewHash: reviewHash([protectedRow], [correction]),
        }),
      ).toThrow("authored and bundled");
    }
  });
  it("hashes ordered assignments independently of status and drops unrelated document bodies", () => {
    const original = {
      ...row(),
      rawSource: "DO NOT EXPORT",
      newReleaseSummary: { secrets: "DO NOT EXPORT" },
    };
    expect(reviewHash([original])).toBe(reviewHash([{ ...original, status: "accepted" }]));
    expect(JSON.stringify(reviewRow(original))).not.toContain("DO NOT EXPORT");
    expect(() =>
      assertReviewed([{ ...original, status: "accepted" }], options("accept", [original])),
    ).toThrow("status");
  });
});

describe("bounded preview checkpoints", () => {
  it("forwards and records the same named selection for planning and preview", async () => {
    const request = parseOptions({
      ...env,
      CATEGORY_PACKAGE_NAMES: '["@example/browser"]',
      CATEGORY_MAX_PAGES: "1",
    });
    const run = vi.fn(async (name: string) =>
      name.endsWith("getPage")
        ? { cursor: "", isDone: true, ids: [id] }
        : { cursor: "", isDone: true, previewed: 1, skipped: 0, failed: 0 },
    ) as Client["run"];
    const result = await previewPages(client({ run }), request, vi.fn());
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith("pluginCategoryRefresh:getPage", {
      batchSize: 10,
      packageNames: ["@example/browser"],
    });
    expect(run).toHaveBeenCalledWith("pluginCategoryRefresh:preview", {
      runId: request.runId,
      batchSize: 10,
      packageNames: ["@example/browser"],
    });
    expect(result).toMatchObject({
      packageNames: ["@example/browser"],
      isDone: true,
      previewed: 1,
    });
  });
  it("preserves bounded skip diagnostics even when no journal row was created", async () => {
    const run = vi.fn(async (name: string) =>
      name.endsWith("getPage")
        ? { cursor: "end", isDone: true, ids: [id, secondId] }
        : {
            cursor: "end",
            isDone: true,
            previewed: 0,
            skipped: 1,
            failed: 1,
            diagnostics: [
              {
                packageId: id,
                reason: "No bounded plugin manifest evidence.",
                rawSource: "DO NOT EXPORT",
              },
              {
                packageId: secondId,
                reason: "Malformed artifact. ".repeat(100),
                rawSource: "DO NOT EXPORT",
              },
            ],
          },
    ) as Client["run"];
    const checkpoint = vi.fn();
    const result = await previewPages(client({ run }), options(), checkpoint);
    expect(result.pages[0].result?.diagnostics).toEqual([
      { packageId: id, reason: "No bounded plugin manifest evidence." },
      { packageId: secondId, reason: "Malformed artifact. ".repeat(100).slice(0, 500) },
    ]);
    expect(JSON.stringify(checkpoint.mock.calls)).not.toContain("DO NOT EXPORT");
    expect(result).toMatchObject({ skipped: 1, failed: 1, isDone: true });
  });
  it("retains the last contiguous cursor when a later page succeeds before an earlier failure", async () => {
    let release: () => void = () => {};
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name.endsWith("getPage")) {
        const index = args.cursor ? Number(String(args.cursor).slice(1)) : 0;
        return { cursor: `c${index + 1}`, isDone: index === 2, ids: [id] };
      }
      if (!args.cursor) {
        await delayed;
        throw new Error("transport failure");
      }
      release();
      return { cursor: "c2", isDone: false, previewed: 1, skipped: 0, failed: 0 };
    }) as Client["run"];
    const saved: Record<string, unknown>[] = [];
    const result = await previewPages(
      client({ run }),
      { ...options(), maxPages: 2, workers: 2 },
      async (value) => {
        saved.push(value);
      },
    );
    expect(result.resumeCursor).toBeNull();
    expect(result.completedPages).toBe(1);
    expect(result.failedPages).toEqual([0]);
    expect(saved.at(-1)).toEqual(result);
    expect(run).toHaveBeenCalledWith("pluginCategoryRefresh:preview", {
      runId: env.CATEGORY_RUN_ID,
      batchSize: 10,
      cursor: "c1",
    });
  });
  it("bounds calls, continues empty package pages, and reports the next resumable cursor", async () => {
    const run = vi.fn(async (name: string, args: Record<string, unknown>) => {
      const index = args.cursor ? Number(String(args.cursor).slice(1)) : 0;
      return name.endsWith("getPage")
        ? { cursor: `c${index + 1}`, isDone: false, ids: [] }
        : { cursor: `c${index + 1}`, isDone: false, previewed: 0, skipped: 0, failed: 0 };
    }) as Client["run"];
    const result = await previewPages(
      client({ run }),
      { ...options(), maxPages: 2 },
      async () => {},
    );
    expect(result.resumeCursor).toBe("c2");
    expect(result.isDone).toBe(false);
    expect(run).toHaveBeenCalledTimes(4);
  });
  it("leaves a replayable hole if corpus changes alter a pre-enumerated boundary", async () => {
    const run = vi.fn(async (name: string) =>
      name.endsWith("getPage")
        ? { cursor: "planned", isDone: true, ids: [] }
        : { cursor: "moved", isDone: true, previewed: 1, skipped: 0, failed: 0 },
    ) as Client["run"];
    const result = await previewPages(client({ run }), options(), async () => {});
    expect(result.resumeCursor).toBeNull();
    expect(result.failedPages).toEqual([0]);
  });
});

describe("reviewed write waves", () => {
  it("reports applied and stale separately instead of counting every processed row as applied", async () => {
    const rows = [
      { ...row(), status: "applied" },
      { ...row(), _id: secondId, status: "stale", reason: "Latest release changed." },
    ];
    const c = client({ query: vi.fn(async () => rows) as Client["query"] });
    const request = parseOptions({
      ...env,
      CATEGORY_MODE: "report",
      CATEGORY_REVIEWED_IDS: JSON.stringify([id, secondId]),
    });
    const report = await operate(c, request, async () => {});
    expect(report).toMatchObject({ rowCount: 2, statuses: { applied: 1, stale: 1 } });
    expect("rows" in report && report.rows[1]).toMatchObject({
      status: "stale",
      reason: "Latest release changed.",
    });
  });
  function writeClient(
    rows: ReturnType<typeof row>[],
    accepted: Array<{ id: string; runId: string }> = [],
  ) {
    let started = false;
    return client({
      query: vi.fn(async (source: string) =>
        source.includes("by_status") ? accepted : rows,
      ) as Client["query"],
      run: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === "appMeta:getDeploymentInfo") return { appBuildSha: sha };
        if (name === "lib:getStatus")
          return started ? [{ state: "success", processed: rows.length, isDone: true }] : [];
        if (name === "pluginCategoryRefresh:accept") return { accepted: rows.length };
        if (name === "pluginCategoryRefresh:rollback") return { rolledBack: true };
        if (name === "migrations:run" && !args.dryRun) started = true;
        return {
          DryRun: "No changes were committed.",
          Name: "migrations:applyAcceptedPluginCategoryRefreshes",
          Status: "DRY RUN: Migration was started and finished in one batch.",
          processed: rows.length,
        };
      }) as Client["run"],
    });
  }
  it("accepts only reviewed rows and rehearses through the rollback-aware runner", async () => {
    const c = writeClient([row()]);
    const result = await operate(c, options("accept"), async () => {});
    expect(result).toMatchObject({ accepted: 1, dryRun: { transactionRolledBack: true } });
    expect(c.run).toHaveBeenCalledWith("migrations:run", {
      fn: "migrations:applyAcceptedPluginCategoryRefreshes",
      batchSize: 10,
      reset: true,
      dryRun: true,
    });
  });
  it("reports the original proposal, seals a fallback correction, and preserves its hash during apply", async () => {
    const original = {
      ...row(),
      categories: ["other"],
      classification: { ...row().classification, source: "fallback" },
    };
    const correction = {
      id,
      category: "scheduling",
      evidence: "Published documentation supplies booking availability.",
    };
    const reportRequest = parseOptions({
      ...env,
      CATEGORY_MODE: "report",
      CATEGORY_REVIEWED_IDS: JSON.stringify([id]),
      CATEGORY_CORRECTIONS: JSON.stringify([correction]),
    });
    const report = await operate(writeClient([original]), reportRequest, async () => {});
    expect(report).toMatchObject({
      rows: [
        {
          categories: ["other"],
          classification: { source: "fallback" },
          review: { category: "scheduling", evidence: correction.evidence },
        },
      ],
    });
    const provenance = {
      actor: "reviewer",
      repository: "openclaw/clawhub" as const,
      runId: "123",
      runAttempt: "1",
      sha,
    };
    const hash = reviewHash([original], [correction]);
    const acceptClient = writeClient([original]);
    await expect(
      operate(
        acceptClient,
        { ...reportRequest, mode: "accept", reviewHash: hash, provenance },
        async () => {},
      ),
    ).resolves.toMatchObject({ accepted: 1, dryRun: { transactionRolledBack: true } });
    expect(acceptClient.run).toHaveBeenCalledWith("pluginCategoryRefresh:accept", {
      ids: [id],
      confirm: "apply-plugin-category-refresh",
      reviewHash: hash,
      corrections: [correction],
      provenance,
    });
    const sealed = {
      ...original,
      status: "accepted",
      review: {
        category: correction.category,
        evidence: correction.evidence,
        sourceHash: "c".repeat(64),
        provenance,
      },
    };
    expect(reviewHash([sealed])).toBe(hash);
    const acceptedReport = await operate(
      writeClient([sealed]),
      { ...reportRequest, corrections: [] },
      async () => {},
    );
    expect(acceptedReport).toMatchObject({
      reviewHash: hash,
      rows: [{ reviewSourceHash: "c".repeat(64), reviewProvenance: provenance }],
    });
    const applyClient = writeClient([sealed], [{ id, runId: env.CATEGORY_RUN_ID }]);
    await expect(
      operate(
        applyClient,
        { ...reportRequest, corrections: [], mode: "apply", reviewHash: hash },
        async () => {},
      ),
    ).resolves.toMatchObject({ started: true });
    expect(applyClient.run).not.toHaveBeenCalledWith(
      "pluginCategoryRefresh:accept",
      expect.anything(),
    );
  });
  it("blocks global migration when a foreign or unreviewed accepted row exists", async () => {
    const acceptedRow = { ...row(), status: "accepted" };
    for (const waiting of [
      { id: secondId, runId: env.CATEGORY_RUN_ID },
      { id, runId: "foreign-run" },
    ]) {
      const c = writeClient([acceptedRow], [waiting]);
      await expect(operate(c, options("apply", [acceptedRow]), async () => {})).rejects.toThrow(
        "Foreign accepted",
      );
      expect(c.run).not.toHaveBeenCalledWith("migrations:run", expect.anything());
    }
  });
  it("starts only the exact accepted wave", async () => {
    const acceptedRow = { ...row(), status: "accepted" };
    const c = writeClient([acceptedRow], [{ id, runId: env.CATEGORY_RUN_ID }]);
    await expect(
      operate(c, options("apply", [acceptedRow]), async () => {}),
    ).resolves.toMatchObject({ started: true });
  });
  it.each([0, 2])(
    "refuses apply when rehearsal processes %i instead of the reviewed row",
    async (processed) => {
      const acceptedRow = { ...row(), status: "accepted" };
      const c = writeClient([acceptedRow], [{ id, runId: env.CATEGORY_RUN_ID }]);
      const original = c.run;
      c.run = vi.fn(async (name: string, args: Record<string, unknown>, component?: boolean) => {
        const result = await original(name, args, component);
        return name === "migrations:run" && args.dryRun
          ? { ...(result as object), processed }
          : result;
      }) as Client["run"];
      await expect(operate(c, options("apply", [acceptedRow]), async () => {})).rejects.toThrow(
        "did not exercise",
      );
      expect(c.run).not.toHaveBeenCalledWith("migrations:run", {
        fn: "migrations:applyAcceptedPluginCategoryRefreshes",
        batchSize: 10,
        reset: true,
      });
    },
  );
  it("fails and checkpoints a no-op rollback instead of reporting success", async () => {
    const applied = { ...row(), status: "applied" };
    const c = writeClient([applied]);
    const original = c.run;
    c.run = (async (name: string, args: Record<string, unknown>, component?: boolean) =>
      name === "pluginCategoryRefresh:rollback"
        ? { rolledBack: false }
        : original(name, args, component)) as Client["run"];
    const checkpoint = vi.fn();
    await expect(operate(c, options("rollback", [applied]), checkpoint)).rejects.toThrow(
      "did not restore",
    );
    expect(checkpoint).toHaveBeenCalledWith({ results: [{ id, rolledBack: false }] });
  });
  it("fails and checkpoints an apply when the component reports an immediate batch failure", async () => {
    const acceptedRow = { ...row(), status: "accepted" };
    const c = writeClient([acceptedRow], [{ id, runId: env.CATEGORY_RUN_ID }]);
    const original = c.run;
    let applied = false;
    c.run = (async (name: string, args: Record<string, unknown>, component?: boolean) => {
      if (name === "migrations:run") applied = true;
      if (name === "lib:getStatus" && applied)
        return [{ state: "failed", processed: 0, isDone: false, error: "batch failed" }];
      return original(name, args, component);
    }) as Client["run"];
    const checkpoint = vi.fn();
    await expect(operate(c, options("apply", [acceptedRow]), checkpoint)).rejects.toThrow(
      "failed to start",
    );
    expect(checkpoint).toHaveBeenCalledWith({
      reviewedIds: [id],
      migration: [
        { state: "failed", processed: 0, isDone: false, cursor: undefined, hasError: true },
      ],
    });
  });
  it("does not reset an active worker or treat a failed rehearsal as successful", async () => {
    const active = writeClient([row()]);
    const original = active.run;
    active.run = (async (name: string, args: Record<string, unknown>, component?: boolean) =>
      name === "lib:getStatus"
        ? [{ state: "inProgress", processed: 0, isDone: false }]
        : original(name, args, component)) as Client["run"];
    await expect(operate(active, options("accept"), async () => {})).rejects.toThrow(
      "active migration",
    );
    const failed = writeClient([row()]);
    const originalFailed = failed.run;
    failed.run = (async (name: string, args: Record<string, unknown>, component?: boolean) =>
      name === "migrations:run"
        ? {
            DryRun: "No changes were committed.",
            Name: "migrations:applyAcceptedPluginCategoryRefreshes",
            Status: "DRY RUN: Migration failed: source failure",
            processed: 0,
          }
        : originalFailed(name, args, component)) as Client["run"];
    await expect(operate(failed, options("accept"), async () => {})).rejects.toThrow(
      "dry run failed",
    );
  });
  it("keeps rollback available for applied older classifications and uses backend hash guard", async () => {
    const applied = {
      ...row(),
      status: "applied",
      classification: { ...row().classification, classifierVersion: "older" },
    };
    const c = writeClient([applied]);
    await operate(c, options("rollback", [applied]), async () => {});
    expect(c.run).toHaveBeenCalledWith("pluginCategoryRefresh:rollback", {
      id,
      confirm: "rollback-plugin-category-refresh",
    });
  });
});
