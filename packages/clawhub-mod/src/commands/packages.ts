import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import {
  appealModerationPlan,
  presentModerationPlan,
  reportModerationPlan,
} from "../../../clawhub/src/cli/commands/moderationPlan.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import {
  createSpinner,
  escapeTerminalControlCharacters,
  fail,
  formatError,
} from "../../../clawhub/src/cli/ui.js";
import { apiRequest, registryUrl } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1PackageArtifactBackfillResponseSchema,
  ApiV1PackageAppealListResponseSchema,
  ApiV1PackageAppealResolveResponseSchema,
  ApiV1PackageDryRunScanJobResponseSchema,
  ApiV1PackageDryRunScanResultsResponseSchema,
  ApiV1PackageDryRunScanStartResponseSchema,
  ApiV1PackageModerationQueueResponseSchema,
  ApiV1PackageOfficialMigrationListResponseSchema,
  ApiV1PackageOfficialMigrationResponseSchema,
  ApiV1PackageReleaseModerationResponseSchema,
  ApiV1PackageReportListResponseSchema,
  ApiV1PackageReportTriageResponseSchema,
  ApiV1PackageTrustedPublisherResponseSchema,
  type PackageAppealFinalAction,
  type PackageAppealListStatus,
  type PackageAppealStatus,
  type ApiV1PackageDryRunScanJobResponse,
  type PackageDryRunScanSelector,
  type PackageDryRunScanResultItem,
  type PackageModerationQueueStatus,
  type PackageOfficialMigrationListPhase,
  type PackageReportFinalAction,
  type PackageReportListStatus,
  type PackageReportStatus,
  type PackageReleaseModerationState,
  type PackageTrustedPublisher,
} from "../../../clawhub/src/schema/index.js";

type PackageTrustedPublisherSetOptions = {
  repository?: string;
  workflowFilename?: string;
  environment?: string;
  json?: boolean;
};

type PackageTrustedPublisherDeleteOptions = {
  json?: boolean;
};

type PackageModerateOptions = {
  version?: string;
  state?: PackageReleaseModerationState;
  reason?: string;
  json?: boolean;
};

type PackageAppealListOptions = {
  status?: PackageAppealListStatus;
  cursor?: string;
  limit?: number;
  json?: boolean;
};

type PackageAppealResolveOptions = {
  status?: PackageAppealStatus;
  note?: string;
  action?: PackageAppealFinalAction;
  finalAction?: PackageAppealFinalAction;
  yes?: boolean;
  json?: boolean;
};

type PackageReportListOptions = {
  status?: PackageReportListStatus;
  cursor?: string;
  limit?: number;
  json?: boolean;
};

type PackageReportTriageOptions = {
  status?: PackageReportStatus;
  note?: string;
  action?: PackageReportFinalAction;
  finalAction?: PackageReportFinalAction;
  yes?: boolean;
  json?: boolean;
};

type PackageModerationQueueOptions = {
  status?: PackageModerationQueueStatus;
  cursor?: string;
  limit?: number;
  json?: boolean;
};

type PackageBackfillArtifactsOptions = {
  cursor?: string;
  batchSize?: number;
  apply?: boolean;
  all?: boolean;
  json?: boolean;
};

type PackageDryRunScanStartOptions = {
  releaseId?: string[];
  package?: string[];
  latestActive?: boolean;
  allActive?: boolean;
  seed?: string;
  limit?: number;
  maxCandidates?: number;
  json?: boolean;
};

type PackageDryRunScanStatusOptions = {
  json?: boolean;
};

type PackageDryRunScanWatchOptions = PackageDryRunScanStatusOptions & {
  intervalMs?: number;
  maxAttempts?: number;
};

type PackageDryRunScanExportOptions = {
  cursor?: string;
  limit?: number;
  allowPartial?: boolean;
  json?: boolean;
  jsonl?: boolean;
};

type PackageMigrationListOptions = {
  phase?: PackageOfficialMigrationListPhase;
  cursor?: string;
  limit?: number;
  json?: boolean;
};

type PackageMigrationUpsertOptions = {
  package?: string;
  owner?: string;
  sourceRepo?: string;
  sourcePath?: string;
  sourceCommit?: string;
  phase?: string;
  blockers?: string;
  hostTargetsComplete?: boolean;
  scanClean?: boolean;
  moderationApproved?: boolean;
  runtimeBundlesReady?: boolean;
  notes?: string;
  json?: boolean;
};

const DEFAULT_DRY_RUN_SCAN_WATCH_INTERVAL_MS = 2_000;
const DEFAULT_DRY_RUN_SCAN_WATCH_MAX_ATTEMPTS = 150;
const PACKAGE_DRY_RUN_SCAN_MAX_EXPLICIT_SELECTORS = 200;
const PACKAGE_DRY_RUN_SCAN_MAX_LIMIT = 200;
const PACKAGE_DRY_RUN_SCAN_MAX_CANDIDATES = 1_000;
const PACKAGE_DRY_RUN_SCAN_MAX_SEED_CHARS = 128;

export async function cmdSetPackageTrustedPublisher(
  opts: GlobalOpts,
  packageName: string,
  options: PackageTrustedPublisherSetOptions,
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const repository = options.repository?.trim();
  const workflowFilename = options.workflowFilename?.trim();
  const environment = options.environment?.trim() || undefined;
  if (!repository) fail("--repository required");
  if (!workflowFilename) fail("--workflow-filename required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Saving trusted publisher");
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/trusted-publisher`,
        token,
        body: {
          repository,
          workflowFilename,
          ...(environment ? { environment } : {}),
        },
      },
      ApiV1PackageTrustedPublisherResponseSchema,
    );
    spinner.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    console.log(`Trusted publisher saved for ${trimmed}.`);
    if (result.trustedPublisher) {
      printTrustedPublisher(result.trustedPublisher);
    }
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdDeletePackageTrustedPublisher(
  opts: GlobalOpts,
  packageName: string,
  options: PackageTrustedPublisherDeleteOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Deleting trusted publisher");
  try {
    const result = await apiRequest<{ ok: boolean }>(registry, {
      method: "DELETE",
      path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/trusted-publisher`,
      token,
    });
    spinner.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    console.log(`Trusted publisher deleted for ${trimmed}.`);
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdModeratePackageRelease(
  opts: GlobalOpts,
  packageName: string,
  options: PackageModerateOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const version = options.version?.trim();
  const state = options.state?.trim() as PackageReleaseModerationState | undefined;
  const reason = options.reason?.trim();
  if (!version) fail("--version required");
  if (!state || !["approved", "quarantined", "revoked"].includes(state)) {
    fail("--state must be approved, quarantined, or revoked");
  }
  if (!reason) fail("--reason required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner(`Moderating ${trimmed}@${version}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/versions/${encodeURIComponent(version)}/moderation`,
        token,
        body: { state, reason },
      },
      ApiV1PackageReleaseModerationResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    console.log(`OK. ${trimmed}@${version} moderation state set to ${result.state}.`);
    console.log(`Scan status: ${result.scanStatus}`);
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdListPackageAppeals(
  opts: GlobalOpts,
  options: PackageAppealListOptions = {},
) {
  const status = options.status?.trim() || "open";
  if (!["open", "accepted", "rejected", "all"].includes(status)) {
    fail("--status must be open, accepted, rejected, or all");
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.packages}/appeals`, registry);
  url.searchParams.set("status", status);
  if (options.cursor?.trim()) url.searchParams.set("cursor", options.cursor.trim());
  url.searchParams.set("limit", String(clampLimit(options.limit ?? 25, 100)));

  const result = await apiRequest(
    registry,
    {
      method: "GET",
      url: url.toString(),
      token,
    },
    ApiV1PackageAppealListResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.items.length === 0) {
    console.log("No package appeals found.");
  } else {
    for (const item of result.items) {
      const submitter = item.submitter.handle ?? item.submitter.userId;
      console.log(`${item.appealId} ${item.status} ${item.name}@${item.version}`);
      console.log(`  submitter: ${submitter}`);
      console.log(`  message: ${item.message}`);
      if (item.resolutionNote) console.log(`  resolution: ${item.resolutionNote}`);
    }
  }
  if (!result.done && result.nextCursor) {
    console.log(`Next cursor: ${result.nextCursor}`);
  }
}

export async function cmdResolvePackageAppeal(
  opts: GlobalOpts,
  appealId: string,
  options: PackageAppealResolveOptions = {},
) {
  const trimmed = appealId.trim();
  if (!trimmed) fail("Appeal id required");
  const status = options.status?.trim() as PackageAppealStatus | undefined;
  if (!status || !["open", "accepted", "rejected"].includes(status)) {
    fail("--status must be open, accepted, or rejected");
  }
  const note = options.note?.trim();
  if (status !== "open" && !note) fail("--note required unless reopening");
  const finalAction = (options.finalAction ?? options.action)?.trim() as
    | PackageAppealFinalAction
    | undefined;
  if (finalAction && !["none", "approve"].includes(finalAction)) {
    fail("--action must be none or approve");
  }

  await presentModerationPlan(
    appealModerationPlan({
      entityLabel: "package",
      appealId: trimmed,
      status,
      finalAction: finalAction ?? "none",
    }),
    options,
  );

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner(`Updating appeal ${trimmed}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/appeals/${encodeURIComponent(trimmed)}/resolve`,
        token,
        body: {
          status,
          ...(note ? { note } : {}),
          ...(finalAction ? { finalAction } : {}),
        },
      },
      ApiV1PackageAppealResolveResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const actionSuffix =
      result.actionTaken && result.actionTaken !== "none" ? `; action ${result.actionTaken}` : "";
    console.log(`OK. Appeal ${trimmed} set to ${result.status}${actionSuffix}.`);
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdListPackageReports(
  opts: GlobalOpts,
  options: PackageReportListOptions = {},
) {
  const status = options.status?.trim() || "open";
  if (!["open", "confirmed", "dismissed", "all"].includes(status)) {
    fail("--status must be open, confirmed, dismissed, or all");
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.packages}/reports`, registry);
  url.searchParams.set("status", status);
  if (options.cursor?.trim()) url.searchParams.set("cursor", options.cursor.trim());
  url.searchParams.set("limit", String(clampLimit(options.limit ?? 25, 100)));

  const result = await apiRequest(
    registry,
    {
      method: "GET",
      url: url.toString(),
      token,
    },
    ApiV1PackageReportListResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.items.length === 0) {
    console.log("No package reports found.");
  } else {
    for (const item of result.items) {
      const version = item.version ? `@${item.version}` : "";
      const reporter = item.reporter.handle ?? item.reporter.userId;
      console.log(`${item.reportId} ${item.status} ${item.name}${version}`);
      console.log(`  reporter: ${reporter}`);
      if (item.reason) console.log(`  reason: ${item.reason}`);
      if (item.triageNote) console.log(`  note: ${item.triageNote}`);
    }
  }
  if (!result.done && result.nextCursor) {
    console.log(`Next cursor: ${result.nextCursor}`);
  }
}

export async function cmdTriagePackageReport(
  opts: GlobalOpts,
  reportId: string,
  options: PackageReportTriageOptions = {},
) {
  const trimmed = reportId.trim();
  if (!trimmed) fail("Report id required");
  const status = options.status?.trim() as PackageReportStatus | undefined;
  if (!status || !["open", "confirmed", "dismissed"].includes(status)) {
    fail("--status must be open, confirmed, or dismissed");
  }
  const note = options.note?.trim();
  if (status !== "open" && !note) fail("--note required unless reopening");
  const finalAction = (options.finalAction ?? options.action)?.trim() as
    | PackageReportFinalAction
    | undefined;
  if (finalAction && !["none", "quarantine", "revoke"].includes(finalAction)) {
    fail("--action must be none, quarantine, or revoke");
  }

  await presentModerationPlan(
    reportModerationPlan({
      entityLabel: "package",
      reportId: trimmed,
      status,
      finalAction: finalAction ?? "none",
    }),
    options,
  );

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner(`Updating report ${trimmed}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/reports/${encodeURIComponent(trimmed)}/triage`,
        token,
        body: {
          status,
          ...(note ? { note } : {}),
          ...(finalAction ? { finalAction } : {}),
        },
      },
      ApiV1PackageReportTriageResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const actionSuffix =
      result.actionTaken && result.actionTaken !== "none" ? `; action ${result.actionTaken}` : "";
    console.log(`OK. Report ${trimmed} set to ${result.status}${actionSuffix}.`);
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdPackageModerationQueue(
  opts: GlobalOpts,
  options: PackageModerationQueueOptions = {},
) {
  const status = options.status?.trim() || "open";
  if (!["open", "blocked", "manual", "all"].includes(status)) {
    fail("--status must be open, blocked, manual, or all");
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.packages}/moderation/queue`, registry);
  url.searchParams.set("status", status);
  if (options.cursor?.trim()) url.searchParams.set("cursor", options.cursor.trim());
  url.searchParams.set("limit", String(clampLimit(options.limit ?? 25, 100)));

  const result = await apiRequest(
    registry,
    {
      method: "GET",
      url: url.toString(),
      token,
    },
    ApiV1PackageModerationQueueResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.items.length === 0) {
    console.log("No package releases in the moderation queue.");
  } else {
    for (const item of result.items) {
      const state = item.moderationState ? ` ${item.moderationState}` : "";
      const reasons = item.reasons.length > 0 ? ` [${item.reasons.join(", ")}]` : "";
      console.log(`${item.name}@${item.version} ${item.scanStatus}${state}${reasons}`);
      console.log(
        `  ${item.family} ${item.channel} ${item.artifactKind ?? "unknown-artifact"}${item.isOfficial ? " official" : ""}`,
      );
      if (item.reportCount > 0) {
        console.log(`  reports: ${item.reportCount}`);
      }
      if (item.sourceRepo || item.sourceCommit) {
        console.log(`  source: ${item.sourceRepo ?? "unknown"}@${item.sourceCommit ?? "unknown"}`);
      }
      if (item.moderationReason) {
        console.log(`  reason: ${item.moderationReason}`);
      }
    }
  }
  if (!result.done && result.nextCursor) {
    console.log(`Next cursor: ${result.nextCursor}`);
  }
}

export async function cmdBackfillPackageArtifacts(
  opts: GlobalOpts,
  options: PackageBackfillArtifactsOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const batchSize = clampLimit(options.batchSize ?? 100, 500);
  const dryRun = options.apply !== true;
  let cursor = options.cursor?.trim() || null;
  const batches: Array<{
    scanned: number;
    updated: number;
    nextCursor: string | null;
    done: boolean;
    dryRun: boolean;
  }> = [];

  do {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/backfill/artifacts`,
        token,
        body: {
          cursor,
          batchSize,
          dryRun,
        },
      },
      ApiV1PackageArtifactBackfillResponseSchema,
    );
    batches.push(result);
    cursor = result.nextCursor;
    if (!options.all || result.done) break;
  } while (cursor);

  const summary = {
    ok: true as const,
    dryRun,
    batches: batches.length,
    scanned: batches.reduce((sum, batch) => sum + batch.scanned, 0),
    updated: batches.reduce((sum, batch) => sum + batch.updated, 0),
    nextCursor: batches.at(-1)?.nextCursor ?? null,
    done: batches.at(-1)?.done ?? true,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  console.log(
    `${dryRun ? "Dry run" : "Applied"} package artifact backfill: scanned ${summary.scanned}, ${dryRun ? "would update" : "updated"} ${summary.updated}.`,
  );
  if (!summary.done && summary.nextCursor) {
    console.log(`Next cursor: ${summary.nextCursor}`);
  }
}

export async function cmdStartPackageDryRunScan(
  opts: GlobalOpts,
  options: PackageDryRunScanStartOptions = {},
) {
  const releaseIdValues = options.releaseId ?? [];
  const packageValues = options.package ?? [];
  const releaseIds = releaseIdValues.map((id) => id.trim());
  const packageNames = packageValues.map((name) => name.trim());
  const seed = options.seed?.trim();
  if (releaseIds.some((id) => id.length === 0)) {
    fail("--release-id cannot be blank");
  }
  if (packageNames.some((name) => name.length === 0)) {
    fail("--package cannot be blank");
  }
  if (options.seed !== undefined && seed?.length === 0) {
    fail("--seed cannot be blank");
  }
  const modeCount = [
    releaseIds.length > 0,
    packageNames.length > 0,
    options.latestActive === true,
    options.allActive === true,
    Boolean(seed),
  ].filter(Boolean).length;
  if (modeCount !== 1) {
    fail("Use exactly one of --release-id, --package, --latest-active, --all-active, or --seed");
  }
  rejectUnusedDryRunScanSizingOptions(options, seed);

  let selector: PackageDryRunScanSelector;
  if (releaseIds.length > 0) {
    if (releaseIds.length > PACKAGE_DRY_RUN_SCAN_MAX_EXPLICIT_SELECTORS) {
      fail(`--release-id is limited to ${PACKAGE_DRY_RUN_SCAN_MAX_EXPLICIT_SELECTORS} releases`);
    }
    selector = { kind: "releaseIds", releaseIds };
  } else if (packageNames.length > 0) {
    if (packageNames.length > PACKAGE_DRY_RUN_SCAN_MAX_EXPLICIT_SELECTORS) {
      fail(`--package is limited to ${PACKAGE_DRY_RUN_SCAN_MAX_EXPLICIT_SELECTORS} packages`);
    }
    selector = { kind: "packageNames", packageNames };
  } else if (seed) {
    if (seed.length > PACKAGE_DRY_RUN_SCAN_MAX_SEED_CHARS) {
      fail(`--seed is limited to ${PACKAGE_DRY_RUN_SCAN_MAX_SEED_CHARS} characters`);
    }
    const limit = requirePositiveBoundedInteger(
      options.limit,
      100,
      PACKAGE_DRY_RUN_SCAN_MAX_LIMIT,
      "--limit",
    );
    const maxCandidates = requirePositiveBoundedInteger(
      options.maxCandidates,
      1_000,
      PACKAGE_DRY_RUN_SCAN_MAX_CANDIDATES,
      "--max-candidates",
    );
    if (maxCandidates < limit) {
      fail("--max-candidates must be greater than or equal to --limit");
    }
    selector = {
      kind: "seededSample",
      seed,
      limit,
      maxCandidates,
    };
  } else if (options.allActive) {
    selector = { kind: "allActive" };
  } else {
    selector = {
      kind: "latestActive",
      limit: requirePositiveBoundedInteger(
        options.limit,
        100,
        PACKAGE_DRY_RUN_SCAN_MAX_LIMIT,
        "--limit",
      ),
    };
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner("Starting dry-run scan");
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/-/dry-run-scans`,
        token,
        body: { selector },
      },
      ApiV1PackageDryRunScanStartResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${stringifyTerminalSafeJson(result, 2)}\n`);
      return;
    }
    if (!result.targetSelectionDone) {
      console.log(
        `Started dry-run scan ${escapeTerminalControlCharacters(result.jobId)}: ${result.status}, target selection pending.`,
      );
      return;
    }
    console.log(
      `Started dry-run scan ${escapeTerminalControlCharacters(result.jobId)}: ${result.status}, ${result.totalItems} items.`,
    );
    if (result.candidateLimitReached) {
      console.log("Warning: maxCandidates was reached before the full candidate set.");
    }
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdPackageDryRunScanStatus(
  opts: GlobalOpts,
  jobId: string,
  options: PackageDryRunScanStatusOptions = {},
) {
  const trimmed = normalizeJobIdOrFail(jobId);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await fetchPackageDryRunScanJob(registry, token, trimmed);

  if (options.json) {
    process.stdout.write(`${stringifyTerminalSafeJson(result, 2)}\n`);
    return;
  }

  printPackageDryRunScanJob(result);
}

export async function cmdWatchPackageDryRunScan(
  opts: GlobalOpts,
  jobId: string,
  options: PackageDryRunScanWatchOptions = {},
) {
  const trimmed = normalizeJobIdOrFail(jobId);
  const intervalMs = normalizePositiveInteger(
    options.intervalMs,
    DEFAULT_DRY_RUN_SCAN_WATCH_INTERVAL_MS,
    "--interval-ms",
  );
  const maxAttempts = normalizePositiveInteger(
    options.maxAttempts,
    DEFAULT_DRY_RUN_SCAN_WATCH_MAX_ATTEMPTS,
    "--max-attempts",
  );
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createSpinner(`Watching dry-run scan ${escapeTerminalControlCharacters(trimmed)}`);

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await fetchPackageDryRunScanJob(registry, token, trimmed);
      if (spinner) spinner.text = formatPackageDryRunScanJobSummary(result);

      if (isPackageDryRunScanTerminal(result)) {
        spinner?.stop();
        if (options.json) {
          process.stdout.write(`${stringifyTerminalSafeJson(result, 2)}\n`);
          return;
        }
        printPackageDryRunScanJob(result);
        return;
      }

      if (attempt < maxAttempts) await sleep(intervalMs);
    }
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }

  const message = `Dry-run scan watch timed out after ${maxAttempts} status checks`;
  spinner?.fail(message);
  fail(message);
}

export async function cmdExportPackageDryRunScanResults(
  opts: GlobalOpts,
  jobId: string,
  options: PackageDryRunScanExportOptions = {},
) {
  if (options.json && options.jsonl) fail("Use only one of --json or --jsonl");

  const trimmed = normalizeJobIdOrFail(jobId);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const job = await fetchPackageDryRunScanJob(registry, token, trimmed);
  const exportWouldBePartial = !isPackageDryRunScanTerminal(job) || !job.targetSelectionDone;
  if (exportWouldBePartial && !options.allowPartial) {
    fail(
      `Dry-run scan ${escapeTerminalControlCharacters(trimmed)} is ${job.status}; use --allow-partial to export incomplete results`,
    );
  }
  if (exportWouldBePartial && options.allowPartial && !options.json) {
    fail("Partial dry-run scan exports require --json so job completion metadata is preserved");
  }
  const limit = requirePositiveBoundedInteger(options.limit, 100, 500, "--limit");
  let cursor = options.cursor?.trim() || null;
  let wroteAny = false;
  let done = false;
  let jobStatus = job.status;
  let jobDone = isPackageDryRunScanTerminal(job);
  let partial = !jobDone;
  const jsonItems: PackageDryRunScanResultItem[] = [];

  do {
    const url = registryUrl(
      `${ApiRoutes.packages}/-/dry-run-scans/${encodeURIComponent(trimmed)}/results`,
      registry,
    );
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);

    const result = await apiRequest(
      registry,
      {
        method: "GET",
        url: url.toString(),
        token,
      },
      ApiV1PackageDryRunScanResultsResponseSchema,
    );

    if (options.jsonl) {
      for (const item of result.items) {
        wroteAny = true;
        process.stdout.write(`${stringifyTerminalSafeJson(item)}\n`);
      }
    } else if (options.json) {
      for (const item of result.items) {
        wroteAny = true;
        jsonItems.push(item);
      }
    } else {
      for (const item of result.items) {
        wroteAny = true;
        printPackageDryRunScanResultItem(item);
      }
    }

    cursor = result.nextCursor;
    done = result.done;
    jobStatus = result.jobStatus;
    jobDone = result.jobDone;
    partial = result.partial;
    if (options.json || done) break;
  } while (cursor);

  if (options.jsonl) return;

  if (options.json) {
    process.stdout.write(
      `${stringifyTerminalSafeJson({ jobStatus, jobDone, partial, items: jsonItems, nextCursor: cursor, done })}\n`,
    );
    return;
  }

  if (!wroteAny) {
    console.log("No dry-run scan results found.");
  }
}

function printPackageDryRunScanResultItem(item: PackageDryRunScanResultItem) {
  const counts = `raw-fs:${item.rawFsUsageCount} fs-safe:${item.fsSafeUsageCount}`;
  const findings = item.findings.length > 0 ? ` findings:${item.findings.length}` : "";
  console.log(
    `${escapeTerminalControlCharacters(item.packageName)}@${escapeTerminalControlCharacters(item.version)} ${item.status} ${counts}${findings}`,
  );
  for (const finding of item.findings) {
    const truncated = finding.evidenceTruncated ? " (truncated)" : "";
    console.log(
      `  ${escapeTerminalControlCharacters(finding.severity)} ${escapeTerminalControlCharacters(finding.code)} ${escapeTerminalControlCharacters(finding.file)}:${finding.line}: ${escapeTerminalControlCharacters(finding.message)}`,
    );
    console.log(`    evidence: ${escapeTerminalControlCharacters(finding.evidence)}${truncated}`);
  }
  for (const error of item.errors)
    console.log(`  error: ${escapeTerminalControlCharacters(error)}`);
}

function isBidiControlCode(code: number) {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function stringifyTerminalSafeJson(value: unknown, space?: number) {
  return escapeJsonTerminalControls(JSON.stringify(value, null, space));
}

function escapeJsonTerminalControls(value: string) {
  let escaped = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code >= 127 && code <= 159) || isBidiControlCode(code)) {
      escaped += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
}

async function fetchPackageDryRunScanJob(
  registry: string,
  token: string,
  jobId: string,
): Promise<ApiV1PackageDryRunScanJobResponse> {
  return apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/-/dry-run-scans/${encodeURIComponent(jobId)}`,
      token,
    },
    ApiV1PackageDryRunScanJobResponseSchema,
  );
}

function isPackageDryRunScanTerminal(result: ApiV1PackageDryRunScanJobResponse) {
  return result.status === "completed" || result.status === "failed";
}

function printPackageDryRunScanJob(result: ApiV1PackageDryRunScanJobResponse) {
  console.log(`Dry-run scan ${escapeTerminalControlCharacters(result.jobId)}: ${result.status}`);
  console.log(
    `  total:${result.totalItems} queued:${result.queuedItems} running:${result.runningItems} completed:${result.completedItems} failed:${result.failedItems} skipped:${result.skippedItems} matched:${result.matchedItems}`,
  );
  if (result.error) console.log(`  error: ${escapeTerminalControlCharacters(result.error)}`);
  if (result.candidateLimitReached) {
    console.log("  warning: maxCandidates was reached before the full candidate set.");
  }
  if (!result.targetSelectionDone) {
    console.log("  target selection pending.");
  }
}

function formatPackageDryRunScanJobSummary(result: ApiV1PackageDryRunScanJobResponse) {
  const targetSelection = result.targetSelectionDone ? "" : ", target selection pending";
  return `Dry-run scan ${escapeTerminalControlCharacters(result.jobId)}: ${result.status} (${result.completedItems}/${result.totalItems} completed, ${result.failedItems} failed, ${result.skippedItems} skipped${targetSelection})`;
}

function normalizePositiveInteger(value: number | undefined, fallback: number, flag: string) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate <= 0) fail(`${flag} must be a positive integer`);
  return candidate;
}

function rejectUnusedDryRunScanSizingOptions(
  options: PackageDryRunScanStartOptions,
  seed?: string,
) {
  const hasLimit = options.limit !== undefined;
  const hasMaxCandidates = options.maxCandidates !== undefined;
  if (seed) return;
  if (hasMaxCandidates) fail("--max-candidates can only be used with --seed");
  if (options.latestActive === true) return;
  if (hasLimit) fail("--limit can only be used with --latest-active or --seed");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function cmdListPackageMigrations(
  opts: GlobalOpts,
  options: PackageMigrationListOptions = {},
) {
  const phase = options.phase?.trim() || "all";
  if (
    ![
      "planned",
      "published",
      "clawpack-ready",
      "legacy-zip-only",
      "metadata-ready",
      "blocked",
      "ready-for-openclaw",
      "all",
    ].includes(phase)
  ) {
    fail(
      "--phase must be planned, published, clawpack-ready, legacy-zip-only, metadata-ready, blocked, ready-for-openclaw, or all",
    );
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.packages}/migrations`, registry);
  url.searchParams.set("phase", phase);
  if (options.cursor?.trim()) url.searchParams.set("cursor", options.cursor.trim());
  url.searchParams.set("limit", String(clampLimit(options.limit ?? 25, 100)));

  const result = await apiRequest(
    registry,
    {
      method: "GET",
      url: url.toString(),
      token,
    },
    ApiV1PackageOfficialMigrationListResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.items.length === 0) {
    console.log("No package migrations found.");
  } else {
    for (const item of result.items) {
      const blockers = item.blockers.length > 0 ? ` blockers:${item.blockers.length}` : "";
      console.log(`${item.bundledPluginId} ${item.phase} ${item.packageName}${blockers}`);
      if (item.sourceRepo || item.sourcePath || item.sourceCommit) {
        const source = [item.sourceRepo, item.sourcePath, item.sourceCommit]
          .filter(Boolean)
          .join(" ");
        console.log(`  source: ${source}`);
      }
      if (item.notes) console.log(`  notes: ${item.notes}`);
    }
  }
  if (!result.done && result.nextCursor) {
    console.log(`Next cursor: ${result.nextCursor}`);
  }
}

export async function cmdUpsertPackageMigration(
  opts: GlobalOpts,
  bundledPluginId: string,
  options: PackageMigrationUpsertOptions = {},
) {
  const trimmed = bundledPluginId.trim();
  const packageName = options.package?.trim();
  if (!trimmed) fail("Bundled plugin id required");
  if (!packageName) fail("--package required");
  const blockers = parseCsv(options.blockers);

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner(`Updating migration ${trimmed}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/migrations`,
        token,
        body: {
          bundledPluginId: trimmed,
          packageName,
          ...(options.owner?.trim() ? { owner: options.owner.trim() } : {}),
          ...(options.sourceRepo?.trim() ? { sourceRepo: options.sourceRepo.trim() } : {}),
          ...(options.sourcePath?.trim() ? { sourcePath: options.sourcePath.trim() } : {}),
          ...(options.sourceCommit?.trim() ? { sourceCommit: options.sourceCommit.trim() } : {}),
          ...(options.phase ? { phase: options.phase } : {}),
          ...(blockers.length > 0 ? { blockers } : {}),
          ...(typeof options.hostTargetsComplete === "boolean"
            ? { hostTargetsComplete: options.hostTargetsComplete }
            : {}),
          ...(typeof options.scanClean === "boolean" ? { scanClean: options.scanClean } : {}),
          ...(typeof options.moderationApproved === "boolean"
            ? { moderationApproved: options.moderationApproved }
            : {}),
          ...(typeof options.runtimeBundlesReady === "boolean"
            ? { runtimeBundlesReady: options.runtimeBundlesReady }
            : {}),
          ...(options.notes?.trim() ? { notes: options.notes.trim() } : {}),
        },
      },
      ApiV1PackageOfficialMigrationResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    console.log(
      `OK. Migration ${result.migration.bundledPluginId} is ${result.migration.phase} for ${result.migration.packageName}.`,
    );
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

function normalizePackageNameOrFail(packageName: string) {
  const trimmed = packageName.trim();
  if (!trimmed) fail("Package name required");
  return trimmed;
}

function normalizeJobIdOrFail(jobId: string) {
  const trimmed = jobId.trim();
  if (!trimmed) fail("Job id required");
  return trimmed;
}

function clampLimit(limit: number | undefined, max: number) {
  if (!Number.isFinite(limit)) return max;
  return Math.max(1, Math.min(Math.trunc(limit ?? max), max));
}

function requirePositiveBoundedInteger(
  value: number | undefined,
  fallback: number,
  max: number,
  flag: string,
) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 1) {
    fail(`${flag} must be a positive integer`);
  }
  if (candidate > max) {
    fail(`${flag} must be at most ${max}`);
  }
  return candidate;
}

function parseCsv(value: string | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printTrustedPublisher(config: PackageTrustedPublisher) {
  console.log(`Provider: ${config.provider}`);
  console.log(`Repository: ${config.repository}`);
  console.log(`Workflow: ${config.workflowFilename}`);
  if (config.environment) console.log(`Environment: ${config.environment}`);
}
