import { isCancel, select } from "@clack/prompts";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import {
  createCrabLoader,
  fail,
  formatError,
  isInteractive,
  promptConfirm,
} from "../../../clawhub/src/cli/ui.js";
import { apiRequest, registryUrl } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1BanUserResponseSchema,
  ApiV1PublisherRecoveryResponseSchema,
  ApiV1ReclassifyBanResponseSchema,
  ApiV1SetRoleResponseSchema,
  ApiV1SkillScanBatchResponseSchema,
  ApiV1SkillScanBatchStatusResponseSchema,
  ApiV1SkillScanSubmitResponseSchema,
  ApiV1SkillRepairVtPendingResponseSchema,
  ApiV1SkillVersionRevokeResponseSchema,
  ApiV1UnbanUserResponseSchema,
  ApiV1UserSearchResponseSchema,
  parseArk,
} from "../../../clawhub/src/schema/index.js";

export async function cmdRevokeSkillVersion(
  opts: GlobalOpts,
  slugArg: string,
  options: {
    version?: string;
    reason?: string;
    owner?: string;
    yes?: boolean;
    json?: boolean;
  },
  inputAllowed: boolean,
) {
  const slug = slugArg.trim().toLowerCase();
  if (!slug) fail("Skill slug required");
  const version = options.version?.trim();
  if (!version) fail("--version required");
  const reason = options.reason?.trim();
  if (!reason) fail("--reason required");
  const ownerHandle = options.owner?.trim().replace(/^@+/, "") || undefined;

  const allowPrompt = isInteractive() && inputAllowed !== false;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(`Revoke ${slug}@${version}? This version cannot be restored.`);
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createCrabLoader(`Revoking ${slug}@${version}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/moderation`,
        token,
        body: { state: "revoked", reason, ...(ownerHandle ? { ownerHandle } : {}) },
      },
      ApiV1SkillVersionRevokeResponseSchema,
    );
    const parsed = parseArk(
      ApiV1SkillVersionRevokeResponseSchema,
      result,
      "Skill version revocation response",
    );
    spinner?.succeed(
      parsed.alreadyRevoked
        ? `OK. ${slug}@${version} was already revoked`
        : `OK. Revoked ${slug}@${version}`,
    );
    if (options.json) process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdBanUser(
  opts: GlobalOpts,
  identifierArg: string,
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean; reason?: string },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");

  const reason = options.reason?.trim() || undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Ban ${resolved.label}? (requires moderator/admin; deletes owned skills)`,
    );
    if (!ok) return undefined;
  }

  const spinner = createCrabLoader(`Banning ${resolved.label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/ban`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, reason }
          : { handle: resolved.handle, reason },
      },
      ApiV1BanUserResponseSchema,
    );
    const parsed = parseArk(ApiV1BanUserResponseSchema, result, "Ban user response");
    if (parsed.alreadyBanned) {
      spinner.succeed(`OK. ${resolved.label} already banned`);
      return parsed;
    }
    spinner.succeed(`OK. Banned ${resolved.label} (${formatDeletedSkills(parsed.deletedSkills)})`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdUnbanUser(
  opts: GlobalOpts,
  identifierArg: string,
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean; reason?: string },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");

  const reason = options.reason?.trim() || undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Unban ${resolved.label}? (admin only; restores eligible skills)`,
    );
    if (!ok) return undefined;
  }

  const spinner = createCrabLoader(`Unbanning ${resolved.label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/unban`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, reason }
          : { handle: resolved.handle, reason },
      },
      ApiV1UnbanUserResponseSchema,
    );
    const parsed = parseArk(ApiV1UnbanUserResponseSchema, result, "Unban user response");
    if (parsed.alreadyUnbanned) {
      spinner.succeed(`OK. ${resolved.label} already unbanned`);
      return parsed;
    }
    spinner.succeed(
      `OK. Unbanned ${resolved.label} (${formatRestoredSkills(parsed.restoredSkills)})`,
    );
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdSetRole(
  opts: GlobalOpts,
  identifierArg: string,
  roleArg: string,
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");
  const role = normalizeRole(roleArg);

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(`Set role for ${resolved.label} to ${role}? (admin only)`);
    if (!ok) return undefined;
  }

  const spinner = createCrabLoader(`Setting role for ${resolved.label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/role`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, role }
          : { handle: resolved.handle, role },
      },
      ApiV1SetRoleResponseSchema,
    );
    const parsed = parseArk(ApiV1SetRoleResponseSchema, result, "Set role response");
    spinner.succeed(`OK. ${resolved.label} is now ${parsed.role}`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdRecoverPersonalPublisher(
  opts: GlobalOpts,
  handleArg: string,
  options: {
    to?: string;
    previousGithubId?: string;
    nextGithubId?: string;
    retiredHandle?: string;
    reason?: string;
    apply?: boolean;
    verified?: boolean;
    yes?: boolean;
    json?: boolean;
  },
  inputAllowed: boolean,
) {
  const handle = normalizeRequiredHandle(handleArg, "Publisher handle");
  const nextUserHandle = normalizeRequiredHandle(options.to ?? "", "--to");
  const previousGitHubProviderAccountId = normalizeGitHubProviderId(
    options.previousGithubId,
    "--previous-github-id",
  );
  const nextGitHubProviderAccountId = normalizeGitHubProviderId(
    options.nextGithubId,
    "--next-github-id",
  );
  const retiredUserHandle = options.retiredHandle
    ? normalizeRequiredHandle(options.retiredHandle, "--retired-handle")
    : undefined;
  const reason = options.reason?.trim();
  if (!reason) fail("--reason required");
  if (reason.length > 500) fail("--reason must be 500 characters or fewer");

  const dryRun = options.apply !== true;
  const confirmIdentityVerified = options.verified === true;
  if (!dryRun && !confirmIdentityVerified) fail("--verified required with --apply");
  if (!dryRun && !options.yes) {
    if (!isInteractive() || inputAllowed === false) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Recover @${handle} for @${nextUserHandle}? This changes personal publisher control.`,
    );
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning" : "Applying"} publisher recovery for @${handle}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/publisher-recovery`,
        token,
        body: {
          handle,
          nextUserHandle,
          previousGitHubProviderAccountId,
          nextGitHubProviderAccountId,
          ...(retiredUserHandle ? { retiredUserHandle } : {}),
          reason,
          confirmIdentityVerified,
          dryRun,
        },
      },
      ApiV1PublisherRecoveryResponseSchema,
    );
    const parsed = parseArk(
      ApiV1PublisherRecoveryResponseSchema,
      result,
      "Publisher recovery response",
    );
    spinner?.succeed(
      parsed.recovered
        ? `Recovered @${parsed.handle} for @${parsed.nextUser.nextHandle}`
        : `Dry run OK for @${parsed.handle}; @${parsed.previousUser.handle ?? parsed.previousUser.userId} would retire to @${parsed.previousUser.nextHandle}`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    } else {
      const migration = parsed.resourceOwnerMigration;
      console.log(
        `Owner rows: ${migration.skills} skills, ${migration.skillSlugAliases} skill aliases, ${migration.packages} packages, ${migration.packageInspectorWarnings} package warnings, ${migration.handleReservations} handle reservations (${migration.githubSourcesChecked} GitHub sources checked; limit ${migration.limitPerTable}/table).`,
      );
      if (dryRun) console.log("Re-run with --apply --verified --yes to write this recovery.");
    }
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdRescanSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { version?: string; yes?: boolean; json?: boolean },
  inputAllowed: boolean,
) {
  const slug = normalizeSkillSlug(slugArg);
  const version = options.version?.trim();
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const target = version ? `${slug}@${version}` : `${slug} latest`;
    const ok = await promptConfirm(`Queue ClawScan rescan for ${target}? (moderator/admin)`);
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createCrabLoader(`Queueing ClawScan rescan for ${slug}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: ApiRoutes.skillScans,
        token,
        body: {
          source: {
            kind: "published",
            slug,
            ...(version ? { version } : {}),
          },
          update: true,
        },
      },
      ApiV1SkillScanSubmitResponseSchema,
    );
    const parsed = parseArk(ApiV1SkillScanSubmitResponseSchema, result, "Skill rescan response");
    spinner?.succeed(
      `OK. Queued ClawScan for ${slug}${version ? `@${version}` : ""} (${parsed.alreadyQueued ? "existing job" : "new job"}).`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    }
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdRescanAllSkills(
  opts: GlobalOpts,
  options: {
    batchSize?: number;
    pollInterval?: number;
    cursor?: string;
    maxSkills?: number;
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
    failFast?: boolean;
  },
  inputAllowed: boolean,
) {
  const batchSize = normalizePositiveInt(options.batchSize, 50);
  const pollIntervalMs = normalizeNonNegativeInt(options.pollInterval, 30) * 1000;
  const maxSkills =
    options.maxSkills === undefined ? undefined : normalizePositiveInt(options.maxSkills, 1);
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!options.dryRun && !options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Queue bulk ClawScan rescans for active latest skills in batches of ${batchSize}? (admin)`,
    );
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  let cursor = options.cursor?.trim() || null;
  let processed = 0;
  let batches = 0;
  let totalQueued = 0;
  let totalAlreadyQueued = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  while (true) {
    const remaining = maxSkills === undefined ? batchSize : Math.max(0, maxSkills - processed);
    if (remaining === 0) break;
    const effectiveBatchSize = Math.min(batchSize, remaining);
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skillScans}/batch`,
        token,
        body: {
          mode: "all-active-latest",
          cursor,
          batchSize: effectiveBatchSize,
          dryRun: options.dryRun === true,
        },
      },
      ApiV1SkillScanBatchResponseSchema,
    );
    const batch = parseArk(
      ApiV1SkillScanBatchResponseSchema,
      result,
      "Bulk skill rescan batch response",
    );
    batches += 1;
    totalQueued += batch.queued;
    totalAlreadyQueued += batch.alreadyQueued;
    totalSkipped += batch.skipped;
    processed += batch.queued + batch.alreadyQueued + batch.skipped;
    emitBulkRescanProgress(options, {
      type: "batch",
      batch: batches,
      cursor,
      nextCursor: batch.nextCursor,
      queued: batch.queued,
      alreadyQueued: batch.alreadyQueued,
      skipped: batch.skipped,
      done: batch.done,
      sampleSlugs: batch.sampleSlugs,
    });

    if (!options.dryRun && batch.jobIds.length > 0) {
      const status = await pollBulkRescanStatus(registry, token, batch.jobIds, {
        pollIntervalMs,
        json: options.json,
        batch: batches,
      });
      totalFailed += status.failed;
      if (status.failed > 0 && options.failFast) {
        fail(`Bulk rescan batch ${batches} finished with ${status.failed} failed job(s)`);
      }
    }

    cursor = batch.nextCursor;
    if (batch.done || !cursor) break;
  }

  const summary = {
    ok: totalFailed === 0,
    batches,
    queued: totalQueued,
    alreadyQueued: totalAlreadyQueued,
    skipped: totalSkipped,
    failed: totalFailed,
    cursor,
    dryRun: options.dryRun === true,
  };
  emitBulkRescanProgress(options, { type: "summary", ...summary });
  if (totalFailed > 0) fail(`Bulk rescan finished with ${totalFailed} failed job(s)`);
  return summary;
}

export async function cmdRepairVtPendingSkills(
  opts: GlobalOpts,
  options: {
    batchSize?: number;
    concurrency?: number;
    cursor?: string;
    dryRun?: boolean;
    all?: boolean;
    yes?: boolean;
    json?: boolean;
  },
  inputAllowed: boolean,
) {
  const batchSize = normalizePositiveInt(options.batchSize, 500);
  const concurrency =
    options.concurrency === undefined ? undefined : normalizePositiveInt(options.concurrency, 16);
  const dryRun = options.dryRun === true;
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!dryRun && !options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Repair pending VirusTotal cache in batches of ${batchSize} with concurrency ${concurrency ?? 16}? (admin)`,
    );
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  let cursor = options.cursor?.trim() || null;
  let batches = 0;
  let total = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let noResults = 0;
  let noDecisiveStats = 0;
  let errors = 0;
  const statusCounts: Record<string, number> = {};
  const sampleUpdated: Array<{ slug: string; status: string }> = [];
  let done = false;

  while (!done) {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/-/repair-vt-pending`,
        token,
        body: {
          cursor,
          batchSize,
          ...(concurrency !== undefined ? { concurrency } : {}),
          dryRun,
        },
      },
      ApiV1SkillRepairVtPendingResponseSchema,
    );
    const batch = parseArk(
      ApiV1SkillRepairVtPendingResponseSchema,
      result,
      "Skill VT pending repair response",
    );
    batches++;
    total += batch.total;
    wouldUpdate += batch.wouldUpdate;
    updated += batch.updated;
    noResults += batch.noResults;
    noDecisiveStats += batch.noDecisiveStats;
    errors += batch.errors;
    for (const [status, count] of Object.entries(batch.statusCounts)) {
      statusCounts[status] = (statusCounts[status] ?? 0) + count;
    }
    for (const sample of batch.sampleUpdated) {
      if (sampleUpdated.length < 20) sampleUpdated.push(sample);
    }
    done = batch.done;
    emitVtRepairProgress(options, {
      type: "batch",
      batch: batches,
      cursor,
      nextCursor: batch.cursor,
      total: batch.total,
      wouldUpdate: batch.wouldUpdate,
      updated: batch.updated,
      noResults: batch.noResults,
      noDecisiveStats: batch.noDecisiveStats,
      errors: batch.errors,
      statusCounts: batch.statusCounts,
      done: batch.done,
      dryRun,
    });
    cursor = batch.cursor;
    if (!options.all || !cursor) break;
  }

  const summary = {
    ok: errors === 0,
    dryRun,
    batches,
    total,
    wouldUpdate,
    updated,
    noResults,
    noDecisiveStats,
    errors,
    statusCounts,
    sampleUpdated,
    nextCursor: cursor,
    done,
  };
  emitVtRepairProgress(options, { type: "summary", ...summary });
  if (errors > 0) fail(`VT pending repair finished with ${errors} error(s)`);
  return summary;
}

async function pollBulkRescanStatus(
  registry: string,
  token: string,
  jobIds: string[],
  options: { pollIntervalMs: number; json?: boolean; batch: number },
) {
  while (true) {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skillScans}/batch/status`,
        token,
        body: { jobIds },
      },
      ApiV1SkillScanBatchStatusResponseSchema,
    );
    const status = parseArk(
      ApiV1SkillScanBatchStatusResponseSchema,
      result,
      "Bulk skill rescan status response",
    );
    emitBulkRescanProgress(
      { json: options.json },
      { type: "status", batch: options.batch, ...status },
    );
    if (status.done) return status;
    if (options.pollIntervalMs > 0) await sleep(options.pollIntervalMs);
  }
}

function emitBulkRescanProgress(options: { json?: boolean }, event: Record<string, unknown>) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }

  if (event.type === "batch") {
    const nextCursor = typeof event.nextCursor === "string" ? event.nextCursor : null;
    const suffix = nextCursor ? ` Next cursor: ${nextCursor}.` : "";
    console.log(
      `Batch ${readEventNumber(event, "batch")}: queued ${readEventNumber(event, "queued")}, already queued ${readEventNumber(event, "alreadyQueued")}, skipped ${readEventNumber(event, "skipped")}.${suffix}`,
    );
    return;
  }

  if (event.type === "status") {
    console.log(
      `Batch ${readEventNumber(event, "batch")} status: ${readEventNumber(event, "succeeded")} succeeded, ${readEventNumber(event, "failed")} failed, ${readEventNumber(event, "running")} running, ${readEventNumber(event, "queued")} queued.`,
    );
    return;
  }

  if (event.type === "summary") {
    const label = event.dryRun ? "Bulk rescan dry run" : "Bulk rescan";
    console.log(
      `${label} finished: ${readEventNumber(event, "batches")} batch(es), ${readEventNumber(event, "queued")} queued, ${readEventNumber(event, "alreadyQueued")} already queued, ${readEventNumber(event, "skipped")} skipped, ${readEventNumber(event, "failed")} failed.`,
    );
    if (typeof event.cursor === "string" && event.cursor) {
      console.log(`Resume cursor: ${event.cursor}`);
    }
  }
}

function emitVtRepairProgress(options: { json?: boolean }, event: Record<string, unknown>) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }

  if (event.type === "batch") {
    const nextCursor = typeof event.nextCursor === "string" ? event.nextCursor : null;
    const suffix = nextCursor ? ` Next cursor: ${nextCursor}.` : "";
    console.log(
      `VT repair batch ${readEventNumber(event, "batch")}: scanned ${readEventNumber(event, "total")}, ${event.dryRun ? "would update" : "updated"} ${readEventNumber(event, event.dryRun ? "wouldUpdate" : "updated")}, no results ${readEventNumber(event, "noResults")}, errors ${readEventNumber(event, "errors")}.${suffix}`,
    );
    return;
  }

  if (event.type === "summary") {
    const label = event.dryRun ? "VT repair dry run" : "VT repair";
    console.log(
      `${label} finished: ${readEventNumber(event, "batches")} batch(es), scanned ${readEventNumber(event, "total")}, ${event.dryRun ? "would update" : "updated"} ${readEventNumber(event, event.dryRun ? "wouldUpdate" : "updated")}, no results ${readEventNumber(event, "noResults")}, errors ${readEventNumber(event, "errors")}.`,
    );
    if (typeof event.nextCursor === "string" && event.nextCursor) {
      console.log(`Resume cursor: ${event.nextCursor}`);
    }
  }
}

function readEventNumber(event: Record<string, unknown>, key: string) {
  const value = event[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePositiveInt(value: number | undefined, fallback: number) {
  const normalized = Number.isFinite(value) ? Math.floor(value ?? fallback) : fallback;
  return Math.max(1, normalized);
}

function normalizeNonNegativeInt(value: number | undefined, fallback: number) {
  const normalized = Number.isFinite(value) ? Math.floor(value ?? fallback) : fallback;
  return Math.max(0, normalized);
}

export async function cmdReclassifyBan(
  opts: GlobalOpts,
  identifierArg: string,
  options: {
    apply?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    id?: boolean;
    fuzzy?: boolean;
    reason?: string;
    json?: boolean;
  },
  inputAllowed: boolean,
) {
  if (options.apply && options.dryRun) fail("Choose either --apply or --dry-run, not both");

  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");

  const reason = options.reason?.trim();
  if (!reason) fail("Reason required");
  if (reason.length > 500) fail("Reason too long (max 500 chars)");

  const dryRun = options.apply !== true;
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;

  if (!dryRun && !options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Reclassify ban for ${resolved.label} as "${reason}"? (admin only; no unban/restore)`,
    );
    if (!ok) return undefined;
  }

  const spinner = options.json
    ? null
    : createCrabLoader(
        `${dryRun ? "Planning" : "Applying"} ban reclassification for ${resolved.label}`,
      );
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/reclassify-ban`,
        token,
        body: {
          ...(resolved.userId ? { userId: resolved.userId } : { handle: resolved.handle }),
          reason,
          dryRun,
        },
      },
      ApiV1ReclassifyBanResponseSchema,
    );
    const parsed = parseArk(ApiV1ReclassifyBanResponseSchema, result, "Reclassify ban response");
    spinner?.succeed(
      `${dryRun ? "Dry run" : "Applied"} ban reclassification for ${resolved.label}: ${parsed.previousReason ?? "none"} -> ${parsed.nextReason}${parsed.changed ? "" : " (already set)"}.`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    } else if (dryRun) {
      console.log("Re-run with --apply --yes to write this change.");
    }
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

function normalizeHandle(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase();
}

function normalizeRequiredHandle(value: string, label: string) {
  const handle = normalizeHandle(value);
  if (!handle) fail(`${label} required`);
  return handle;
}

function normalizeGitHubProviderId(value: string | undefined, label: string) {
  const providerId = value?.trim() ?? "";
  if (!providerId) fail(`${label} required`);
  if (!/^\d+$/.test(providerId)) fail(`${label} must be a numeric GitHub provider account id`);
  return providerId;
}

function normalizeSkillSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!slug) fail("Slug required");
  if (slug.includes("/") || slug.includes("\\") || slug.includes(".."))
    fail(`Invalid slug: ${slug}`);
  return slug;
}

type ResolvedUser = {
  handle: string | null;
  userId: string | null;
  label: string;
};

type UserSearchItem = {
  userId: string;
  handle: string | null;
  displayName?: string | null;
  name?: string | null;
  role?: "admin" | "moderator" | "user" | null;
};

async function resolveUserIdentifier(
  registry: string,
  token: string,
  raw: string,
  options: { id?: boolean; fuzzy?: boolean },
  allowPrompt: boolean,
): Promise<ResolvedUser | null> {
  const usesId = Boolean(options.id);
  if (usesId) {
    return { handle: null, userId: raw, label: raw };
  }

  const handle = normalizeHandle(raw);
  if (!options.fuzzy) {
    return { handle, userId: null, label: `@${handle}` };
  }

  const matches = await searchUsers(registry, token, raw);
  if (matches.items.length === 0) {
    fail(`No users matched "${raw}".`);
  }

  if (matches.items.length === 1) {
    const match = matches.items[0] as UserSearchItem;
    return {
      handle: match.handle ?? null,
      userId: match.userId,
      label: formatUserLabel(match),
    };
  }

  if (!allowPrompt) {
    fail(`Multiple users matched "${raw}". Use --id.\n${formatUserList(matches.items)}`);
  }

  const choice = await select({
    message: `Select a user for "${raw}"`,
    options: matches.items.map((item) => ({
      value: item.userId,
      label: formatUserLabel(item),
    })),
  });
  if (isCancel(choice)) return null;
  const selected = matches.items.find((item) => item.userId === choice);
  if (!selected) return null;
  return {
    handle: selected.handle ?? null,
    userId: selected.userId,
    label: formatUserLabel(selected),
  };
}

async function searchUsers(registry: string, token: string, query: string) {
  const url = registryUrl(ApiRoutes.users, registry);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", "10");
  const result = await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1UserSearchResponseSchema,
  );
  return parseArk(ApiV1UserSearchResponseSchema, result, "User search response");
}

function formatUserLabel(user: UserSearchItem) {
  const handle = user.handle ? `@${user.handle}` : "unknown";
  const name = user.displayName ?? user.name;
  const role = user.role ? ` (${user.role})` : "";
  const label = name ? `${handle} - ${name}` : handle;
  return `${label}${role} - ${user.userId}`;
}

function formatUserList(users: UserSearchItem[]) {
  return users.map((user) => `- ${formatUserLabel(user)}`).join("\n");
}

function normalizeRole(value: string) {
  const role = value.trim().toLowerCase();
  if (role === "user" || role === "moderator" || role === "admin") return role;
  return fail("Role must be user|moderator|admin");
}

function formatDeletedSkills(count: number) {
  if (!Number.isFinite(count)) return "deleted skills unknown";
  if (count === 1) return "deleted 1 skill";
  return `deleted ${count} skills`;
}

function formatRestoredSkills(count: number | undefined) {
  if (!Number.isFinite(count)) return "restored skills unknown";
  if (count === 1) return "restored 1 skill";
  return `restored ${count} skills`;
}
