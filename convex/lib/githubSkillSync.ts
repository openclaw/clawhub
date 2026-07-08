import { MAX_SKILL_DISPLAY_NAME_LENGTH } from "clawhub-schema";
import { ConvexError } from "convex/values";
import {
  shouldPreserveSecurityScanStateForUnchangedContent,
  type SourceBackedSkillScanStatus,
} from "./securityScanPolicy";
import { getFrontmatterValue, parseFrontmatter } from "./skills";

export type GitHubSkillScanStatus = SourceBackedSkillScanStatus;
export type GitHubCurrentStatus = "present" | "missing" | "unknown";
export type DisplayManifestStatus = "ok" | "missing" | "invalid" | "failed";

export type DisplayManifest = {
  notGrouped?: "top" | "bottom";
  groupings: Array<{
    title: string;
    description?: string;
    skills: string[];
  }>;
};

export type GitHubSkillSourceSnapshot = {
  repo: string;
  defaultBranch: string;
  commit: string;
  manifestStatus: DisplayManifestStatus;
  manifestHash?: string;
  manifest?: DisplayManifest;
  skills: DiscoveredGitHubSkill[];
};

export type GitHubSkillSourceMetadataSnapshot = Omit<GitHubSkillSourceSnapshot, "skills"> & {
  skills: DiscoveredGitHubSkillMetadata[];
};

export type DiscoveredGitHubSkill = {
  slug: string;
  displayName: string;
  summary?: string;
  upstreamVersion?: string;
  path: string;
  skillMarkdownPath: string;
  skillMarkdown: string;
  skillCardMarkdownPath?: string;
  skillCardMarkdown?: string;
  contentHash: string;
};

export type DiscoveredGitHubSkillMetadata = Omit<
  DiscoveredGitHubSkill,
  "skillMarkdown" | "skillCardMarkdown"
>;

export type ExistingGitHubSkillForSync = {
  _id: string;
  slug: string;
  displayName: string;
  summary?: string;
  latestVersionSummary?: {
    version: string;
    createdAt: number;
  };
  githubPath?: string;
  githubCurrentCommit?: string;
  githubCurrentContentHash?: string;
  githubCurrentStatus?: GitHubCurrentStatus;
  githubScanStatus?: GitHubSkillScanStatus;
  githubRemovedAt?: number;
  softDeletedAt?: number;
};

export type GitHubBackedSkillModeration = {
  moderationStatus: "active" | "hidden";
  moderationReason?: string;
  moderationVerdict?: "clean" | "suspicious" | "malicious";
  moderationFlags: string[];
  isSuspicious: boolean;
};

export type GitHubSkillPatchForSync = {
  skillId: string;
  slug: string;
  patch: Record<string, unknown>;
};

export type GitHubSkillInsertForSync = {
  slug: string;
  doc: Record<string, unknown>;
};

export type GitHubSkillSyncPlan = {
  sourcePatch: Record<string, unknown>;
  skillPatches: GitHubSkillPatchForSync[];
  skillInserts: GitHubSkillInsertForSync[];
  stats: {
    discovered: number;
    inserted: number;
    changed: number;
    unchanged: number;
    removed: number;
  };
};

const SKILL_MARKDOWN_BASENAME = "skill.md";
const SKILL_CARD_MARKDOWN_BASENAME = "skill-card.md";
const MAX_STORED_MARKDOWN_BYTES = 512 * 1024;
const MAX_STORED_SKILL_CONTENT_BYTES = 768 * 1024;

export function parseSkillsShDisplayManifest(raw: string | undefined | null): {
  status: DisplayManifestStatus;
  manifest?: DisplayManifest;
} {
  if (raw === undefined || raw === null) return { status: "missing", manifest: undefined };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", manifest: undefined };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", manifest: undefined };
  }

  const record = parsed as Record<string, unknown>;
  const rawGroups = record.groupings;
  if (!Array.isArray(rawGroups)) return { status: "invalid", manifest: undefined };

  const groupings = rawGroups.flatMap((group): DisplayManifest["groupings"] => {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    const groupRecord = group as Record<string, unknown>;
    const title = typeof groupRecord.title === "string" ? groupRecord.title.trim() : "";
    const description =
      typeof groupRecord.description === "string" ? groupRecord.description.trim() : "";
    const skills = Array.isArray(groupRecord.skills)
      ? groupRecord.skills
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    if (!title || skills.length === 0) return [];
    return [
      {
        title,
        ...(description ? { description } : {}),
        skills,
      },
    ];
  });

  if (groupings.length === 0) return { status: "invalid", manifest: undefined };

  const notGrouped =
    record.notGrouped === "top" || record.notGrouped === "bottom" ? record.notGrouped : undefined;
  return {
    status: "ok",
    manifest: {
      ...(notGrouped ? { notGrouped } : {}),
      groupings,
    },
  };
}

export async function buildGitHubSkillSourceSnapshot({
  repo,
  defaultBranch,
  commit,
  entries,
}: {
  repo: string;
  defaultBranch: string;
  commit: string;
  entries: Record<string, Uint8Array>;
}): Promise<GitHubSkillSourceSnapshot> {
  const normalizedEntries = normalizeEntryMap(entries);
  const manifestBytes = normalizedEntries["skills.sh.json"];
  const manifestText = manifestBytes ? decodeUtf8(manifestBytes) : undefined;
  const parsedManifest = parseSkillsShDisplayManifest(manifestText);
  const manifestHash = manifestBytes ? await sha256Hex(manifestBytes) : undefined;
  const skillPaths = discoverSkillPaths(normalizedEntries);
  const skills: DiscoveredGitHubSkill[] = [];

  for (const skillMdPath of skillPaths) {
    const path = parentPath(skillMdPath);
    const markdownBytes = normalizedEntries[skillMdPath] ?? new Uint8Array();
    assertStoredMarkdownSize(skillMdPath, markdownBytes);
    const markdown = decodeUtf8(markdownBytes);
    const frontmatter = parseFrontmatter(markdown);
    const folderName = path.split("/").filter(Boolean).at(-1) ?? "";
    const slug = slugFromPathSegment(folderName);
    if (!slug) continue;
    const frontmatterName = getFrontmatterValue(frontmatter, "name")?.trim();
    const frontmatterDescription = getFrontmatterValue(frontmatter, "description")?.trim();
    const frontmatterVersion = getFrontmatterValue(frontmatter, "version")?.trim();
    const heading = firstMarkdownHeading(markdown);
    const skillCardMarkdownPath = findFolderFilePath(
      normalizedEntries,
      path,
      SKILL_CARD_MARKDOWN_BASENAME,
    );
    const skillCardBytes = skillCardMarkdownPath
      ? normalizedEntries[skillCardMarkdownPath]
      : undefined;
    if (skillCardMarkdownPath && skillCardBytes) {
      assertStoredMarkdownSize(skillCardMarkdownPath, skillCardBytes);
      assertStoredSkillContentSize(markdownBytes.byteLength + skillCardBytes.byteLength);
    } else {
      assertStoredSkillContentSize(markdownBytes.byteLength);
    }
    const skillCardMarkdown = skillCardBytes ? decodeUtf8(skillCardBytes) : undefined;

    skills.push({
      slug,
      displayName: normalizeGitHubSkillDisplayName(frontmatterName || heading, slug),
      ...(frontmatterDescription ? { summary: frontmatterDescription } : {}),
      ...(frontmatterVersion ? { upstreamVersion: frontmatterVersion } : {}),
      path,
      skillMarkdownPath: skillMdPath,
      skillMarkdown: markdown,
      ...(skillCardMarkdownPath ? { skillCardMarkdownPath } : {}),
      ...(skillCardMarkdown !== undefined ? { skillCardMarkdown } : {}),
      contentHash: await computeGitHubSkillFolderContentHash(normalizedEntries, path),
    });
  }

  const sortedSkills = skills.sort((a, b) => a.path.localeCompare(b.path));
  assertUniqueDiscoveredSlugs(sortedSkills);

  return {
    repo,
    defaultBranch,
    commit,
    manifestStatus: parsedManifest.status,
    ...(manifestHash ? { manifestHash } : {}),
    ...(parsedManifest.manifest ? { manifest: parsedManifest.manifest } : {}),
    skills: sortedSkills,
  };
}

export async function computeGitHubSkillFolderContentHash(
  entries: Record<string, Uint8Array>,
  folderPath: string,
) {
  const normalizedEntries = normalizeEntryMap(entries);
  const root = folderPath ? `${folderPath}/` : "";
  const lines: string[] = [];
  for (const [path, content] of Object.entries(normalizedEntries).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (root && path !== folderPath && !path.startsWith(root)) continue;
    if (!root && path.includes("/")) continue;
    const relativePath = root ? path.slice(root.length) : path;
    if (!relativePath) continue;
    const fileHash = await sha256Hex(content);
    lines.push(`${relativePath}\0${content.byteLength}\0${fileHash}`);
  }
  return sha256Hex(new TextEncoder().encode(lines.join("\n")));
}

export function buildGitHubSkillSyncPlan({
  sourceId,
  ownerUserId,
  ownerPublisherId,
  existingSkills,
  snapshot,
  now,
}: {
  sourceId: string;
  ownerUserId: string;
  ownerPublisherId?: string;
  existingSkills: ExistingGitHubSkillForSync[];
  snapshot: GitHubSkillSourceSnapshot | GitHubSkillSourceMetadataSnapshot;
  now: number;
}): GitHubSkillSyncPlan {
  const sourcePatch = {
    repo: snapshot.repo,
    defaultBranch: snapshot.defaultBranch,
    lastSyncStatus: "ok",
    lastSyncError: undefined,
    lastSyncErrorAt: undefined,
    displayManifestKind: "skills.sh",
    displayManifestHash: snapshot.manifestHash,
    displayManifestCommit: snapshot.commit,
    displayManifestFetchedAt: now,
    displayManifestStatus: snapshot.manifestStatus,
    displayManifest: snapshot.manifest,
    ...(ownerPublisherId ? { ownerPublisherId } : {}),
    updatedAt: now,
  };
  const existingByPath = new Map(
    existingSkills
      .filter((skill) => skill.githubPath)
      .map((skill) => [skill.githubPath as string, skill]),
  );
  const existingBySlug = new Map(existingSkills.map((skill) => [skill.slug, skill]));
  const matchedSkillIds = new Set<string>();
  const skillPatches: GitHubSkillPatchForSync[] = [];
  const skillInserts: GitHubSkillInsertForSync[] = [];
  const stats = {
    discovered: snapshot.skills.length,
    inserted: 0,
    changed: 0,
    unchanged: 0,
    removed: 0,
  };

  for (const discovered of snapshot.skills) {
    const existing = existingByPath.get(discovered.path) ?? existingBySlug.get(discovered.slug);
    if (!existing) {
      const scanStatus: GitHubSkillScanStatus = "pending";
      const moderation = githubBackedSkillModeration(scanStatus);
      skillInserts.push({
        slug: discovered.slug,
        doc: {
          slug: discovered.slug,
          displayName: discovered.displayName,
          summary: discovered.summary,
          ownerUserId,
          ownerPublisherId,
          installKind: "github",
          githubSourceId: sourceId,
          githubPath: discovered.path,
          githubHasSkillCard: Boolean(discovered.skillCardMarkdownPath),
          githubCurrentCommit: snapshot.commit,
          githubCurrentContentHash: discovered.contentHash,
          githubCurrentStatus: "present",
          githubCurrentCheckedAt: now,
          githubScanStatus: scanStatus,
          githubRemovedAt: undefined,
          latestVersionId: undefined,
          latestVersionSummary: latestVersionSummary(discovered.upstreamVersion, now),
          tags: {},
          softDeletedAt: undefined,
          badges: undefined,
          statsDownloads: 0,
          statsStars: 0,
          statsInstallsCurrent: 0,
          statsInstallsAllTime: 0,
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
            comments: 0,
          },
          ...moderation,
          createdAt: now,
          updatedAt: now,
        },
      });
      stats.inserted += 1;
      continue;
    }

    matchedSkillIds.add(existing._id);
    const currentContentUnchanged =
      existing.githubCurrentStatus === "present" &&
      existing.githubCurrentContentHash === discovered.contentHash;
    const scanStatus: GitHubSkillScanStatus = currentContentUnchanged
      ? githubScanStatusForUnchangedContent(existing.githubScanStatus)
      : "pending";
    const moderation = githubBackedSkillModeration(scanStatus);
    const nextLatestVersionSummary = latestVersionSummary(
      discovered.upstreamVersion,
      existing.latestVersionSummary?.createdAt ?? now,
    );
    const nextDisplayName =
      existing.displayName.length > MAX_SKILL_DISPLAY_NAME_LENGTH &&
      discovered.displayName.length >= MAX_SKILL_DISPLAY_NAME_LENGTH
        ? existing.displayName
        : discovered.displayName;
    const materialChanged =
      !currentContentUnchanged ||
      existing.displayName !== nextDisplayName ||
      (existing.summary ?? undefined) !== (discovered.summary ?? undefined) ||
      (existing.githubPath ?? undefined) !== discovered.path ||
      !sameLatestVersionSummary(existing.latestVersionSummary, nextLatestVersionSummary);
    const patch = {
      displayName: nextDisplayName,
      summary: discovered.summary,
      ownerUserId,
      ...(ownerPublisherId ? { ownerPublisherId } : {}),
      githubSourceId: sourceId,
      githubPath: discovered.path,
      githubHasSkillCard: Boolean(discovered.skillCardMarkdownPath),
      githubCurrentCommit: snapshot.commit,
      githubCurrentContentHash: discovered.contentHash,
      githubCurrentStatus: "present",
      githubCurrentCheckedAt: now,
      githubScanStatus: scanStatus,
      githubRemovedAt: undefined,
      softDeletedAt: undefined,
      ...(materialChanged
        ? {
            latestVersionSummary: latestVersionSummary(discovered.upstreamVersion, now),
            updatedAt: now,
          }
        : {}),
      ...moderation,
    };
    skillPatches.push({ skillId: existing._id, slug: existing.slug, patch });
    if (materialChanged) stats.changed += 1;
    else stats.unchanged += 1;
  }

  for (const existing of existingSkills) {
    if (matchedSkillIds.has(existing._id)) continue;
    const removedAt = existing.githubRemovedAt ?? now;
    const moderation = githubBackedSkillModeration(
      existing.githubScanStatus ?? "pending",
      removedAt,
    );
    const wasAlreadyRemoved =
      existing.githubCurrentStatus === "missing" && existing.githubRemovedAt !== undefined;
    skillPatches.push({
      skillId: existing._id,
      slug: existing.slug,
      patch: {
        githubCurrentCommit: snapshot.commit,
        githubCurrentStatus: "missing",
        githubCurrentCheckedAt: now,
        githubRemovedAt: removedAt,
        softDeletedAt: existing.softDeletedAt ?? removedAt,
        ...(wasAlreadyRemoved ? {} : { updatedAt: now }),
        ...moderation,
      },
    });
    stats.removed += 1;
  }

  return { sourcePatch, skillPatches, skillInserts, stats };
}

function githubScanStatusForUnchangedContent(
  status: GitHubSkillScanStatus | undefined,
): GitHubSkillScanStatus {
  if (shouldPreserveSecurityScanStateForUnchangedContent(status)) return status;
  return "pending";
}

function normalizeGitHubSkillDisplayName(name: string | undefined, slug: string) {
  const preferred = name?.trim() || titleizeSlug(slug);
  if (preferred.length <= MAX_SKILL_DISPLAY_NAME_LENGTH) return preferred;
  const fallback = titleizeSlug(slug);
  if (fallback.length <= MAX_SKILL_DISPLAY_NAME_LENGTH) return fallback;
  return fallback.slice(0, MAX_SKILL_DISPLAY_NAME_LENGTH).trimEnd();
}

export function githubBackedSkillModeration(
  scanStatus: GitHubSkillScanStatus,
  removedAt?: number,
): GitHubBackedSkillModeration {
  if (typeof removedAt === "number") {
    return {
      moderationStatus: "hidden",
      moderationReason: "github.upstream.removed",
      moderationVerdict: undefined,
      moderationFlags: [],
      isSuspicious: false,
    };
  }
  if (scanStatus === "pending") {
    return {
      moderationStatus: "active",
      moderationReason: "pending.scan",
      moderationVerdict: undefined,
      moderationFlags: [],
      isSuspicious: false,
    };
  }
  if (scanStatus === "failed") {
    return {
      moderationStatus: "hidden",
      moderationReason: "scanner.failed",
      moderationVerdict: undefined,
      moderationFlags: [],
      isSuspicious: false,
    };
  }
  if (scanStatus === "malicious") {
    return {
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.malicious",
      moderationVerdict: "malicious",
      moderationFlags: ["blocked.malware"],
      isSuspicious: true,
    };
  }
  if (scanStatus === "suspicious") {
    return {
      moderationStatus: "active",
      moderationReason: "scanner.llm.suspicious",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      isSuspicious: true,
    };
  }
  return {
    moderationStatus: "active",
    moderationReason: undefined,
    moderationVerdict: "clean",
    moderationFlags: [],
    isSuspicious: false,
  };
}

function latestVersionSummary(version: string | undefined, now: number) {
  if (!version) return undefined;
  return {
    version,
    createdAt: now,
    changelog: "Synced from GitHub source.",
    changelogSource: "auto" as const,
  };
}

function sameLatestVersionSummary(
  a: ExistingGitHubSkillForSync["latestVersionSummary"] | undefined,
  b: ReturnType<typeof latestVersionSummary>,
) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.version === b.version;
}

function assertStoredMarkdownSize(path: string, bytes: Uint8Array) {
  if (bytes.byteLength > MAX_STORED_MARKDOWN_BYTES) {
    throw new ConvexError(`GitHub skill markdown file is too large to cache: ${path}`);
  }
}

function assertStoredSkillContentSize(totalBytes: number) {
  if (totalBytes > MAX_STORED_SKILL_CONTENT_BYTES) {
    throw new ConvexError("GitHub skill cached markdown is too large");
  }
}

function assertUniqueDiscoveredSlugs(skills: DiscoveredGitHubSkill[]) {
  const firstPathBySlug = new Map<string, string>();
  for (const skill of skills) {
    const firstPath = firstPathBySlug.get(skill.slug);
    if (firstPath) {
      throw duplicateSkillSlugError(skill.slug, firstPath, skill.path);
    }
    firstPathBySlug.set(skill.slug, skill.path);
  }
}

function normalizeEntryMap(entries: Record<string, Uint8Array>) {
  const out: Record<string, Uint8Array> = {};
  for (const [rawPath, bytes] of Object.entries(entries)) {
    const normalized = normalizeRepoPath(rawPath);
    if (!normalized) continue;
    out[normalized] = new Uint8Array(bytes);
  }
  return out;
}

function discoverSkillPaths(entries: Record<string, Uint8Array>) {
  const candidates = Object.keys(entries)
    .filter((path) => path.split("/").at(-1)?.toLowerCase() === SKILL_MARKDOWN_BASENAME)
    .sort((a, b) => a.localeCompare(b));
  const pathsBySlug = new Map<string, string[]>();

  for (const skillMdPath of candidates) {
    const path = parentPath(skillMdPath);
    const folderName = path.split("/").filter(Boolean).at(-1) ?? "";
    const slug = slugFromPathSegment(folderName);
    if (!slug) continue;
    const paths = pathsBySlug.get(slug) ?? [];
    paths.push(skillMdPath);
    pathsBySlug.set(slug, paths);
  }

  const selected: string[] = [];
  for (const [slug, paths] of pathsBySlug) {
    if (paths.length === 1) {
      selected.push(paths[0] as string);
      continue;
    }

    const catalogSkillMatches = paths.filter((path) => path.toLowerCase().startsWith("skills/"));
    if (catalogSkillMatches.length === 1) {
      selected.push(catalogSkillMatches[0] as string);
      continue;
    }

    throw duplicateSkillSlugError(
      slug,
      parentPath(paths[0] as string),
      parentPath(paths[1] as string),
    );
  }

  return selected.sort((a, b) => a.localeCompare(b));
}

function duplicateSkillSlugError(slug: string, firstPath: string, secondPath: string) {
  return new ConvexError(
    `GitHub skill source has duplicate normalized slug "${slug}" at ${firstPath} and ${secondPath}`,
  );
}

function findFolderFilePath(
  entries: Record<string, Uint8Array>,
  folderPath: string,
  basename: string,
) {
  const prefix = folderPath ? `${folderPath}/` : "";
  return Object.keys(entries).find((entryPath) => {
    if (prefix) {
      if (!entryPath.startsWith(prefix)) return false;
      const relativePath = entryPath.slice(prefix.length);
      return !relativePath.includes("/") && relativePath.toLowerCase() === basename;
    }
    return !entryPath.includes("/") && entryPath.toLowerCase() === basename;
  });
}

function normalizeRepoPath(path: string) {
  if (path.includes("\u0000")) return "";
  const normalized = path
    .replaceAll("\\", "/")
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized) return "";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return "";
  return segments.join("/");
}

function parentPath(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(bytes: Uint8Array) {
  const safe = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", safe);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function slugFromPathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleizeSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstMarkdownHeading(markdown: string) {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}
