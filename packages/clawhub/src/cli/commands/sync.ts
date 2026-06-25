import { isAbsolute, relative } from "node:path";
import { intro, outro } from "@clack/prompts";
import { hashSkillFiles, readSkillOrigin } from "../../skills.js";
import { getOptionalAuthToken, requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import { getFallbackSkillRoots } from "../scanSkills.js";
import type { GlobalOpts } from "../types.js";
import { createCrabLoader, fail, formatError, isInteractive } from "../ui.js";
import { normalizeGitHubRepo } from "./github.js";
import { cmdPublish, prepareSkillFilesForPublish, resolveDefaultOwnerHandle } from "./publish.js";
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
  const registry = await getRegistry(opts, { cache: true });
  const ownerHandle = await resolveSyncOwnerHandle(registry, token, options.owner);
  const selectedRoots = buildScanRoots(opts, options.root);
  const concurrency = normalizeConcurrency(options.concurrency);

  const spinner = jsonMode ? null : createCrabLoader("Scanning for local skills");
  const primaryScan = await scanRootsWithLabels(selectedRoots);
  let scan = primaryScan;
  let outputRoots = primaryScan.roots;
  if (primaryScan.skills.length === 0) {
    const fallbackScan = await scanRootsWithLabels(getFallbackSkillRoots(opts.workdir));
    spinner?.stop();
    scan = fallbackScan;
    outputRoots = fallbackScan.roots;
    if (fallbackScan.skills.length === 0) fail("No skills found (checked configured roots)");
    if (!options.dryRun && options.all) {
      fail(
        "Refusing to publish fallback skill roots with --all. Pass --root for the skills to sync.",
      );
    }
    if (!jsonMode) {
      printSection(
        `No skills in workdir. Found ${fallbackScan.skills.length} in fallback locations.`,
        formatList(fallbackScan.rootsWithSkills, 10),
      );
    }
  } else {
    spinner?.stop();
    if (!jsonMode && primaryScan.rootsWithSkills.length > 0) {
      printSection("Roots with skills", formatList(primaryScan.rootsWithSkills, 10));
    }
  }

  const deduped = dedupeSkillsBySlug(scan.skills);
  const skills = deduped.skills;
  if (!jsonMode && deduped.duplicates.length > 0) {
    printSection("Skipped duplicate slugs", formatCommaList(deduped.duplicates, 16));
  }

  const parsingLoader = jsonMode ? null : createCrabLoader("Parsing local skills");
  const locals: LocalSkill[] = [];
  try {
    let done = 0;
    const parsed = await mapWithConcurrency(skills, Math.min(concurrency, 12), async (skill) => {
      const filesOnDisk = await prepareSkillFilesForPublish(skill.folder);
      const hashed = hashSkillFiles(filesOnDisk);
      const origin = await readSkillOrigin(skill.folder);
      done += 1;
      if (parsingLoader) parsingLoader.text = `Parsing local skills ${done}/${skills.length}`;
      return {
        ...skill,
        fingerprint: hashed.fingerprint,
        fileCount: filesOnDisk.length,
        origin,
      };
    });
    locals.push(...parsed);
  } catch (error) {
    parsingLoader?.fail(formatError(error));
    throw error;
  } finally {
    parsingLoader?.stop();
  }

  const candidatesLoader = jsonMode ? null : createCrabLoader("Checking registry sync state");
  const candidates: Candidate[] = [];
  try {
    let done = 0;
    const resolved = await mapWithConcurrency(locals, Math.min(concurrency, 16), async (skill) => {
      try {
        return await checkRegistrySyncState(registry, skill, ownerHandle, token);
      } finally {
        done += 1;
        if (candidatesLoader) {
          candidatesLoader.text = `Checking registry sync state ${done}/${locals.length}`;
        }
      }
    });
    candidates.push(...resolved);
  } catch (error) {
    candidatesLoader?.fail(formatError(error));
    throw error;
  } finally {
    candidatesLoader?.stop();
  }

  const synced = candidates.filter((candidate) => candidate.status === "synced");
  const actionable = candidates.filter((candidate) => candidate.status !== "synced");
  const bump = options.bump ?? "patch";

  if (actionable.length === 0) {
    writeNoActionOutput({
      jsonMode,
      dryRun: Boolean(options.dryRun),
      registry,
      roots: outputRoots,
      owner: ownerHandle,
      duplicates: deduped.duplicates,
      synced,
    });
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

  if (!options.dryRun && !options.all && !allowPrompt) {
    fail("Pass --all to publish every detected local skill without prompting.");
  }

  const selected = await selectToUpload(actionable, {
    allowPrompt,
    all: Boolean(options.all),
    bump,
  });
  if (selected.length === 0) {
    writeNoActionOutput({
      jsonMode,
      dryRun: Boolean(options.dryRun),
      registry,
      roots: outputRoots,
      owner: ownerHandle,
      duplicates: deduped.duplicates,
      synced,
      outroText: "Nothing selected.",
    });
    return;
  }

  const plannedPublishes = selected.map((skill) => {
    const source = buildSourceProvenance(opts, skill, options, outputRoots);
    return { skill, source };
  });

  if (options.dryRun) {
    const wouldPublish = plannedPublishes.map(({ skill, source }) => {
      const { publishVersion } = resolvePublishMeta(skill, {
        bump,
        changelogFlag: options.changelog,
      });
      return formatPublishJson(skill, publishVersion, source);
    });
    if (jsonMode) {
      writeSyncJson(
        buildSyncJsonOutput({
          ok: true,
          dryRun: true,
          registry,
          roots: outputRoots,
          owner: ownerHandle,
          duplicates: deduped.duplicates,
          alreadySynced: synced.map(formatSyncedJson),
          wouldPublish,
          published: [],
          failed: [],
        }),
      );
      return;
    }
    outro(`Dry run: would publish ${selected.length} skill(s).`);
    return;
  }

  const tags = options.tags ?? "latest";
  const failedUploads: Array<{ slug: string; message: string }> = [];
  const published: Array<{ slug: string; folder: string; version: string }> = [];
  const racedNoOps: Array<{ slug: string; folder: string; version: string }> = [];

  for (const { skill, source } of plannedPublishes) {
    const { publishVersion, changelog } = resolvePublishMeta(skill, {
      bump,
      changelogFlag: options.changelog,
    });
    const forkOf = buildForkOf(skill, registry, ownerHandle);
    try {
      const previousExitCode = process.exitCode;
      const result = await cmdPublish(opts, skill.folder, {
        slug: skill.slug,
        name: skill.displayName,
        owner: ownerHandle,
        version: publishVersion,
        changelog,
        tags,
        forkOf,
        quiet: jsonMode,
        ...(source
          ? {
              sourceRepo: options.sourceRepo,
              sourceCommit: options.sourceCommit,
              sourceRef: options.sourceRef,
              sourcePath: source.path,
            }
          : {}),
      });
      const publishExitCode = process.exitCode;
      if (isNonZeroExitCode(publishExitCode) && publishExitCode !== previousExitCode) {
        process.exitCode = previousExitCode;
        failedUploads.push({
          slug: skill.slug,
          message: `Publish command exited with code ${String(publishExitCode)}`,
        });
        continue;
      }
      if (result?.status === "unchanged") {
        racedNoOps.push({
          slug: skill.slug,
          folder: skill.folder,
          version: result.version ?? publishVersion,
        });
        continue;
      }
      published.push({
        slug: skill.slug,
        folder: skill.folder,
        version: result?.version ?? publishVersion,
      });
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
          roots: outputRoots,
          owner: ownerHandle,
          duplicates: deduped.duplicates,
          alreadySynced: [...synced.map(formatSyncedJson), ...racedNoOps],
          wouldPublish: [],
          published,
          failed: failedUploads,
        }),
      );
      process.exitCode = 1;
      return;
    }
    printSection(
      "Failed to publish",
      formatBulletList(
        failedUploads.map((failure) => `${failure.slug}: ${failure.message}`),
        20,
      ),
    );
    outro(
      `Published ${published.length} of ${selected.length} skill(s). ${failedUploads.length} failed.`,
    );
    process.exitCode = 1;
    return;
  }

  if (jsonMode) {
    writeSyncJson(
      buildSyncJsonOutput({
        ok: true,
        dryRun: false,
        registry,
        roots: outputRoots,
        owner: ownerHandle,
        duplicates: deduped.duplicates,
        alreadySynced: [...synced.map(formatSyncedJson), ...racedNoOps],
        wouldPublish: [],
        published,
        failed: [],
      }),
    );
    return;
  }

  if (racedNoOps.length > 0) {
    outro(
      `Published ${published.length} of ${selected.length} skill(s). ${racedNoOps.length} already synced.`,
    );
  } else {
    outro(`Published ${published.length} skill(s).`);
  }
}

function writeNoActionOutput(params: {
  jsonMode: boolean;
  dryRun: boolean;
  registry: string;
  roots: string[];
  owner?: string;
  duplicates: string[];
  synced: Candidate[];
  outroText?: string;
}) {
  if (params.jsonMode) {
    writeSyncJson(
      buildSyncJsonOutput({
        ok: true,
        dryRun: params.dryRun,
        registry: params.registry,
        roots: params.roots,
        owner: params.owner,
        duplicates: params.duplicates,
        alreadySynced: params.synced.map(formatSyncedJson),
        wouldPublish: [],
        published: [],
        failed: [],
      }),
    );
    return;
  }
  if (params.synced.length > 0) {
    printSection("Already synced", formatCommaList(params.synced.map(formatSyncedSummary), 16));
  }
  outro(params.outroText ?? "Nothing to sync.");
}

function normalizeRegistry(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function buildForkOf(skill: Candidate, registry: string, ownerHandle: string | undefined) {
  const origin = skill.origin;
  if (!origin || normalizeRegistry(origin.registry) !== normalizeRegistry(registry))
    return undefined;
  const originOwner = normalizeOwner(origin.ownerHandle);
  const publishOwner = normalizeOwner(ownerHandle);
  if (origin.slug === skill.slug && originOwner === publishOwner) return undefined;
  const ref = `${origin.slug}@${origin.installedVersion}`;
  return originOwner ? `@${originOwner}/${ref}` : ref;
}

function isNonZeroExitCode(value: string | number | null | undefined) {
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "0";
  return false;
}

function normalizeOwner(value: string | undefined) {
  return value?.trim().replace(/^@+/, "") || undefined;
}

async function resolveSyncOwnerHandle(registry: string, token: string | undefined, owner?: string) {
  const explicitOwner = normalizeOwner(owner);
  if (explicitOwner || !token) return explicitOwner;
  return await resolveDefaultOwnerHandle(registry, token);
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

function buildSourceProvenance(
  opts: GlobalOpts,
  skill: Candidate,
  options: SyncOptions,
  scanRoots: string[],
) {
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
    path: sourcePathForSkill(opts, skill.folder, scanRoots),
  };
}

function sourcePathForSkill(opts: GlobalOpts, folder: string, scanRoots: string[]) {
  const bases = Array.from(
    new Set([opts.workdir, opts.dir, ...scanRoots, process.cwd()].map(normalizeSourcePathBase)),
  );
  for (const base of bases) {
    const rel = relativeInside(base, folder);
    if (rel) return rel;
  }
  fail(
    "Source provenance requires each skill folder to be inside the current directory, --workdir, configured skills directory, or a --root directory.",
  );
  throw new Error("unreachable");
}

function normalizeSourcePathBase(value: string) {
  return value.replace(/\/+$/, "") || "/";
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
