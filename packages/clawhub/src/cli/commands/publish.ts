import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import semver from "semver";
import { apiRequest, apiRequestForm, registryUrl } from "../../http.js";
import {
  ApiRoutes,
  ApiV1PublishResponseSchema,
  ApiV1SkillResolveResponseSchema,
  ApiV1WhoamiResponseSchema,
} from "../../schema/index.js";
import { hashSkillFiles, listTextFiles } from "../../skills.js";
import { getOptionalAuthToken, requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import { sanitizeSlug, titleCase } from "../slug.js";
import type { GlobalOpts } from "../types.js";
import { createCrabLoader, fail, formatError } from "../ui.js";
import { normalizeGitHubRepo } from "./github.js";

type SkillPublishResult = {
  ok: true;
  status: "unchanged" | "would-publish" | "published" | "pending-publication";
  slug: string;
  displayName: string;
  folder: string;
  version: string;
  latestVersion: string | null;
  fileCount: number;
  fingerprint: string;
  versionId?: string;
  publicationStatus?: "pending" | "published";
  attemptId?: string;
};

export async function cmdPublish(
  opts: GlobalOpts,
  folderArg: string,
  options: {
    slug?: string;
    name?: string;
    owner?: string;
    sourceOwner?: string;
    version?: string;
    changelog?: string;
    tags?: string;
    categories?: string;
    topics?: string;
    forkOf?: string;
    migrateOwner?: boolean;
    sourceRepo?: string;
    sourceCommit?: string;
    sourceRef?: string;
    sourcePath?: string;
    dryRun?: boolean;
    json?: boolean;
    quiet?: boolean;
  },
): Promise<SkillPublishResult> {
  const folder = folderArg ? resolve(opts.workdir, folderArg) : null;
  if (!folder) fail("Path required");
  const folderStat = await stat(folder).catch(() => null);
  if (!folderStat || !folderStat.isDirectory()) fail("Path must be a folder");
  if (await looksLikePluginFolder(folder)) {
    fail('This looks like a plugin. Use "clawhub package publish <source>" instead.');
  }

  const registry = await getRegistry(opts, { cache: true });

  const slug = options.slug ?? sanitizeSlug(basename(folder));
  const displayName = options.name ?? titleCase(basename(folder));
  const explicitOwnerHandle = options.owner?.trim().replace(/^@+/, "");
  const explicitSourceOwnerHandle = options.sourceOwner?.trim().replace(/^@+/, "");
  const explicitVersion = options.version;
  const changelog = options.changelog ?? "";
  const tagsValue = options.tags ?? "latest";
  const tags = tagsValue
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const hasExplicitCatalogMetadata =
    options.categories !== undefined || options.topics !== undefined;
  const categories = parseCsv(options.categories);
  const topics = parseCsv(options.topics);

  const forkOfRaw = options.forkOf?.trim();
  const forkOf = forkOfRaw ? parseForkOf(forkOfRaw) : undefined;
  const source = buildPublishSource(options);

  if (!slug) fail("--slug required");
  if (!displayName) fail("--name required");
  if (explicitVersion && !semver.valid(explicitVersion)) fail("--version must be valid semver");

  const spinner = options.json || options.quiet ? null : createCrabLoader(`Preparing ${slug}`);
  try {
    const filesOnDisk = await prepareSkillFilesForPublish(folder);
    if (filesOnDisk.length === 0) fail("No files found");
    if (
      !filesOnDisk.some((file) => {
        const lower = file.relPath.toLowerCase();
        return lower === "skill.md" || lower === "skills.md";
      })
    ) {
      fail("SKILL.md required");
    }

    const hashed = hashSkillFiles(filesOnDisk);
    const optionalToken = await getOptionalAuthToken();
    let defaultOwnerHandle: string | undefined;
    const getDefaultOwnerHandle = async (token: string) => {
      defaultOwnerHandle ??= await resolveDefaultOwnerHandle(registry, token);
      return defaultOwnerHandle;
    };
    const ownerHandle =
      explicitOwnerHandle ||
      (optionalToken ? await getDefaultOwnerHandle(optionalToken) : undefined);
    const sourceOwnerHandle =
      options.migrateOwner && ownerHandle
        ? explicitSourceOwnerHandle ||
          (optionalToken ? await getDefaultOwnerHandle(optionalToken) : undefined)
        : undefined;
    const resolved = await resolveSkillVersion(
      registry,
      slug,
      hashed.fingerprint,
      ownerHandle,
      optionalToken,
    );
    const latestVersion = resolved.latestVersion?.version ?? null;

    if (!explicitVersion && resolved.match && !hasExplicitCatalogMetadata) {
      const result = buildPublishResult({
        status: "unchanged",
        slug,
        displayName,
        folder,
        version: resolved.match.version,
        latestVersion,
        fileCount: filesOnDisk.length,
        fingerprint: hashed.fingerprint,
      });
      spinner?.succeed(`OK. ${slug}@${result.version} is already published`);
      writePublishJsonIfRequested(options.json, result);
      return result;
    }

    const version = explicitVersion ?? resolveAutomaticVersion(latestVersion);
    if (options.dryRun) {
      const result = buildPublishResult({
        status: "would-publish",
        slug,
        displayName,
        folder,
        version,
        latestVersion,
        fileCount: filesOnDisk.length,
        fingerprint: hashed.fingerprint,
      });
      spinner?.succeed(`Would publish ${slug}@${version}`);
      writePublishJsonIfRequested(options.json, result);
      return result;
    }

    const token = optionalToken ?? (await requireAuthToken());
    const publishOwnerHandle = ownerHandle || (await getDefaultOwnerHandle(token));
    const publishSourceOwnerHandle =
      options.migrateOwner && publishOwnerHandle
        ? sourceOwnerHandle || explicitSourceOwnerHandle || (await getDefaultOwnerHandle(token))
        : undefined;
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        slug,
        displayName,
        ownerHandle: publishOwnerHandle,
        ...(publishSourceOwnerHandle ? { sourceOwnerHandle: publishSourceOwnerHandle } : {}),
        ...(options.migrateOwner ? { migrateOwner: true } : {}),
        version,
        changelog,
        acceptLicenseTerms: true,
        tags,
        ...(options.categories !== undefined ? { categories } : {}),
        ...(options.topics !== undefined ? { topics } : {}),
        ...(source ? { source } : {}),
        ...(forkOf ? { forkOf } : {}),
      }),
    );

    let index = 0;
    for (const file of filesOnDisk) {
      index += 1;
      if (spinner) spinner.text = `Uploading ${file.relPath} (${index}/${filesOnDisk.length})`;
      const blob = new Blob([Buffer.from(file.bytes)], { type: file.contentType ?? "text/plain" });
      form.append("files", blob, file.relPath);
    }

    if (spinner) spinner.text = `Publishing ${slug}@${version}`;
    const result = await apiRequestForm(
      registry,
      { method: "POST", path: ApiRoutes.skills, token, form },
      ApiV1PublishResponseSchema,
    );

    const isPendingPublication = result.publicationStatus === "pending";
    const publishResult = buildPublishResult({
      status: isPendingPublication ? "pending-publication" : "published",
      slug,
      displayName,
      folder,
      version,
      latestVersion,
      fileCount: filesOnDisk.length,
      fingerprint: hashed.fingerprint,
      versionId: result.versionId,
      publicationStatus: result.publicationStatus,
      attemptId: result.attemptId,
    });
    spinner?.succeed(
      isPendingPublication
        ? `OK. Uploaded ${slug}@${version}; security checks are pending before it becomes public (${result.versionId})`
        : `OK. Published ${slug}@${version} (${result.versionId})`,
    );
    writePublishJsonIfRequested(options.json, publishResult);
    return publishResult;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

function parseCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function resolveDefaultOwnerHandle(registry: string, token: string) {
  const whoami = await apiRequest(
    registry,
    { method: "GET", path: ApiRoutes.whoami, token },
    ApiV1WhoamiResponseSchema,
  );
  const handle = whoami.user.handle?.trim().replace(/^@+/, "");
  if (!handle) fail("Unable to resolve your publisher handle. Pass --owner explicitly.");
  return handle;
}

async function resolveSkillVersion(
  registry: string,
  slug: string,
  fingerprint: string,
  ownerHandle?: string,
  token?: string,
) {
  const url = registryUrl(ApiRoutes.resolve, registry);
  url.searchParams.set("slug", slug);
  if (ownerHandle) url.searchParams.set("ownerHandle", ownerHandle);
  url.searchParams.set("hash", fingerprint);
  try {
    return await apiRequest(
      registry,
      { method: "GET", url: url.toString(), token },
      ApiV1SkillResolveResponseSchema,
    );
  } catch (error) {
    if (/skill not found|HTTP 404/i.test(formatError(error))) {
      return { match: null, latestVersion: null };
    }
    throw error;
  }
}

function resolveAutomaticVersion(latestVersion: string | null) {
  if (!latestVersion) return "1.0.0";
  const nextVersion = semver.inc(latestVersion, "patch");
  if (!nextVersion) fail(`Latest ClawHub version is not valid semver: ${latestVersion}`);
  return nextVersion;
}

function buildPublishResult(result: Omit<SkillPublishResult, "ok">): SkillPublishResult {
  return { ok: true, ...result };
}

function writePublishJsonIfRequested(json: boolean | undefined, result: SkillPublishResult) {
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function prepareSkillFilesForPublish(folder: string) {
  return stripGeneratedSkillCards(
    await ensureRootManifestFile(folder, await listTextFiles(folder)),
  );
}

function stripGeneratedSkillCards(files: Awaited<ReturnType<typeof listTextFiles>>) {
  return files.filter((file) => file.relPath.trim().toLowerCase() !== "skill-card.md");
}

async function ensureRootManifestFile(
  folder: string,
  files: Awaited<ReturnType<typeof listTextFiles>>,
) {
  if (
    files.some((file) => {
      const lower = file.relPath.toLowerCase();
      return lower === "skill.md" || lower === "skills.md";
    })
  ) {
    return files;
  }

  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const manifest = entries.find((entry) => {
    const lower = entry.name.toLowerCase();
    return entry.isFile() && (lower === "skill.md" || lower === "skills.md");
  });
  if (!manifest) return files;

  return [
    ...files,
    {
      relPath: manifest.name,
      bytes: new Uint8Array(await readFile(join(folder, manifest.name))),
      contentType: "text/markdown",
    },
  ];
}

async function looksLikePluginFolder(folder: string) {
  const checks = [
    join(folder, "openclaw.plugin.json"),
    join(folder, "package.json"),
    join(folder, ".codex-plugin", "plugin.json"),
    join(folder, ".claude-plugin", "plugin.json"),
    join(folder, ".cursor-plugin", "plugin.json"),
  ];
  const stats = await Promise.all(checks.map((candidate) => stat(candidate).catch(() => null)));
  if (stats[0]?.isFile() || stats[2]?.isFile() || stats[3]?.isFile() || stats[4]?.isFile()) {
    return true;
  }
  if (!stats[1]?.isFile()) {
    return false;
  }
  try {
    const raw = JSON.parse(await readFile(checks[1], "utf8")) as { openclaw?: unknown };
    return Boolean(
      raw && typeof raw === "object" && raw.openclaw && typeof raw.openclaw === "object",
    );
  } catch {
    return false;
  }
}

function parseForkOf(value: string) {
  const trimmed = value.trim();
  const ref = parseOwnerQualifiedSkillRef(trimmed);
  const [slugRaw, versionRaw] = splitForkSlugAndVersion(ref.slugAndVersion);
  const slug = (slugRaw ?? "").trim().toLowerCase();
  if (!slug) fail("--fork-of must be <slug> or <slug@version>");
  const version = (versionRaw ?? "").trim();
  if (version && !semver.valid(version)) fail("--fork-of version must be valid semver");
  return {
    slug,
    ...(ref.ownerHandle ? { ownerHandle: ref.ownerHandle } : {}),
    version: version || undefined,
  };
}

function parseOwnerQualifiedSkillRef(value: string) {
  if (!value.startsWith("@")) return { slugAndVersion: value };
  const slashIndex = value.indexOf("/");
  if (slashIndex < 0) fail("--fork-of must be <slug>, <slug@version>, or @<owner>/<slug@version>");
  const ownerHandle = value.slice(1, slashIndex).trim().replace(/^@+/, "");
  const slugAndVersion = value.slice(slashIndex + 1).trim();
  if (!ownerHandle || !slugAndVersion) {
    fail("--fork-of must be <slug>, <slug@version>, or @<owner>/<slug@version>");
  }
  return { ownerHandle, slugAndVersion };
}

function splitForkSlugAndVersion(value: string) {
  const atIndex = value.lastIndexOf("@");
  if (atIndex <= 0) return [value, ""] as const;
  return [value.slice(0, atIndex), value.slice(atIndex + 1)] as const;
}

function buildPublishSource(options: {
  sourceRepo?: string;
  sourceCommit?: string;
  sourceRef?: string;
  sourcePath?: string;
}) {
  const rawRepo = options.sourceRepo?.trim();
  const commit = options.sourceCommit?.trim();
  const ref = options.sourceRef?.trim();
  const path = normalizeSourcePath(options.sourcePath);
  if (!rawRepo && !commit && !ref && !options.sourcePath?.trim()) return undefined;
  if (!rawRepo || !commit) fail("--source-repo and --source-commit must be provided together");
  const repo = normalizeGitHubRepo(rawRepo);
  if (!repo) fail("--source-repo must be a GitHub repo or URL");
  return {
    kind: "github" as const,
    url: `https://github.com/${repo}`,
    repo,
    ref: ref || commit,
    commit,
    path,
    importedAt: Date.now(),
  };
}

function normalizeSourcePath(value: string | undefined) {
  const normalized = (value?.trim() || ".").replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized === ".") return ".";
  return normalized.replace(/\/+$/, "") || ".";
}
