import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { isCancel, multiselect } from "@clack/prompts";
import semver from "semver";
import { resolveHome } from "../../homedir.js";
import { apiRequest } from "../../http.js";
import { ApiRoutes, ApiV1SkillResolveResponseSchema } from "../../schema/index.js";
import { findSkillFolders, type SkillFolder } from "../scanSkills.js";
import type { GlobalOpts } from "../types.js";
import { fail, formatError } from "../ui.js";
import type { Candidate, LocalSkill } from "./syncTypes.js";

export function buildScanRoots(opts: GlobalOpts, extraRoots: string[] | undefined) {
  const roots = [opts.workdir, opts.dir, ...(extraRoots ?? [])];
  return Array.from(new Set(roots.map((root) => resolveScanRoot(opts, root))));
}

function resolveScanRoot(opts: GlobalOpts, root: string) {
  return isAbsolute(root) ? resolve(root) : resolve(opts.workdir, root);
}

export function normalizeConcurrency(value: number | undefined) {
  const raw = typeof value === "number" ? value : 4;
  const rounded = Number.isFinite(raw) ? Math.round(raw) : 4;
  return Math.min(32, Math.max(1, rounded));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
) {
  const results = Array.from({ length: items.length }) as R[];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function checkRegistrySyncState(
  registry: string,
  skill: LocalSkill,
  ownerHandle?: string,
  token?: string,
): Promise<Candidate> {
  try {
    const params = new URLSearchParams({
      slug: skill.slug,
      hash: skill.fingerprint,
    });
    if (ownerHandle) params.set("ownerHandle", ownerHandle);
    const resolved = await apiRequest(
      registry,
      {
        method: "GET",
        path: `${ApiRoutes.resolve}?${params.toString()}`,
        token,
      },
      ApiV1SkillResolveResponseSchema,
    );
    const latestVersion = resolved.latestVersion?.version ?? null;
    const matchVersion = resolved.match?.version ?? null;
    if (!latestVersion) {
      return { ...skill, status: "new", matchVersion: null, latestVersion: null };
    }
    return {
      ...skill,
      status: matchVersion ? "synced" : "update",
      matchVersion,
      latestVersion,
    };
  } catch (error) {
    const message = formatError(error);
    if (/skill not found/i.test(message) || /HTTP 404/i.test(message)) {
      return { ...skill, status: "new", matchVersion: null, latestVersion: null };
    }
    throw error;
  }
}

export async function scanRootsWithLabels(roots: string[]) {
  const all: SkillFolder[] = [];
  const rootsWithSkills: string[] = [];
  const uniqueRoots = await dedupeRoots(roots);
  const skillsByRoot: Record<string, SkillFolder[]> = {};
  for (const root of uniqueRoots) {
    const found = await findSkillFolders(root);
    skillsByRoot[root] = found;
    if (found.length > 0) rootsWithSkills.push(root);
    all.push(...found);
  }
  const byFolder = new Map<string, SkillFolder>();
  for (const folder of all) {
    byFolder.set(folder.folder, folder);
  }
  return {
    roots: uniqueRoots,
    skillsByRoot,
    skills: Array.from(byFolder.values()),
    rootsWithSkills,
  };
}

async function dedupeRoots(roots: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of roots) {
    const resolved = resolve(root);
    const canonical = await realpath(resolved).catch(() => null);
    const key = canonical ?? resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  return unique;
}

export async function selectToUpload(
  candidates: Candidate[],
  params: { allowPrompt: boolean; all: boolean; bump: "patch" | "minor" | "major" },
): Promise<Candidate[]> {
  if (params.all || !params.allowPrompt) return candidates;

  const valueByKey = new Map<string, Candidate>();
  const choices = candidates.map((candidate) => {
    const key = candidate.folder;
    valueByKey.set(key, candidate);
    return {
      value: key,
      label: `${candidate.slug}  ${formatActionableStatus(candidate, params.bump)}`,
      hint: `${abbreviatePath(candidate.folder)} | ${candidate.fileCount} files`,
    };
  });

  const picked = await multiselect({
    message: "Select skills to publish",
    options: choices,
    initialValues: choices.map((choice) => choice.value),
    required: false,
  });
  if (isCancel(picked)) fail("Canceled");
  return picked.map((key) => valueByKey.get(key)).filter(Boolean) as Candidate[];
}

export function resolvePublishMeta(
  skill: Candidate,
  params: { bump: "patch" | "minor" | "major"; changelogFlag?: string },
) {
  if (skill.status === "new") {
    return { publishVersion: "1.0.0", changelog: "" };
  }

  const latest = skill.latestVersion;
  if (!latest) fail(`Could not resolve latest version for ${skill.slug}`);
  const publishVersion = semver.inc(latest, params.bump);
  if (!publishVersion) fail(`Could not bump version for ${skill.slug}`);

  const fromFlag = params.changelogFlag?.trim();
  return { publishVersion, changelog: fromFlag ?? "" };
}

export function formatList(values: string[], max: number) {
  if (values.length === 0) return "";
  const shown = values.map(abbreviatePath);
  if (shown.length <= max) return shown.join("\n");
  const head = shown.slice(0, Math.max(1, max - 1));
  const rest = values.length - head.length;
  return [...head, `... +${rest} more`].join("\n");
}

export function printSection(title: string, body?: string) {
  const trimmed = body?.trim();
  if (!trimmed) {
    console.log(title);
    return;
  }
  if (trimmed.includes("\n")) {
    console.log(`\n${title}\n${trimmed}`);
    return;
  }
  console.log(`${title}: ${trimmed}`);
}

function abbreviatePath(value: string) {
  const home = resolveHome();
  if (value.startsWith(home)) return `~${value.slice(home.length)}`;
  return value;
}

export function dedupeSkillsBySlug(skills: SkillFolder[]) {
  const bySlug = new Map<string, SkillFolder[]>();
  for (const skill of skills) {
    const existing = bySlug.get(skill.slug);
    if (existing) existing.push(skill);
    else bySlug.set(skill.slug, [skill]);
  }
  const unique: SkillFolder[] = [];
  const duplicates: string[] = [];
  for (const [slug, entries] of bySlug.entries()) {
    unique.push(entries[0] as SkillFolder);
    if (entries.length > 1) duplicates.push(`${slug} (${entries.length})`);
  }
  return { skills: unique, duplicates };
}

function formatActionableStatus(candidate: Candidate, bump: "patch" | "minor" | "major"): string {
  if (candidate.status === "new") return "NEW (publish 1.0.0)";
  const latest = candidate.latestVersion;
  const next = latest ? semver.inc(latest, bump) : null;
  if (latest && next) return `LOCAL CHANGES latest ${latest}; publish ${next}`;
  return "LOCAL CHANGES";
}

export function formatActionableLine(
  candidate: Candidate,
  bump: "patch" | "minor" | "major",
): string {
  return `${candidate.slug}  ${formatActionableStatus(candidate, bump)}  (${candidate.fileCount} files)`;
}

function formatSyncedLine(candidate: Candidate): string {
  const version = candidate.matchVersion ?? candidate.latestVersion ?? "unknown";
  return `${candidate.slug}  synced (${version})`;
}

export function formatSyncedSummary(candidate: Candidate): string {
  const version = candidate.matchVersion ?? candidate.latestVersion;
  return version ? `${candidate.slug}@${version}` : candidate.slug;
}

export function formatBulletList(lines: string[], max: number): string {
  if (lines.length <= max) return lines.map((line) => `- ${line}`).join("\n");
  const head = lines.slice(0, max);
  const rest = lines.length - head.length;
  return [...head, `... +${rest} more`].map((line) => `- ${line}`).join("\n");
}

export function formatSyncedDisplay(synced: Candidate[]) {
  const lines = synced.map(formatSyncedLine);
  if (lines.length <= 12) return formatBulletList(lines, 12);
  return formatCommaList(synced.map(formatSyncedSummary), 24);
}

export function formatCommaList(values: string[], max: number) {
  if (values.length === 0) return "";
  if (values.length <= max) return values.join(", ");
  const head = values.slice(0, Math.max(1, max - 1));
  const rest = values.length - head.length;
  return `${head.join(", ")}, ... +${rest} more`;
}
