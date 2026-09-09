import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { PLUGIN_CATEGORY_DEFINITIONS } from "clawhub-schema";
import inventory from "../convex/lib/bundledPluginCategoryAssignments.json";

const TARGET = "wry-manatee-359";
const CLASSIFIER = "plugin-single-category-v3";
const SOURCE = "3bf34b0570d3e55ad16f7c4cb25249797a59042b";
const MIGRATION = "migrations:applyAcceptedPluginCategoryRefreshes";
const MODES = ["preview", "report", "accept", "apply", "status", "rollback"] as const;
type Mode = (typeof MODES)[number];
type Json = Record<string, unknown>;
type Row = {
  _id: string;
  runId: string;
  packageId: string;
  releaseId: string;
  packageName: string;
  version: string;
  status: string;
  reason?: string;
  beforeHash: string;
  beforeCategories?: string[];
  categories: string[];
  classification: {
    source: string;
    classifierVersion: string;
    inputHash: string;
    evidence: string;
  };
};
type Page = { cursor: string; isDone: boolean; ids: string[] };
type Preview = Omit<Page, "ids"> & {
  previewed: number;
  skipped: number;
  failed: number;
  diagnostics?: Array<{ packageId: string; reason: string }>;
};
type Options = {
  mode: Mode;
  sha: string;
  runId: string;
  cursor: string | null;
  maxPages: number;
  workers: number;
  ids: string[];
  reviewHash: string;
};
type Client = {
  run: <T>(name: string, args: Json, component?: boolean) => Promise<T>;
  query: <T>(source: string) => Promise<T>;
  envNames: () => Promise<string[]>;
  model: () => Promise<string>;
  taxonomyMatches: () => Promise<boolean>;
};

class OperatorError extends Error {}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new OperatorError(message);
}

export function parseOptions(env: NodeJS.ProcessEnv): Options {
  requireValue(env.GITHUB_REF === "refs/heads/main", "Production operator requires main.");
  const sha = env.CATEGORY_EXPECTED_SHA ?? "";
  requireValue(
    /^[a-f0-9]{40}$/.test(sha) && sha === env.GITHUB_SHA,
    "Exact checkout SHA required.",
  );
  requireValue(
    env.CONVEX_DEPLOY_KEY?.startsWith(`prod:${TARGET}|`),
    "Production credential must target wry-manatee-359.",
  );
  requireValue(inventory.sourceCommit === SOURCE, "Reviewed bundled source pin changed.");
  const mode = env.CATEGORY_MODE as Mode;
  requireValue(MODES.includes(mode), "Unsupported operator mode.");
  const runId = env.CATEGORY_RUN_ID ?? "";
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId), "Invalid run ID.");
  const cursor = env.CATEGORY_CURSOR || null;
  requireValue(
    cursor === null || (cursor.length <= 8192 && !/[\r\n]/.test(cursor)),
    "Invalid cursor.",
  );
  const maxPages = Number(env.CATEGORY_MAX_PAGES ?? "10");
  const workers = Number(env.CATEGORY_WORKERS ?? "3");
  requireValue(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 20, "Use 1–20 pages.");
  requireValue(Number.isInteger(workers) && workers >= 1 && workers <= 4, "Use 1–4 workers.");
  let ids: unknown;
  try {
    ids = JSON.parse(env.CATEGORY_REVIEWED_IDS || "[]");
  } catch {
    throw new OperatorError("Reviewed IDs must be a JSON array.");
  }
  requireValue(
    Array.isArray(ids) &&
      ids.length <= 100 &&
      ids.every((id) => typeof id === "string" && /^[a-z0-9]{20,64}$/.test(id)),
    "Use at most 100 valid journal IDs.",
  );
  requireValue(new Set(ids).size === ids.length, "Duplicate reviewed IDs.");
  const reviewHash = env.CATEGORY_REVIEW_HASH || "";
  if (["accept", "apply", "rollback"].includes(mode)) {
    requireValue(
      ids.length > 0 && /^[a-f0-9]{64}$/.test(reviewHash),
      "Reviewed IDs and SHA-256 review hash required.",
    );
    requireValue(cursor === null, "Write modes do not accept a cursor.");
  } else {
    requireValue(!reviewHash, "Review hash is only accepted by write modes.");
    requireValue(
      mode === "report" || ids.length === 0,
      "Reviewed IDs are only supported by report and write modes.",
    );
  }
  return { mode, sha, runId, cursor, maxPages, workers, ids, reviewHash };
}

// Only selected category evidence enters artifacts; never archive release bodies,
// source files, CLI stderr, environment output, or arbitrary database documents.
export function reviewRow(row: Row) {
  return {
    id: row._id,
    runId: row.runId,
    packageId: row.packageId,
    releaseId: row.releaseId,
    packageName: row.packageName,
    version: row.version,
    beforeHash: row.beforeHash,
    beforeCategories: row.beforeCategories ?? [],
    categories: row.categories,
    classification: {
      source: row.classification.source,
      classifierVersion: row.classification.classifierVersion,
      inputHash: row.classification.inputHash,
      evidence: row.classification.evidence.slice(0, 500),
    },
  };
}

export function reviewHash(rows: Row[]) {
  return createHash("sha256")
    .update(JSON.stringify(rows.map(reviewRow).sort((a, b) => a.id.localeCompare(b.id))))
    .digest("hex");
}

function reportRows(rows: Row[]) {
  const statuses: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const row of rows) {
    statuses[row.status] = (statuses[row.status] ?? 0) + 1;
    sources[row.classification.source] = (sources[row.classification.source] ?? 0) + 1;
  }
  return {
    rows: rows.map((row) => ({
      ...reviewRow(row),
      status: row.status,
      reason: row.reason?.slice(0, 500),
    })),
    rowCount: rows.length,
    statuses,
    sources,
    reviewHash: reviewHash(rows),
  };
}

export function assertReviewed(rows: Row[], options: Options) {
  requireValue(
    rows.length === options.ids.length && rows.every(Boolean),
    "A reviewed row is missing.",
  );
  requireValue(
    rows.every((row) => options.ids.includes(row._id) && row.runId === options.runId),
    "Reviewed rows must belong to this run.",
  );
  requireValue(
    reviewHash(rows) === options.reviewHash,
    "Review hash changed; report and review again.",
  );
  const status = { accept: "preview", apply: "accepted", rollback: "applied" }[
    options.mode as "accept" | "apply" | "rollback"
  ];
  requireValue(
    rows.every((row) => row.status === status),
    "Journal status does not match this operation.",
  );
  // Rollback remains possible for an applied older classifier. The backend's
  // afterHash guard prevents overwriting subsequent publication/editor changes.
  if (options.mode === "rollback") return;
  for (const row of rows) {
    const c = row.classification;
    requireValue(
      /^[a-f0-9]{64}$/.test(row.beforeHash) && /^[a-f0-9]{64}$/.test(c.inputHash),
      "Missing source/evidence hash.",
    );
    requireValue(
      c.source === "manifest" || c.source === "generated" || c.source === "bundled",
      "Fallback classifications cannot be applied.",
    );
    if (c.source === "bundled") {
      const assignment = inventory.assignments.find(
        (entry) => entry.packageName === row.packageName,
      );
      requireValue(
        c.classifierVersion === `bundled-product-categories:${SOURCE}` &&
          assignment?.manifestSha256 === c.inputHash &&
          JSON.stringify(assignment.categories) === JSON.stringify(row.categories),
        "Bundled preview no longer matches the pinned inventory.",
      );
    } else {
      requireValue(c.classifierVersion === CLASSIFIER, "Generate a fresh v3 preview.");
    }
    requireValue(
      row.categories.length >= 1 && row.categories.length <= (c.source === "manifest" ? 3 : 1),
      "Invalid category count.",
    );
  }
}

export async function previewPages(
  client: Client,
  options: Options,
  checkpoint: (value: Json) => Promise<void>,
) {
  const pages: Array<{ input: string | null; page: Page }> = [];
  let cursor = options.cursor;
  for (let i = 0; i < options.maxPages; i++) {
    const page = await client.run<Page>("pluginCategoryRefresh:getPage", {
      batchSize: 10,
      ...(cursor ? { cursor } : {}),
    });
    requireValue(
      page.isDone || (page.cursor && page.cursor !== cursor),
      "Page cursor did not advance.",
    );
    pages.push({ input: cursor, page });
    cursor = page.cursor;
    if (page.isDone) break;
  }
  const completed: Array<Preview | undefined> = [];
  const failures: number[] = [];
  let next = 0;
  const state = () => {
    let contiguous = 0;
    while (completed[contiguous]) contiguous++;
    const last = completed[contiguous - 1];
    return {
      runId: options.runId,
      inputCursor: options.cursor,
      resumeCursor: last?.cursor ?? options.cursor,
      isDone: last?.isDone ?? false,
      completedPages: completed.filter(Boolean).length,
      plannedPages: pages.length,
      failedPages: [...failures],
      previewed: completed.reduce((sum, item) => sum + (item?.previewed ?? 0), 0),
      skipped: completed.reduce((sum, item) => sum + (item?.skipped ?? 0), 0),
      failed: completed.reduce((sum, item) => sum + (item?.failed ?? 0), 0),
      pages: pages.map((page, index) => ({
        index,
        inputCursor: page.input,
        result: completed[index] ?? null,
      })),
    };
  };
  // Serialize artifact replacement while workers finish out of order. Never
  // advance past a hole: retries reuse runId and the server skips stored rows.
  let saving = Promise.resolve();
  const save = () => {
    const value = state();
    saving = saving.then(() => checkpoint(value));
    return saving;
  };
  await save();
  await Promise.all(
    Array.from({ length: options.workers }, async () => {
      while (next < pages.length && failures.length === 0) {
        const index = next++;
        const page = pages[index];
        try {
          const result = await client.run<Preview>("pluginCategoryRefresh:preview", {
            runId: options.runId,
            batchSize: 10,
            ...(page.input ? { cursor: page.input } : {}),
          });
          // A moving corpus can change page boundaries. Resume from the last
          // contiguous result and reconcile from the beginning after the sweep.
          requireValue(
            result.cursor === page.page.cursor && result.isDone === page.page.isDone,
            "Page boundaries changed; resume from checkpoint.",
          );
          completed[index] = {
            cursor: result.cursor,
            isDone: result.isDone,
            previewed: result.previewed,
            skipped: result.skipped,
            failed: result.failed,
            diagnostics: (result.diagnostics ?? []).slice(0, 10).map(({ packageId, reason }) => ({
              packageId: packageId.slice(0, 64),
              reason: reason.slice(0, 500),
            })),
          };
        } catch {
          failures.push(index);
        }
        await save();
      }
    }),
  );
  return state();
}

async function selectedRows(client: Client, ids: string[]) {
  return client.query<Row[]>(
    `return await Promise.all(${JSON.stringify(ids)}.map(id => ctx.db.get(id)));`,
  );
}

async function acceptedRows(client: Client) {
  return client.query<Array<{ id: string; runId: string }>>(
    'return (await ctx.db.query("pluginCategoryRefreshes").withIndex("by_status", q => q.eq("status", "accepted")).take(101)).map(row => ({id: row._id, runId: row.runId}));',
  );
}

async function migrationStatus(client: Client) {
  const rows = await client.run<
    Array<{ state: string; processed: number; isDone: boolean; cursor?: string; error?: string }>
  >("lib:getStatus", { names: [MIGRATION] }, true);
  return rows.map(({ state, processed, isDone, cursor, error }) => ({
    state,
    processed,
    isDone,
    cursor,
    hasError: Boolean(error),
  }));
}

async function rehearse(client: Client, reviewedCount: number) {
  // The runner catches the component's DRY RUN rollback and returns formatted
  // status. Calling the defined migration directly would surface an error.
  const result = await client.run<{
    DryRun: string;
    Name: string;
    Status: string;
    processed: number;
  }>("migrations:run", { fn: MIGRATION, batchSize: 10, reset: true, dryRun: true });
  requireValue(
    result.DryRun === "No changes were committed." &&
      result.Name === MIGRATION &&
      result.Status.startsWith("DRY RUN: ") &&
      !result.Status.includes("failed:") &&
      result.processed === Math.min(reviewedCount, 10),
    "Migration dry run failed or did not exercise the reviewed batch; accepted rows remain for inspection.",
  );
  return { processed: result.processed, transactionRolledBack: true };
}

export async function operate(
  client: Client,
  options: Options,
  checkpoint: (value: Json) => Promise<void>,
) {
  // This is a preflight, not a deployment lock. The operator runbook requires
  // deployments to stay frozen through migration completion; per-row backend
  // guards separately reject stale evidence, classifiers, and bundled inputs.
  const deployed = await client.run<{ appBuildSha: string }>("appMeta:getDeploymentInfo", {});
  requireValue(
    deployed.appBuildSha === options.sha,
    "Production deployed SHA differs from the reviewed checkout.",
  );
  requireValue(
    await client.taxonomyMatches(),
    "Public category contract differs from this checkout.",
  );
  if (options.mode === "preview" || options.mode === "status") {
    const names = await client.envNames();
    const model = names.includes("OPENAI_PLUGIN_CATEGORY_MODEL")
      ? (await client.model()).trim()
      : "gpt-5.6-luna";
    const config = {
      hasApiKey: names.includes("OPENAI_API_KEY"),
      usesLuna: model === "gpt-5.6-luna",
    };
    if (options.mode === "status")
      return {
        config,
        migration: await migrationStatus(client),
        accepted: await acceptedRows(client),
      };
    requireValue(
      config.hasApiKey && config.usesLuna,
      "Production classifier requires OPENAI_API_KEY and gpt-5.6-luna.",
    );
    return previewPages(client, options, checkpoint);
  }
  if (options.mode === "report") {
    if (options.ids.length) {
      const rows = await selectedRows(client, options.ids);
      requireValue(
        rows.every((row) => row && row.runId === options.runId),
        "Reviewed rows must belong to this run.",
      );
      return reportRows(rows);
    }
    const rows: Row[] = [];
    let cursor = options.cursor;
    let isDone = false;
    for (let page = 0; page < options.maxPages && !isDone; page++) {
      const result = await client.run<{ page: Row[]; continueCursor: string; isDone: boolean }>(
        "pluginCategoryRefresh:list",
        { runId: options.runId, paginationOpts: { cursor, numItems: 100 } },
      );
      requireValue(
        result.isDone || result.continueCursor !== cursor,
        "Report cursor did not advance.",
      );
      rows.push(...result.page);
      cursor = result.continueCursor;
      isDone = result.isDone;
    }
    return { ...reportRows(rows), resumeCursor: cursor, isDone };
  }
  const rows = await selectedRows(client, options.ids);
  assertReviewed(rows, options);
  const status = await migrationStatus(client);
  requireValue(
    !status.some((row) => row.state === "inProgress"),
    "Wait for the active migration worker before writing.",
  );
  const accepted = await acceptedRows(client);
  requireValue(
    accepted.every((row) => row.runId === options.runId && options.ids.includes(row.id)),
    "Foreign accepted rows must be resolved before this wave.",
  );
  if (options.mode === "rollback") {
    const results = [];
    for (const id of options.ids) {
      const result = await client.run<{ rolledBack: boolean }>("pluginCategoryRefresh:rollback", {
        id,
        confirm: "rollback-plugin-category-refresh",
      });
      results.push({ id, ...result });
      await checkpoint({ results });
      requireValue(
        result.rolledBack,
        "Rollback did not restore the selected row; inspect the checkpoint before retrying.",
      );
    }
    return { results };
  }
  if (options.mode === "accept") {
    const result = await client.run<{ accepted: number }>("pluginCategoryRefresh:accept", {
      ids: options.ids,
      confirm: "apply-plugin-category-refresh",
    });
    requireValue(
      result.accepted === rows.length,
      "Not all reviewed rows were accepted; inspect status.",
    );
    const dryRun = await rehearse(client, rows.length);
    return {
      accepted: result.accepted,
      dryRun,
      reviewHash: options.reviewHash,
    };
  }
  requireValue(accepted.length === rows.length, "Accepted wave differs from reviewed rows.");
  // Acceptance survives a failed/lost rehearsal response. A fresh rehearsal
  // prevents apply from bypassing that gate and allows a safe retry.
  const dryRun = await rehearse(client, rows.length);
  // Accepted rows are removed from the status index after each successful batch.
  // Reset only with no active worker; this safely resumes the remaining reviewed
  // rows even if an earlier wave reached the old end of that index.
  await client.run("migrations:run", { fn: MIGRATION, batchSize: 10, reset: true });
  const migration = await migrationStatus(client);
  // The component catches batch errors and returns a failed state instead of
  // rejecting the RPC. Preserve that outcome and fail the workflow explicitly.
  await checkpoint({ reviewedIds: options.ids, migration });
  requireValue(
    migration.length === 1 &&
      migration.every((row) => !row.hasError && ["inProgress", "success"].includes(row.state)),
    "Migration failed to start successfully; inspect status and remaining accepted rows.",
  );
  return { started: true, reviewedIds: options.ids, migration, dryRun };
}

const execute = promisify(execFile);
export function processFailureClass(error: unknown) {
  const failure = error as { code?: unknown; killed?: unknown } | null;
  if (failure?.killed === true) return "timeout";
  if (failure?.code === "ENOENT") return "executable-missing";
  if (failure?.code === "EACCES") return "executable-denied";
  if (failure?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "output-limit";
  if (typeof failure?.code === "number" && Number.isInteger(failure.code))
    return `exit-${failure.code}`;
  return "process-error";
}

export function createConvexCliClient(): Client {
  const invoke = async (operation: string, args: string[]) => {
    try {
      // A named --deployment bypasses deploy-key resolution in Convex CLI.
      // parseOptions already binds the credential to prod:wry-manatee-359;
      // let that credential select its deployment without a cloud-login path.
      const { stdout } = await execute("node", ["node_modules/convex/bin/main.js", ...args], {
        timeout: 240_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      // CLI diagnostics can include source or deployment configuration. Never
      // forward stdout/stderr/error objects to Actions logs or proof artifacts.
      throw new OperatorError(
        `Convex ${operation} failed (${processFailureClass(error)}); inspect the deployed function and retry the checkpoint.`,
      );
    }
  };
  return {
    run: async <T>(name: string, args: Json, component = false) =>
      JSON.parse(
        await invoke(name, [
          "run",
          "--codegen",
          "disable",
          ...(component ? ["--component", "migrations"] : []),
          name,
          JSON.stringify(args),
        ]),
      ) as T,
    query: async <T>(source: string) =>
      JSON.parse(
        await invoke("journal-query", ["run", "--codegen", "disable", "--inline-query", source]),
      ) as T,
    envNames: async () =>
      (await invoke("environment-names", ["env", "list", "--names-only"]))
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean),
    model: () => invoke("category-model", ["env", "get", "OPENAI_PLUGIN_CATEGORY_MODEL"]),
    taxonomyMatches: async () => {
      const response = await fetch("https://clawhub.ai/api/v1/plugins/categories", {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return false;
      const result = (await response.json()) as {
        categories?: Array<{ slug: string; icon: string }>;
      };
      const expected = PLUGIN_CATEGORY_DEFINITIONS.map(({ slug, icon }) => ({ slug, icon }));
      return (
        JSON.stringify(result.categories?.map(({ slug, icon }) => ({ slug, icon }))) ===
        JSON.stringify(expected)
      );
    },
  };
}

if (import.meta.main) {
  const directory = "artifacts/plugin-category-operator";
  const checkpoint = async (value: Json) => {
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/result.json.tmp`, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(`${directory}/result.json.tmp`, `${directory}/result.json`);
  };
  try {
    const options = parseOptions(process.env);
    const result = await operate(createConvexCliClient(), options, checkpoint);
    await checkpoint({
      target: TARGET,
      expectedSha: options.sha,
      runId: options.runId,
      mode: options.mode,
      ...result,
    });
    const summary = {
      target: TARGET,
      mode: options.mode,
      runId: options.runId,
      ...Object.fromEntries(
        Object.entries(result).filter(([key]) =>
          [
            "resumeCursor",
            "isDone",
            "completedPages",
            "plannedPages",
            "previewed",
            "skipped",
            "failed",
            "failedPages",
            "reviewHash",
            "accepted",
            "started",
            "config",
            "migration",
            "rowCount",
            "statuses",
            "sources",
          ].includes(key),
        ),
      ),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `\nCategory operator result\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`,
      );
    if ("failedPages" in result && (result.failedPages as number[]).length) process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof OperatorError
        ? error.message
        : "Operator failed; inspect the checkpoint and retry.",
    );
    process.exitCode = 1;
  }
}
