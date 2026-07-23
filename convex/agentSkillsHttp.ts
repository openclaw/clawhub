import { unzipSync } from "fflate";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { scheduleSkillDownloadMetric } from "./downloads";
import { httpAction } from "./functions";
import {
  buildAgentSkillsDiscoveryDocument,
  buildNormalizedAgentSkillArchive,
} from "./lib/agentSkillsDiscovery";
import { fetchGitHubZipBytes, stripGitHubZipRoot } from "./lib/githubImport";
import { computeGitHubSkillFolderContentHash } from "./lib/githubSkillSync";
import {
  buildSkillInstallResolution,
  type InstallResolverSkill,
  type InstallResolverSource,
  type SkillInstallResolution,
} from "./lib/installResolver";
import {
  getPublicSkillFileAccessBlock,
  getPublicSkillVersionDownloadBlock,
  type SkillFileModerationInfo,
} from "./lib/skillFileAccess";

const ROUTE_PREFIX = "/api/v1/agent-skills/";

type AgentSkillsCtx = ActionCtx;

type HostedVersion = {
  _id: Id<"skillVersions">;
  skillId: Id<"skills">;
  version: string;
  files: Array<{ path: string; storageId: Id<"_storage"> }>;
  publicationStatus?: "pending" | "published" | "blocked";
  softDeletedAt?: number;
  ownerDeletedAt?: number;
  llmAnalysis?: {
    status?: string | null;
    verdict?: string | null;
  } | null;
};

type ResolvedSkill = {
  skillId: Id<"skills">;
  displayName: string;
  description?: string | null;
  resolution: Extract<SkillInstallResolution, { ok: true }>;
  hostedVersion: HostedVersion | null;
};

export async function agentSkillsHttpHandler(ctx: AgentSkillsCtx, request: Request) {
  const route = parseRoute(request);
  if (!route) return text("Not found", 404);

  const archivePin = route.action === "archive" ? parseArchivePin(request) : null;
  if (route.action === "archive" && !archivePin) {
    return text("Archive pin is missing or invalid; fetch the discovery document again.", 409);
  }

  const resolved = await resolveSkill(ctx, request, route.ownerHandle, route.slug, archivePin);
  if (!resolved.ok) return text(resolved.message, resolved.status);

  if (route.action === "index.json") {
    const archiveResult = await buildArchive(ctx, resolved.skill);
    if (!archiveResult.ok) return text(archiveResult.message, archiveResult.status);
    const digest = await sha256Hex(archiveResult.archive);
    const pin =
      resolved.skill.resolution.installKind === "archive"
        ? { version: resolved.skill.resolution.archive.version }
        : {
            commit: resolved.skill.resolution.github.commit,
            contentHash: resolved.skill.resolution.github.contentHash,
          };
    return Response.json(
      buildAgentSkillsDiscoveryDocument({
        origin: new URL(request.url).origin,
        ownerHandle: route.ownerHandle,
        slug: route.slug,
        displayName: resolved.skill.displayName,
        description: resolved.skill.description,
        digest,
        ...pin,
      }),
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }

  const archiveResult = await buildArchive(ctx, resolved.skill);
  if (!archiveResult.ok) return text(archiveResult.message, archiveResult.status);
  if (request.method !== "HEAD") {
    await scheduleSkillDownloadMetric(ctx, request, resolved.skill.skillId);
  }
  return new Response(new Blob([archiveResult.archive], { type: "application/zip" }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${route.slug}.zip"`,
      "Content-Type": "application/zip",
    },
  });
}

export const agentSkillsHttp = httpAction(agentSkillsHttpHandler);

function parseRoute(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(ROUTE_PREFIX)) return null;
  let segments: string[];
  try {
    segments = pathname
      .slice(ROUTE_PREFIX.length)
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (segments.length !== 3) return null;
  const [ownerHandle, slug, action] = segments;
  if (!ownerHandle || !slug || (action !== "index.json" && action !== "archive")) return null;
  return { ownerHandle, slug: slug.toLowerCase(), action };
}

async function resolveSkill(
  ctx: AgentSkillsCtx,
  request: Request,
  ownerHandle: string,
  slug: string,
  archivePin: ArchivePin | null,
): Promise<{ ok: true; skill: ResolvedSkill } | { ok: false; status: number; message: string }> {
  const skill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
    slug,
    ownerHandle,
  })) as
    | (InstallResolverSkill & {
        _id: Id<"skills">;
        githubSourceId?: Id<"githubSkillSources">;
        latestVersionId?: Id<"skillVersions">;
      })
    | null;
  if (!skill) return { ok: false, status: 404, message: "Skill not found" };

  const publicResult = (await ctx.runQuery(api.skills.getBySlug, {
    slug,
    ownerHandle,
  })) as {
    skill: { _id: Id<"skills">; displayName: string; summary?: string | null } | null;
    moderationInfo?: SkillFileModerationInfo | null;
    latestVersion: {
      version: string;
    } | null;
  } | null;
  if (!publicResult?.skill || publicResult.skill._id !== skill._id) {
    return { ok: false, status: 404, message: "Skill not found" };
  }

  let hostedVersion: ResolvedSkill["hostedVersion"] = null;
  let resolution: Extract<SkillInstallResolution, { ok: true }>;
  if (archivePin?.kind === "hosted") {
    const version = (await ctx.runQuery(internal.skills.getVersionBySkillAndVersionInternal, {
      skillId: skill._id,
      version: archivePin.version,
    })) as HostedVersion | null;
    if (
      !version ||
      version.skillId !== skill._id ||
      version.version !== archivePin.version ||
      version.softDeletedAt ||
      version.ownerDeletedAt ||
      (version.publicationStatus !== undefined && version.publicationStatus !== "published")
    ) {
      return { ok: false, status: 404, message: "Skill version not available" };
    }
    const moderationBlock = getPublicSkillVersionDownloadBlock(
      publicResult.moderationInfo,
      version,
      skill.latestVersionId,
    );
    if (moderationBlock) {
      return {
        ok: false,
        status: moderationBlock.status,
        message: moderationBlock.message,
      };
    }
    hostedVersion = version;
    resolution = {
      ok: true,
      slug: skill.slug,
      installKind: "archive",
      archive: {
        version: version.version,
        downloadUrl: "",
      },
    };
  } else if (archivePin?.kind === "github") {
    const scan = (await ctx.runQuery(
      internal.githubSkillSync.getArchiveScanBySkillAndContentHashInternal,
      {
        skillId: skill._id,
        contentHash: archivePin.contentHash,
      },
    )) as {
      githubSourceId: Id<"githubSkillSources">;
      contentHash: string;
      commit: string;
      path: string;
      status: "clean" | "suspicious" | "malicious" | "pending" | "failed";
    } | null;
    if (
      !scan ||
      scan.contentHash !== archivePin.contentHash ||
      (scan.status !== "clean" && scan.status !== "suspicious")
    ) {
      return { ok: false, status: 404, message: "GitHub skill archive not available" };
    }
    const source = (await ctx.runQuery(internal.githubSkillSources.getByIdInternal, {
      sourceId: scan.githubSourceId,
    })) as InstallResolverSource | null;
    if (!source) {
      return { ok: false, status: 404, message: "GitHub skill archive not available" };
    }
    const moderationBlock = getPublicSkillFileAccessBlock(publicResult.moderationInfo);
    if (moderationBlock) {
      return {
        ok: false,
        status: moderationBlock.status,
        message: moderationBlock.message,
      };
    }
    resolution = {
      ok: true,
      slug: skill.slug,
      installKind: "github",
      github: {
        repo: source.repo,
        path: scan.path,
        commit: archivePin.commit,
        contentHash: scan.contentHash,
        sourceUrl: `https://github.com/${source.repo}/tree/${archivePin.commit}/${scan.path}`,
      },
    };
  } else {
    const source =
      skill.installKind === "github" && skill.githubSourceId
        ? ((await ctx.runQuery(internal.githubSkillSources.getByIdInternal, {
            sourceId: skill.githubSourceId,
          })) as InstallResolverSource | null)
        : null;
    const currentResolution = buildSkillInstallResolution({
      origin: new URL(request.url).origin,
      skill,
      source,
      ownerHandle,
    });
    if (!currentResolution.ok) {
      return {
        ok: false,
        status: currentResolution.status,
        message: currentResolution.message,
      };
    }
    resolution = currentResolution;
    if (resolution.installKind === "archive") {
      if (
        !skill.latestVersionId ||
        publicResult.latestVersion?.version !== resolution.archive.version
      ) {
        return { ok: false, status: 404, message: "Skill version not available" };
      }
      const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId: skill.latestVersionId,
      })) as HostedVersion | null;
      if (
        !version ||
        version.skillId !== skill._id ||
        version.version !== resolution.archive.version ||
        version.softDeletedAt ||
        version.ownerDeletedAt ||
        (version.publicationStatus !== undefined && version.publicationStatus !== "published")
      ) {
        return { ok: false, status: 404, message: "Skill version not available" };
      }
      const moderationBlock = getPublicSkillVersionDownloadBlock(
        publicResult.moderationInfo,
        version,
        skill.latestVersionId,
      );
      if (moderationBlock) {
        return {
          ok: false,
          status: moderationBlock.status,
          message: moderationBlock.message,
        };
      }
      hostedVersion = version;
    } else {
      const moderationBlock = getPublicSkillFileAccessBlock(publicResult.moderationInfo);
      if (moderationBlock) {
        return {
          ok: false,
          status: moderationBlock.status,
          message: moderationBlock.message,
        };
      }
    }
  }

  return {
    ok: true,
    skill: {
      skillId: skill._id,
      displayName: publicResult.skill.displayName,
      description: publicResult.skill.summary,
      resolution,
      hostedVersion,
    },
  };
}

async function buildArchive(ctx: AgentSkillsCtx, resolved: ResolvedSkill) {
  if (resolved.resolution.installKind === "archive") {
    const entries: Record<string, Uint8Array> = {};
    for (const file of resolved.hostedVersion?.files ?? []) {
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) {
        return {
          ok: false as const,
          status: 410,
          message: "Skill archive file missing from storage",
        };
      }
      entries[file.path] = new Uint8Array(await blob.arrayBuffer());
    }
    return {
      ok: true as const,
      archive: buildNormalizedAgentSkillArchive(entries),
    };
  }

  const github = resolved.resolution.github;
  const [owner, repo] = github.repo.split("/");
  if (!owner || !repo) throw new Error("GitHub-backed skill source metadata is incomplete");
  const zip = await fetchGitHubZipBytes(
    {
      owner,
      repo,
      ref: github.commit,
      commit: github.commit,
      path: github.path,
      repoUrl: `https://github.com/${github.repo}`,
      originalUrl: github.sourceUrl,
    },
    fetch,
  );
  const entries = stripGitHubZipRoot(unzipSync(zip));
  const contentHash = await computeGitHubSkillFolderContentHash(entries, github.path);
  if (contentHash !== github.contentHash) {
    return {
      ok: false as const,
      status: 409,
      message: "GitHub skill archive no longer matches its pinned content hash",
    };
  }
  return {
    ok: true as const,
    archive: buildNormalizedAgentSkillArchive(entries, github.path),
  };
}

type ArchivePin =
  | { kind: "hosted"; version: string }
  | { kind: "github"; commit: string; contentHash: string };

function parseArchivePin(request: Request): ArchivePin | null {
  const url = new URL(request.url);
  const version = url.searchParams.get("version")?.trim();
  const commit = url.searchParams.get("commit")?.trim();
  const contentHash = url.searchParams.get("contentHash")?.trim();
  if (version && !commit && !contentHash) {
    return { kind: "hosted", version };
  }
  if (!version && commit && contentHash) {
    return { kind: "github", commit, contentHash };
  }
  return null;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function text(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
