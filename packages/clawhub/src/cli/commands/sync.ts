import { isAbsolute, relative } from "node:path";
import { intro, outro } from "@clack/prompts";
import { hashSkillFiles, listTextFiles, readSkillOrigin } from "../../skills.js";
import { getOptionalAuthToken, requireAuthToken } from "../authToken.js";
import { resolveClawdbotSkillRoots } from "../clawdbotConfig.js";
import { getRegistry } from "../registry.js";
import { getFallbackSkillRoots } from "../scanSkills.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError, isInteractive } from "../ui.js";
import { normalizeGitHubRepo } from "./github.js";
import { cmdPublish } from "./publish.js";
import {
  buildScanRoots,
  checkRegistrySyncState,
  dedupeSkillsBySlug,
  formatActionableLine,
  formatBulletList,
  formatCommaList,
  formatList,
  formatSyncedDisplay,
  formatSyncedSummary,
  getRegistryWithAuth,
  mapWithConcurrency,
  normalizeConcurrency,
  printSection,
  resolvePublishMeta,
  scanRootsWithLabels,
  selectToUpload,
} from "./syncHelpers.js";
import type { Candidate, LocalSkill, SyncOptions } from "./syncTypes.js";

export async function cmdSync(opts: GlobalOpts, options: SyncOptions, inputAllowed: boolean) {
  const jsonMode = options.json === true;
  const allowPrompt = !jsonMode && isInteractive() && inputAllowed !== false;
  if (!jsonMode) intro("ClawHub sync");

  const token = options.dryRun ? await getOptionalAuthToken() : await requireAuthToken();

  const registry = token
    ? await getRegistryWithAuth(opts, token)
    : await getRegistry(opts, { cache: true });
  const selectedRoots = buildScanRoots(opts, options.root);
  const includeClawdbotRoots = options.clawdbotRoots !== false;
  const clawdbotRoots = includeClawdbotRoots
    ? await resolveClawdbotSkillRoots()
    : { roots: [], labels: {} };
  const combinedRoots = Array.from(
    new Set([...selectedRoots, ...clawdbotRoots.roots].map((root) => root.trim()).filter(Boolean)),
  );
  const concurrency = normalizeConcurrency(options.concurrency);

  const spinner = jsonMode ? null : createSpinner("Scanning for local skills");
  const primaryScan = await scanRootsWithLabels(combinedRoots, clawdbotRoots.labels);
  let scan = primaryScan;
  if (primaryScan.skills.length === 0) {
    if (!includeClawdbotRoots) {
      fail("No skills found (checked configured roots)");
    }
    const fallback = getFallbackSkillRoots(opts.workdir);
    const fallbackScan = await scanRootsWithLabels(fallback);
    spinner?.stop();
    scan = fallbackScan;
    if (fallbackScan.skills.length === 0)
      fail("No skills found (checked workdir and known Clawdis/Clawd locations)");
    if (!jsonMode) {
      printSection(
        `No skills in workdir. Found ${fallbackScan.skills.length} in fallback locations.`,
        formatList(fallbackScan.rootsWithSkills, 10),
      );
    }
  } else {
    spinner?.stop();
    const labeledRoots = primaryScan.rootsWithSkills
      .map((root) => {
        const label = primaryScan.rootLabels?.[root];
        return label ? `${label} (${root})` : root;
      })
      .filter(Boolean);
    if (!jsonMode && labeledRoots.length > 0) {
      printSection("Roots with skills", formatList(labeledRoots, 10));
    }
  }
  const deduped = dedupeSkillsBySlug(scan.skills);
  const skills = deduped.skills;
  if (!jsonMode && deduped.duplicates.length > 0) {
    printSection("Skipped duplicate slugs", formatCommaList(deduped.duplicates, 16));
  }
  const parsingSpinner = jsonMode ? null : createSpinner("Parsing local skills");
  const locals: LocalSkill[] = [];
  try {
    let done = 0;
    const parsed = await mapWithConcurrency(skills, Math.min(concurrency, 12), async (skill) => {
      const filesOnDisk = await listTextFiles(skill.folder);
      const hashed = hashSkillFiles(filesOnDisk);
      const origin = await readSkillOrigin(skill.folder);
      done += 1;
      if (parsingSpinner) parsingSpinner.text = `Parsing local skills ${done}/${skills.length}`;
      return {
        ...skill,
        fingerprint: hashed.fingerprint,
        fileCount: filesOnDisk.length,
        origin,
      };
    });
    locals.push(...parsed);
  } catch (error) {
    parsingSpinner?.fail(formatError(error));
    throw error;
  } finally {
    parsingSpinner?.stop();
  }

  const candidatesSpinner = jsonMode ? null : createSpinner("Checking registry sync state");
  const candidates: Candidate[] = [];
  const resolveSupport: { value: boolean | null } = { value: null };
  try {
    let done = 0;
    const resolved = await mapWithConcurrency(locals, Math.min(concurrency, 16), async (skill) => {
      try {
        return await checkRegistrySyncState(registry, skill, resolveSupport, token);
      } finally {
        done += 1;
        if (candidatesSpinner) {
          candidatesSpinner.text = `Checking registry sync state ${done}/${locals.length}`;
        }
      }
    });
    candidates.push(...resolved);
  } catch (error) {
    candidatesSpinner?.fail(formatError(error));
    throw error;
  } finally {
    candidatesSpinner?.stop();
  }

  const synced = candidates.filter((candidate) => candidate.status === "synced");
  const actionable = candidates.filter((candidate) => candidate.status !== "synced");
  const bump = options.bump ?? "patch";

  if (actionable.length === 0) {
    if (jsonMode) {
      writeSyncJson(
        buildSyncJsonOutput({
          ok: true,
          dryRun: Boolean(options.dryRun),
          registry,
          roots: combinedRoots,
          owner: normalizeOwner(options.owner),
          duplicates: deduped.duplicates,
          alreadySynced: synced.map(formatSyncedJson),
          wouldPublish: [],
          published: [],
          failed: [],
        }),
      );
      return;
    }
    if (synced.length > 0) {
      printSection("Already synced", formatCommaList(synced.map(formatSyncedSummary), 16));
    }
    outro("Nothing to sync.");
    return;
  }

  if (!jsonMode) {
    printSection(
      "To sync",
      formatBulletList(
        actionable.map((candidate) => formatActionableLine(candidate, bump)),
        20,
      ),
    );
  }
  if (!jsonMode && synced.length > 0) {
    printSection("Already synced", formatSyncedDisplay(synced));
  }

  const selected = await selectToUpload(actionable, {
    allowPrompt,
    all: Boolean(options.all),
    bump,
  });
  if (selected.length === 0) {
    if (jsonMode) {
      writeSyncJson(
        buildSyncJsonOutput({
          ok: true,
          dryRun: Boolean(options.dryRun),
          registry,
          roots: combinedRoots,
          owner: normalizeOwner(options.owner),
          duplicates: deduped.duplicates,
          alreadySynced: synced.map(formatSyncedJson),
          wouldPublish: [],
          published: [],
          failed: [],
        }),
      );
      return;
    }
    outro("Nothing selected.");
    return;
  }

  const plannedPublishes = selected.map((skill) => {
    const source = buildSourceProvenance(opts, skill, options);
    return { skill, source };
  });

  if (options.dryRun) {
    const wouldPublish = await Promise.all(
      plannedPublishes.map(async ({ skill, source }) => {
        const { publishVersion } = await resolvePublishMeta(skill, {
          bump,
          allowPrompt,
          changelogFlag: options.changelog,
        });
        return formatPublishJson(skill, publishVersion, source);
      }),
    );
    if (jsonMode) {
      writeSyncJson(
        buildSyncJsonOutput({
          ok: true,
          dryRun: true,
          registry,
          roots: combinedRoots,
          owner: normalizeOwner(options.owner),
          duplicates: deduped.duplicates,
          alreadySynced: synced.map(formatSyncedJson),
          wouldPublish,
          published: [],
          failed: [],
        }),
      );
      return;
    }
    outro(`Dry run: would upload ${selected.length} skill(s).`);
    return;
  }

  const tags = options.tags ?? "latest";
  const failedUploads: Array<{ slug: string; message: string }> = [];
  let uploaded = 0;

  const published: Array<{ slug: string; folder: string; version: string }> = [];
  for (const { skill, source } of plannedPublishes) {
    const { publishVersion, changelog } = await resolvePublishMeta(skill, {
      bump,
      allowPrompt,
      changelogFlag: options.changelog,
    });
    const forkOf =
      skill.origin && normalizeRegistry(skill.origin.registry) === normalizeRegistry(registry)
        ? skill.origin.slug !== skill.slug
          ? `${skill.origin.slug}@${skill.origin.installedVersion}`
          : undefined
        : undefined;
    try {
      await cmdPublish(opts, skill.folder, {
        slug: skill.slug,
        name: skill.displayName,
        owner: normalizeOwner(options.owner),
        version: publishVersion,
        changelog,
        tags,
        forkOf,
        ...(source
          ? {
              sourceRepo: options.sourceRepo,
              sourceCommit: options.sourceCommit,
              sourceRef: options.sourceRef,
              sourcePath: source.path,
            }
          : {}),
      });
      uploaded += 1;
      published.push({ slug: skill.slug, folder: skill.folder, version: publishVersion });
    } catch (error) {
      failedUploads.push({ slug: skill.slug, message: formatError(error) });
    }
  }

  if (failedUploads.length > 0) {
    if (jsonMode) {
      writeSyncJson(
        buildSyncJsonOutput({
          ok: false,
          dryRun: false,
          registry,
          roots: combinedRoots,
          owner: normalizeOwner(options.owner),
          duplicates: deduped.duplicates,
          alreadySynced: synced.map(formatSyncedJson),
          wouldPublish: [],
          published,
          failed: failedUploads,
        }),
      );
      process.exitCode = 1;
      return;
    }
    printSection(
      "Failed to upload",
      formatBulletList(
        failedUploads.map((failure) => `${failure.slug}: ${failure.message}`),
        20,
      ),
    );
    outro(`Uploaded ${uploaded} of ${selected.length} skill(s). ${failedUploads.length} failed.`);
    process.exitCode = 1;
    return;
  }

  if (jsonMode) {
    writeSyncJson(
      buildSyncJsonOutput({
        ok: true,
        dryRun: false,
        registry,
        roots: combinedRoots,
        owner: normalizeOwner(options.owner),
        duplicates: deduped.duplicates,
        alreadySynced: synced.map(formatSyncedJson),
        wouldPublish: [],
        published,
        failed: [],
      }),
    );
    return;
  }

  outro(`Uploaded ${selected.length} skill(s).`);
}

function normalizeRegistry(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeOwner(value: string | undefined) {
  return value?.trim().replace(/^@+/, "") || undefined;
}

function formatSyncedJson(candidate: Candidate) {
  return {
    slug: candidate.slug,
    folder: candidate.folder,
    version: candidate.matchVersion ?? candidate.latestVersion ?? "unknown",
  };
}

function formatPublishJson(
  candidate: Candidate,
  version: string,
  source: ReturnType<typeof buildSourceProvenance>,
) {
  return {
    slug: candidate.slug,
    displayName: candidate.displayName,
    folder: candidate.folder,
    status: candidate.status,
    version,
    latestVersion: candidate.latestVersion,
    fileCount: candidate.fileCount,
    fingerprint: candidate.fingerprint,
    ...(source ? { source } : {}),
  };
}

function buildSourceProvenance(opts: GlobalOpts, skill: Candidate, options: SyncOptions) {
  const rawRepo = options.sourceRepo?.trim();
  const commit = options.sourceCommit?.trim();
  if (!rawRepo && !commit && !options.sourceRef?.trim()) return undefined;
  if (!rawRepo || !commit) fail("--source-repo and --source-commit must be provided together");
  const repo = normalizeGitHubRepo(rawRepo);
  if (!repo) fail("--source-repo must be a GitHub repo or URL");
  return {
    kind: "github" as const,
    url: `https://github.com/${repo}`,
    repo,
    ref: options.sourceRef?.trim() || commit,
    commit,
    path: sourcePathForSkill(opts, skill.folder),
  };
}

function sourcePathForSkill(opts: GlobalOpts, folder: string) {
  return (
    relativeInside(process.cwd(), folder) ??
    relativeInside(opts.workdir, folder) ??
    relativeInside(opts.dir, folder) ??
    normalizeSourcePath(folder)
  );
}

function relativeInside(base: string, target: string) {
  const rel = relative(base, target);
  if (!rel) return ".";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return normalizeSourcePath(rel);
}

function normalizeSourcePath(value: string) {
  const normalized = value
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  return normalized || ".";
}

function buildSyncJsonOutput(params: {
  ok: boolean;
  dryRun: boolean;
  registry: string;
  roots: string[];
  owner?: string;
  duplicates: string[];
  alreadySynced: Array<{ slug: string; folder: string; version: string }>;
  wouldPublish: Array<ReturnType<typeof formatPublishJson>>;
  published: Array<{ slug: string; folder: string; version: string }>;
  failed: Array<{ slug: string; message: string }>;
}) {
  const skipped = params.duplicates.map((duplicate) => ({
    slug: duplicate.replace(/\s+\(\d+\)$/, ""),
    reason: "duplicate-slug",
    detail: duplicate,
  }));
  return {
    ok: params.ok,
    dryRun: params.dryRun,
    registry: params.registry,
    roots: params.roots,
    ...(params.owner ? { owner: params.owner } : {}),
    summary: {
      wouldPublish: params.wouldPublish.length,
      published: params.published.length,
      alreadySynced: params.alreadySynced.length,
      skipped: skipped.length,
      failed: params.failed.length,
    },
    wouldPublish: params.wouldPublish,
    published: params.published,
    alreadySynced: params.alreadySynced,
    skipped,
    failed: params.failed,
  };
}

function writeSyncJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
