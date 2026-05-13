import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { apiRequest, downloadZip, registryUrl } from "../../http.js";
import {
  ApiRoutes,
  ApiV1SearchResponseSchema,
  ApiV1SkillListResponseSchema,
  ApiV1SkillReportListResponseSchema,
  ApiV1SkillReportResponseSchema,
  ApiV1SkillReportTriageResponseSchema,
  ApiV1SkillResolveResponseSchema,
  ApiV1SkillResponseSchema,
  ApiV1SkillVersionResponseSchema,
  type SkillReportFinalAction,
  type SkillReportListStatus,
  type SkillReportStatus,
} from "../../schema/index.js";
import {
  extractZipToDir,
  hashSkillFiles,
  listManualSkills,
  listTextFiles,
  readLockfile,
  readSkillOrigin,
  writeLockfile,
  writeSkillOrigin,
} from "../../skills.js";
import { getOptionalAuthToken, requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts, ResolveResult } from "../types.js";
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from "../ui.js";
import { presentModerationPlan, reportModerationPlan } from "./moderationPlan.js";

type SkillReportOptions = {
  version?: string;
  reason?: string;
  json?: boolean;
};

type SkillReportListOptions = {
  status?: SkillReportListStatus;
  cursor?: string;
  limit?: number;
  json?: boolean;
};

type SkillReportTriageOptions = {
  status?: SkillReportStatus;
  action?: SkillReportFinalAction;
  finalAction?: SkillReportFinalAction;
  note?: string;
  json?: boolean;
  yes?: boolean;
};

function normalizeSkillSlugOrFail(raw: string) {
  const slug = raw.trim();
  if (!slug) fail("Slug required");
  // Safety: never allow path traversal or nested paths to become filesystem operations.
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    fail(`Invalid slug: ${slug}`);
  }
  return slug;
}

function isSafeSkillSlug(slug: string) {
  return Boolean(slug) && !slug.includes("/") && !slug.includes("\\") && !slug.includes("..");
}

function isPinnedSkillEntry(entry?: { pinned?: boolean | null }) {
  return entry?.pinned === true;
}

function withPinnedMetadata(
  version: string | null,
  installedAt: number,
  existing?: { pinned?: boolean; pinReason?: string },
) {
  return {
    version,
    installedAt,
    ...(existing?.pinned ? { pinned: true } : {}),
    ...(existing?.pinned && existing.pinReason ? { pinReason: existing.pinReason } : {}),
  };
}

function formatPinnedDetails(entry?: { pinReason?: string }) {
  return entry?.pinReason ? ` (${entry.pinReason})` : "";
}

function formatSearchOwner(entry: {
  ownerHandle?: string | null;
  owner?: { handle?: string | null; displayName?: string | null } | null;
}) {
  const handle = entry.ownerHandle ?? entry.owner?.handle;
  if (handle) return `@${handle}`;
  return entry.owner?.displayName ?? "unknown owner";
}

export async function cmdSearch(opts: GlobalOpts, query: string, limit?: number) {
  if (!query) fail("Query required");

  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Searching");
  try {
    const url = registryUrl(ApiRoutes.search, registry);
    url.searchParams.set("q", query);
    const effectiveLimit = typeof limit === "number" && Number.isFinite(limit) ? limit : 25;
    url.searchParams.set("limit", String(effectiveLimit));
    const result = await apiRequest(
      registry,
      { method: "GET", url: url.toString(), token },
      ApiV1SearchResponseSchema,
    );

    spinner.stop();
    for (const entry of result.results) {
      const slug = entry.slug ?? "unknown";
      const name = entry.displayName ?? slug;
      const version = entry.version ? ` v${entry.version}` : "";
      console.log(
        `${slug}${version}  ${formatSearchOwner(entry)}  ${name}  (${entry.score.toFixed(3)})`,
      );
    }
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdInstall(
  opts: GlobalOpts,
  slug: string,
  versionFlag?: string,
  force = false,
) {
  const trimmed = normalizeSkillSlugOrFail(slug);

  const token = await getOptionalAuthToken();

  const registry = await getRegistry(opts, { cache: true });
  await mkdir(opts.dir, { recursive: true });
  const target = join(opts.dir, trimmed);
  if (!force) {
    const exists = await fileExists(target);
    if (exists) fail(`Already installed: ${target} (use --force)`);
  }

  const lock = await readLockfile(opts.workdir);
  const existingEntry = lock.skills[trimmed];
  if (isPinnedSkillEntry(existingEntry)) {
    fail(`skill "${trimmed}" is pinned; run \`clawhub unpin ${trimmed}\` first`);
  }

  const spinner = createSpinner(`Resolving ${trimmed}`);
  try {
    // Fetch skill metadata including moderation status
    const skillMeta = await apiRequest(
      registry,
      { method: "GET", path: `${ApiRoutes.skills}/${encodeURIComponent(trimmed)}`, token },
      ApiV1SkillResponseSchema,
    );

    // Check moderation status before proceeding
    if (skillMeta.moderation?.isMalwareBlocked) {
      spinner.fail(`Blocked: ${trimmed} is flagged as malicious`);
      fail("This skill has been flagged as malware and cannot be installed.");
    }

    if (skillMeta.moderation?.isSuspicious && !force) {
      spinner.stop();
      console.log(
        `\n⚠️  Warning: "${trimmed}" is flagged as suspicious by VirusTotal Code Insight.\n` +
          "   This skill may contain risky patterns (crypto keys, external APIs, eval, etc.)\n" +
          "   Review the skill code before use.\n",
      );
      if (isInteractive()) {
        const confirm = await promptConfirm("Install anyway?");
        if (!confirm) fail("Installation cancelled");
        spinner.start(`Resolving ${trimmed}`);
      } else {
        fail("Use --force to install suspicious skills in non-interactive mode");
      }
    }

    const resolvedVersion = versionFlag ?? skillMeta.latestVersion?.version ?? null;
    if (!resolvedVersion) fail("Could not resolve latest version");

    if (versionFlag) {
      await apiRequest(
        registry,
        {
          method: "GET",
          path: `${ApiRoutes.skills}/${encodeURIComponent(trimmed)}/versions/${encodeURIComponent(
            resolvedVersion,
          )}`,
          token,
        },
        ApiV1SkillVersionResponseSchema,
      );
    }

    if (force) {
      await rm(target, { recursive: true, force: true });
    }

    spinner.text = `Downloading ${trimmed}@${resolvedVersion}`;
    const zip = await downloadZip(registry, { slug: trimmed, version: resolvedVersion, token });
    await extractZipToDir(zip, target);
    const installedFiles = await listTextFiles(target);
    const installedFingerprint =
      installedFiles.length > 0 ? hashSkillFiles(installedFiles).fingerprint : undefined;

    await writeSkillOrigin(target, {
      version: 1,
      registry,
      slug: trimmed,
      installedVersion: resolvedVersion,
      installedAt: Date.now(),
      fingerprint: installedFingerprint,
    });

    lock.skills[trimmed] = withPinnedMetadata(resolvedVersion, Date.now(), existingEntry);
    await writeLockfile(opts.workdir, lock);
    spinner.succeed(`OK. Installed ${trimmed} -> ${target}`);
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdUpdate(
  opts: GlobalOpts,
  slugArg: string | undefined,
  options: { all?: boolean; version?: string; force?: boolean },
  inputAllowed: boolean,
) {
  const slug = slugArg ? normalizeSkillSlugOrFail(slugArg) : undefined;
  const all = Boolean(options.all);
  if (!slug && !all) fail("Provide <slug> or --all");
  if (slug && all) fail("Use either <slug> or --all");
  if (options.version && !slug) fail("--version requires a single <slug>");
  if (options.version && !semver.valid(options.version)) fail("--version must be valid semver");
  const lock = await readLockfile(opts.workdir);
  if (slug && isPinnedSkillEntry(lock.skills[slug])) {
    fail(`skill "${slug}" is pinned; run \`clawhub unpin ${slug}\` first`);
  }
  const allowPrompt = isInteractive() && inputAllowed;

  const token = await getOptionalAuthToken();

  const registry = await getRegistry(opts, { cache: true });
  const requestedSlugs = slug ? [slug] : Object.keys(lock.skills).filter(isSafeSkillSlug);
  const skippedPinned = slug
    ? []
    : requestedSlugs.filter((entry) => isPinnedSkillEntry(lock.skills[entry]));
  const slugs = slug
    ? requestedSlugs
    : requestedSlugs.filter((entry) => !isPinnedSkillEntry(lock.skills[entry]));
  if (slugs.length === 0) {
    if (skippedPinned.length > 0) {
      const suffix = skippedPinned.length === 1 ? "" : "s";
      console.log(
        `Skipped ${skippedPinned.length} pinned skill${suffix}: ${skippedPinned.join(", ")}`,
      );
      return;
    }
    console.log("No installed skills.");
    return;
  }

  for (const entry of slugs) {
    const spinner = createSpinner(`Checking ${entry}`);
    try {
      const target = join(opts.dir, entry);
      const exists = await fileExists(target);
      const existingOrigin = exists ? await readSkillOrigin(target) : null;

      // Always fetch skill metadata to check moderation status
      const skillMeta = await apiRequest(
        registry,
        { method: "GET", path: `${ApiRoutes.skills}/${encodeURIComponent(entry)}`, token },
        ApiV1SkillResponseSchema,
      );

      // Check moderation status before proceeding
      if (skillMeta.moderation?.isMalwareBlocked) {
        spinner.fail(`${entry}: blocked as malicious`);
        console.log("   This skill has been flagged as malware and cannot be updated.");
        continue;
      }

      if (skillMeta.moderation?.isSuspicious && !options.force) {
        spinner.stop();
        console.log(
          `\n⚠️  Warning: "${entry}" is flagged as suspicious by VirusTotal Code Insight.\n` +
            "   This skill may contain risky patterns (crypto keys, external APIs, eval, etc.)\n",
        );
        if (allowPrompt) {
          const confirm = await promptConfirm("Update anyway?");
          if (!confirm) {
            console.log(`${entry}: skipped`);
            continue;
          }
          spinner.start(`Checking ${entry}`);
        } else {
          console.log(`${entry}: skipped (use --force to update suspicious skills)`);
          continue;
        }
      }

      let localFingerprint: string | null = null;
      if (exists) {
        const filesOnDisk = await listTextFiles(target);
        if (filesOnDisk.length > 0) {
          const hashed = hashSkillFiles(filesOnDisk);
          localFingerprint = hashed.fingerprint;
        }
      }

      let resolveResult: ResolveResult;
      if (localFingerprint) {
        resolveResult = await resolveSkillVersion(registry, entry, localFingerprint, token);
      } else {
        resolveResult = { match: null, latestVersion: skillMeta.latestVersion ?? null };
      }

      const latest = resolveResult.latestVersion?.version ?? null;
      const matched =
        resolveResult.match?.version ??
        (localFingerprint &&
        existingOrigin?.fingerprint === localFingerprint &&
        existingOrigin.slug === entry
          ? existingOrigin.installedVersion
          : null);

      if (matched && lock.skills[entry]?.version !== matched) {
        lock.skills[entry] = withPinnedMetadata(
          matched,
          lock.skills[entry]?.installedAt ?? Date.now(),
          lock.skills[entry],
        );
      }

      if (!latest) {
        spinner.fail(`${entry}: not found`);
        continue;
      }

      if (!matched && localFingerprint && !options.force) {
        spinner.stop();
        if (!allowPrompt) {
          console.log(`${entry}: local changes (no match). Use --force to overwrite.`);
          continue;
        }
        const confirm = await promptConfirm(
          `${entry}: local changes (no match). Overwrite with ${options.version ?? latest}?`,
        );
        if (!confirm) {
          console.log(`${entry}: skipped`);
          continue;
        }
        spinner.start(`Updating ${entry} -> ${options.version ?? latest}`);
      }

      const targetVersion = options.version ?? latest;
      if (options.version) {
        if (matched && matched === targetVersion) {
          spinner.succeed(`${entry}: already at ${matched}`);
          continue;
        }
      } else if (matched && semver.valid(matched) && semver.gte(matched, targetVersion)) {
        spinner.succeed(`${entry}: up to date (${matched})`);
        continue;
      }

      if (spinner.isSpinning) {
        spinner.text = `Updating ${entry} -> ${targetVersion}`;
      } else {
        spinner.start(`Updating ${entry} -> ${targetVersion}`);
      }
      await rm(target, { recursive: true, force: true });
      const zip = await downloadZip(registry, { slug: entry, version: targetVersion, token });
      await extractZipToDir(zip, target);
      const installedFiles = await listTextFiles(target);
      const installedFingerprint =
        installedFiles.length > 0 ? hashSkillFiles(installedFiles).fingerprint : undefined;

      await writeSkillOrigin(target, {
        version: 1,
        registry: existingOrigin?.registry ?? registry,
        slug: existingOrigin?.slug ?? entry,
        installedVersion: targetVersion,
        installedAt: existingOrigin?.installedAt ?? Date.now(),
        fingerprint: installedFingerprint,
      });

      lock.skills[entry] = withPinnedMetadata(targetVersion, Date.now(), lock.skills[entry]);
      spinner.succeed(`${entry}: updated -> ${targetVersion}`);
    } catch (error) {
      spinner.fail(formatError(error));
      throw error;
    }
  }

  await writeLockfile(opts.workdir, lock);
  if (skippedPinned.length > 0) {
    const suffix = skippedPinned.length === 1 ? "" : "s";
    console.log(
      `Skipped ${skippedPinned.length} pinned skill${suffix}: ${skippedPinned.join(", ")}`,
    );
  }
}

export async function cmdList(opts: GlobalOpts) {
  const lock = await readLockfile(opts.workdir);
  const entries = Object.entries(lock.skills);
  const manualSkills = await listManualSkills(opts.dir, new Set(Object.keys(lock.skills)));
  if (entries.length === 0 && manualSkills.length === 0) {
    console.log("No installed skills.");
    return;
  }
  for (const [slug, entry] of entries) {
    const pinned = isPinnedSkillEntry(entry) ? `  pinned${formatPinnedDetails(entry)}` : "";
    console.log(`${slug}  ${entry.version ?? "latest"}${pinned}`);
  }
  if (manualSkills.length > 0) {
    if (entries.length > 0) console.log();
    console.log("Manually installed (not tracked by clawhub):");
    for (const slug of manualSkills) {
      console.log(`  ${slug}`);
    }
  }
}

export async function cmdPin(opts: GlobalOpts, slug: string, options: { reason?: string } = {}) {
  const trimmed = normalizeSkillSlugOrFail(slug);
  const lock = await readLockfile(opts.workdir);
  const existing = lock.skills[trimmed];
  if (!existing) fail(`Not installed: ${trimmed}`);

  const reason = options.reason?.trim() || existing.pinReason;
  if (isPinnedSkillEntry(existing) && reason === existing.pinReason) {
    console.log(`Skill "${trimmed}" is already pinned${reason ? `: ${reason}` : ""}`);
    return;
  }

  lock.skills[trimmed] = {
    ...existing,
    pinned: true,
    ...(reason ? { pinReason: reason } : {}),
  };
  await writeLockfile(opts.workdir, lock);
  console.log(`Pinned ${trimmed}${reason ? `: ${reason}` : ""}`);
}

export async function cmdUnpin(opts: GlobalOpts, slug: string) {
  const trimmed = normalizeSkillSlugOrFail(slug);
  const lock = await readLockfile(opts.workdir);
  const existing = lock.skills[trimmed];
  if (!existing) fail(`Not installed: ${trimmed}`);
  if (!isPinnedSkillEntry(existing)) fail(`Skill "${trimmed}" is not pinned`);

  lock.skills[trimmed] = {
    version: existing.version,
    installedAt: existing.installedAt,
  };
  await writeLockfile(opts.workdir, lock);
  console.log(`Unpinned ${trimmed}`);
}

export async function cmdUninstall(
  opts: GlobalOpts,
  slug: string,
  options: { yes?: boolean } = {},
  inputAllowed: boolean,
) {
  const trimmed = normalizeSkillSlugOrFail(slug);

  const lock = await readLockfile(opts.workdir);
  if (!lock.skills[trimmed]) {
    fail(`Not installed: ${trimmed}`);
  }

  const allowPrompt = isInteractive() && inputAllowed;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const confirm = await promptConfirm(`Uninstall ${trimmed}?`);
    if (!confirm) {
      console.log("Cancelled.");
      return;
    }
  }

  const spinner = createSpinner(`Uninstalling ${trimmed}`);
  try {
    const target = join(opts.dir, trimmed);

    await rm(target, { recursive: true, force: true });

    delete lock.skills[trimmed];
    await writeLockfile(opts.workdir, lock);

    spinner.succeed(`Uninstalled ${trimmed}`);
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

type ExploreSort = "newest" | "downloads" | "rating" | "installs" | "installsAllTime" | "trending";
type ApiExploreSort =
  | "createdAt"
  | "updated"
  | "downloads"
  | "stars"
  | "installsCurrent"
  | "installsAllTime"
  | "trending";

export async function cmdExplore(
  opts: GlobalOpts,
  options: { limit?: number; sort?: string; json?: boolean } = {},
) {
  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Fetching latest skills");
  try {
    const url = registryUrl(ApiRoutes.skills, registry);
    const boundedLimit = clampLimit(options.limit ?? 25);
    const { apiSort } = resolveExploreSort(options.sort);
    url.searchParams.set("limit", String(boundedLimit));
    if (apiSort !== "updated") url.searchParams.set("sort", apiSort);
    const result = await apiRequest(
      registry,
      { method: "GET", url: url.toString(), token },
      ApiV1SkillListResponseSchema,
    );

    spinner.stop();
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.items.length === 0) {
      console.log("No skills found.");
      return;
    }

    for (const item of result.items) {
      console.log(formatExploreLine(item));
    }
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export function formatExploreLine(item: {
  slug: string;
  summary?: string | null;
  updatedAt: number;
  latestVersion?: { version: string } | null;
}) {
  const version = item.latestVersion?.version ?? "?";
  const age = formatRelativeTime(item.updatedAt);
  const summary = item.summary ? `  ${truncate(item.summary, 50)}` : "";
  return `${item.slug}  v${version}  ${age}${summary}`;
}

export function clampLimit(limit: number, fallback = 25) {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, limit), 200);
}

export async function cmdReportSkill(
  opts: GlobalOpts,
  slug: string,
  options: SkillReportOptions = {},
) {
  const trimmed = normalizeSkillSlugOrFail(slug);
  const reason = options.reason?.trim();
  if (!reason) fail("--reason required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(
    registry,
    {
      method: "POST",
      path: `${ApiRoutes.skills}/${encodeURIComponent(trimmed)}/report`,
      token,
      body: {
        reason,
        ...(options.version?.trim() ? { version: options.version.trim() } : {}),
      },
    },
    ApiV1SkillReportResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.alreadyReported) {
    console.log(`Already reported ${trimmed}.`);
  } else {
    console.log(`OK. Reported ${trimmed} (${result.reportId}).`);
  }
}

export async function cmdListSkillReports(opts: GlobalOpts, options: SkillReportListOptions = {}) {
  const status = options.status?.trim() || "open";
  if (!["open", "confirmed", "dismissed", "all"].includes(status)) {
    fail("--status must be open, confirmed, dismissed, or all");
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.skills}/-/reports`, registry);
  url.searchParams.set("status", status);
  if (options.cursor?.trim()) url.searchParams.set("cursor", options.cursor.trim());
  url.searchParams.set("limit", String(clampLimit(options.limit ?? 25, 25)));
  const result = await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1SkillReportListResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.items.length === 0) {
    console.log("No skill reports found.");
  } else {
    for (const item of result.items) {
      const reporter = item.reporter.handle ?? item.reporter.userId;
      console.log(`${item.reportId} ${item.status} ${item.slug}`);
      console.log(`  reporter: ${reporter}`);
      if (item.reason) console.log(`  reason: ${item.reason}`);
      if (item.triageNote) console.log(`  note: ${item.triageNote}`);
    }
  }
  if (!result.done && result.nextCursor) console.log(`Next cursor: ${result.nextCursor}`);
}

export async function cmdTriageSkillReport(
  opts: GlobalOpts,
  reportId: string,
  options: SkillReportTriageOptions = {},
) {
  const trimmed = reportId.trim();
  if (!trimmed) fail("Report id required");
  const statusValue = options.status?.trim();
  if (!statusValue || !["open", "confirmed", "dismissed"].includes(statusValue)) {
    fail("--status must be open, confirmed, or dismissed");
  }
  const status = statusValue as SkillReportStatus;
  const finalAction = (options.finalAction ?? options.action)?.trim() as
    | SkillReportFinalAction
    | undefined;
  if (finalAction && !["none", "hide"].includes(finalAction)) {
    fail("--action must be none or hide");
  }
  const note = options.note?.trim();
  if (status !== "open" && !note) fail("--note required unless reopening");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  await presentModerationPlan(
    reportModerationPlan({
      entityLabel: "skill",
      reportId: trimmed,
      status,
      finalAction: finalAction ?? "none",
    }),
    options,
  );
  const result = await apiRequest(
    registry,
    {
      method: "POST",
      path: `${ApiRoutes.skills}/-/reports/${encodeURIComponent(trimmed)}/triage`,
      token,
      body: {
        status,
        ...(note ? { note } : {}),
        ...(finalAction ? { finalAction } : {}),
      },
    },
    ApiV1SkillReportTriageResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const actionSuffix =
    result.actionTaken && result.actionTaken !== "none" ? `; action ${result.actionTaken}` : "";
  console.log(`OK. Skill report ${trimmed} set to ${result.status}${actionSuffix}.`);
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

function resolveExploreSort(raw?: string): { sort: ExploreSort; apiSort: ApiExploreSort } {
  const normalized = raw?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "newest" ||
    normalized === "createdat" ||
    normalized === "created-at"
  ) {
    return { sort: "newest", apiSort: "createdAt" };
  }
  if (normalized === "updated") {
    return { sort: "newest", apiSort: "updated" };
  }
  if (normalized === "downloads" || normalized === "download") {
    return { sort: "downloads", apiSort: "downloads" };
  }
  if (normalized === "rating" || normalized === "stars" || normalized === "star") {
    return { sort: "rating", apiSort: "stars" };
  }
  if (
    normalized === "installs" ||
    normalized === "install" ||
    normalized === "installscurrent" ||
    normalized === "installs-current" ||
    normalized === "current"
  ) {
    return { sort: "installs", apiSort: "installsCurrent" };
  }
  if (normalized === "installsalltime" || normalized === "installs-all-time") {
    return { sort: "installsAllTime", apiSort: "installsAllTime" };
  }
  if (normalized === "trending") {
    return { sort: "trending", apiSort: "trending" };
  }
  return fail(
    `Invalid sort "${raw}". Use newest, updated, downloads, rating, installs, installsAllTime, or trending.`,
  );
}

async function resolveSkillVersion(registry: string, slug: string, hash: string, token?: string) {
  const url = registryUrl(ApiRoutes.resolve, registry);
  url.searchParams.set("slug", slug);
  url.searchParams.set("hash", hash);
  return apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1SkillResolveResponseSchema,
  );
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
