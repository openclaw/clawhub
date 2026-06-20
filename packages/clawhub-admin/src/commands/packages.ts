import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import {
  presentModerationPlan,
  reportModerationPlan,
} from "../../../clawhub/src/cli/commands/moderationPlan.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { createCrabLoader, fail, formatError } from "../../../clawhub/src/cli/ui.js";
import { apiRequest, registryUrl } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1PackageModerationQueueResponseSchema,
  ApiV1PackageOfficialMigrationListResponseSchema,
  ApiV1PackageOfficialMigrationResponseSchema,
  ApiV1PackageRepairNameResponseSchema,
  ApiV1PackageRepairRuntimeIdResponseSchema,
  ApiV1PackageReleaseModerationResponseSchema,
  ApiV1PackageReportListResponseSchema,
  ApiV1PackageReportTriageResponseSchema,
  ApiV1PackageTrustedPublisherResponseSchema,
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

type PackageRepairNameOptions = {
  nextName?: string;
  retireTarget?: boolean;
  owner?: string;
  reason?: string;
  apply?: boolean;
  json?: boolean;
};

type PackageRepairRuntimeIdOptions = {
  nextRuntimeId?: string;
  reason?: string;
  apply?: boolean;
  json?: boolean;
};

type PackageTransferOwnerOptions = {
  to?: string;
  reason?: string;
  apply?: boolean;
  json?: boolean;
};

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
  const spinner = createCrabLoader("Saving trusted publisher");
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
  const spinner = createCrabLoader("Deleting trusted publisher");
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
  const spinner = options.json ? null : createCrabLoader(`Moderating ${trimmed}@${version}`);
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
  const spinner = options.json ? null : createCrabLoader(`Updating report ${trimmed}`);
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

export async function cmdRepairPackageName(
  opts: GlobalOpts,
  packageName: string,
  options: PackageRepairNameOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const nextName = normalizePackageNameOrFail(options.nextName ?? "");
  const reason = options.reason?.trim();
  const owner = options.owner?.trim().replace(/^@+/, "").toLowerCase();
  const dryRun = options.apply !== true;
  if (!reason) fail("--reason required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning" : "Applying"} package name repair`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/repair-name`,
        token,
        body: {
          nextName,
          ...(options.retireTarget ? { retireTarget: true } : {}),
          ...(owner ? { owner } : {}),
          reason,
          dryRun,
        },
      },
      ApiV1PackageRepairNameResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    console.log(
      `${result.dryRun ? "Dry run" : "Applied"} package repair: ${trimmed} -> ${nextName}`,
    );
    if (result.retiredName) console.log(`Retired target as: ${result.retiredName}`);
    for (const operation of result.operations) {
      if (operation.action === "transfer-owner") {
        console.log(`- transfer owner: @${operation.owner}`);
      } else {
        console.log(`- ${operation.action}: ${operation.from} -> ${operation.to}`);
      }
    }
    if (result.dryRun) console.log("Re-run with --apply to write these changes.");
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdRepairPackageRuntimeId(
  opts: GlobalOpts,
  packageName: string,
  options: PackageRepairRuntimeIdOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const nextRuntimeId = options.nextRuntimeId?.trim();
  const reason = options.reason?.trim();
  const dryRun = options.apply !== true;
  if (!nextRuntimeId) fail("--next-runtime-id required");
  if (!reason) fail("--reason required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning" : "Applying"} package runtime id repair`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/repair-runtime-id`,
        token,
        body: {
          nextRuntimeId,
          reason,
          dryRun,
        },
      },
      ApiV1PackageRepairRuntimeIdResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    console.log(`${result.dryRun ? "Dry run" : "Applied"} package runtime id repair: ${trimmed}`);
    for (const operation of result.operations) {
      console.log(`- ${operation.action}: ${operation.from ?? "<none>"} -> ${operation.to}`);
    }
    if (result.dryRun) console.log("Re-run with --apply to write these changes.");
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
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
  const spinner = options.json ? null : createCrabLoader(`Updating migration ${trimmed}`);
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

export async function cmdTransferPackageOwner(
  opts: GlobalOpts,
  packageName: string,
  options: PackageTransferOwnerOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const owner = options.to?.trim().replace(/^@+/, "").toLowerCase();
  const reason = options.reason?.trim();
  const dryRun = options.apply !== true;
  if (!owner) fail("--to required");
  if (!reason) fail("--reason required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning" : "Applying"} package owner transfer`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/repair-name`,
        token,
        body: {
          nextName: trimmed,
          owner,
          reason,
          dryRun,
        },
      },
      ApiV1PackageRepairNameResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result;
    }
    console.log(
      `${result.dryRun ? "Dry run" : "Applied"} package transfer: ${trimmed} -> @${owner}`,
    );
    for (const operation of result.operations) {
      if (operation.action === "transfer-owner") {
        console.log(`- transfer owner: @${operation.owner}`);
      }
    }
    if (result.dryRun) console.log("Re-run with --apply to write this change.");
    return result;
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

function clampLimit(limit: number | undefined, max: number) {
  if (!Number.isFinite(limit)) return max;
  return Math.max(1, Math.min(Math.trunc(limit ?? max), max));
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
