import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import mime from "mime";
import semver from "semver";
import { parseClawPack } from "../../clawpack.js";
import { apiRequest, apiRequestForm, fetchBinary, fetchText, registryUrl } from "../../http.js";
import {
  ApiRoutes,
  ApiV1DeleteResponseSchema,
  ApiV1PackageArtifactBackfillResponseSchema,
  ApiV1PackageArtifactResponseSchema,
  ApiV1PackageAppealResponseSchema,
  ApiV1PackageAppealListResponseSchema,
  ApiV1PackageAppealResolveResponseSchema,
  ApiV1PackageListResponseSchema,
  ApiV1PackageModerationStatusResponseSchema,
  ApiV1PackageModerationQueueResponseSchema,
  ApiV1PackageOfficialMigrationListResponseSchema,
  ApiV1PackageOfficialMigrationResponseSchema,
  ApiV1PackagePublishResponseSchema,
  ApiV1PackageReadinessResponseSchema,
  ApiV1PackageReleaseModerationResponseSchema,
  ApiV1PackageReportListResponseSchema,
  ApiV1PackageReportResponseSchema,
  ApiV1PackageReportTriageResponseSchema,
  ApiV1PackageResponseSchema,
  ApiV1PackageSearchResponseSchema,
  ApiV1PackageTrustedPublisherResponseSchema,
  ApiV1PackageVersionListResponseSchema,
  ApiV1PackageVersionResponseSchema,
  ApiV1PublishTokenMintResponseSchema,
  normalizeOpenClawExternalPluginCompatibility,
  type PackageArtifactSummary,
  type PackageAppealListStatus,
  type PackageAppealStatus,
  type PackageCapabilitySummary,
  type PackageCompatibility,
  type PackageFamily,
  type PackageModerationQueueStatus,
  type PackageOfficialMigrationListPhase,
  type PackageOfficialMigrationPhase,
  type PackageReportListStatus,
  type PackageReportStatus,
  type PackageReleaseModerationState,
  type PackageTrustedPublisher,
  type PackageVerificationSummary,
  validateOpenClawExternalCodePluginPackageContents,
  validateOpenClawExternalCodePluginPackageJson,
} from "../../schema/index.js";
import { getOptionalAuthToken, requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import { titleCase } from "../slug.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from "../ui.js";
import {
  fetchGitHubSource,
  normalizeGitHubRepo,
  resolveLocalGitInfo,
  resolveSourceInput,
} from "./github.js";

const DOT_DIR = ".clawhub";
const LEGACY_DOT_DIR = ".clawdhub";
const DOT_IGNORE = ".clawhubignore";
const LEGACY_DOT_IGNORE = ".clawdhubignore";
const MAX_CLAWPACK_BYTES = 120 * 1024 * 1024;

type PackageInspectOptions = {
  version?: string;
  tag?: string;
  versions?: boolean;
  limit?: number;
  files?: boolean;
  file?: string;
  json?: boolean;
};

type PackageExploreOptions = {
  family?: PackageFamily;
  official?: boolean;
  executesCode?: boolean;
  target?: string;
  os?: string;
  arch?: string;
  libc?: string;
  requiresBrowser?: boolean;
  requiresDesktop?: boolean;
  requiresNativeDeps?: boolean;
  requiresExternalService?: boolean;
  externalService?: string;
  binary?: string;
  osPermission?: string;
  artifactKind?: "legacy-zip" | "npm-pack";
  npmMirror?: boolean;
  limit?: number;
  json?: boolean;
};

type PackagePublishOptions = {
  family?: "code-plugin" | "bundle-plugin";
  name?: string;
  displayName?: string;
  owner?: string;
  version?: string;
  changelog?: string;
  manualOverrideReason?: string;
  tags?: string;
  bundleFormat?: string;
  hostTargets?: string;
  sourceRepo?: string;
  sourceCommit?: string;
  sourceRef?: string;
  sourcePath?: string;
  dryRun?: boolean;
  json?: boolean;
};

type PackagePackOptions = {
  packDestination?: string;
  json?: boolean;
};

type PackageDownloadOptions = {
  version?: string;
  tag?: string;
  output?: string;
  force?: boolean;
  json?: boolean;
};

type PackageVerifyOptions = {
  packageName?: string;
  version?: string;
  tag?: string;
  sha256?: string;
  npmIntegrity?: string;
  npmShasum?: string;
  json?: boolean;
};

type PackageModerateOptions = {
  version?: string;
  state?: PackageReleaseModerationState;
  reason?: string;
  json?: boolean;
};

type PackageReportOptions = {
  version?: string;
  reason?: string;
  json?: boolean;
};

type PackageAppealOptions = {
  version?: string;
  message?: string;
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
  json?: boolean;
};

type PackageModerationStatusOptions = {
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

type PackageReadinessOptions = {
  json?: boolean;
};

type PackageMigrationStatusOptions = PackageReadinessOptions;

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
  phase?: PackageOfficialMigrationPhase;
  blockers?: string;
  hostTargetsComplete?: boolean;
  scanClean?: boolean;
  moderationApproved?: boolean;
  runtimeBundlesReady?: boolean;
  notes?: string;
  json?: boolean;
};

type PackageTrustedPublisherGetOptions = {
  json?: boolean;
};

type PackageTrustedPublisherSetOptions = {
  repository: string;
  workflowFilename: string;
  environment?: string;
  json?: boolean;
};

type PackageTrustedPublisherDeleteOptions = {
  json?: boolean;
};

type PackageDeleteOptions = {
  yes?: boolean;
  json?: boolean;
};

type PackageFile = {
  relPath: string;
  bytes: Uint8Array;
  contentType?: string;
};

type InferredPublishSource = {
  repo?: string;
  commit?: string;
  ref?: string;
  path?: string;
  url?: string;
};

type PackagePublishSource = ReturnType<typeof buildSource>;

type PackagePublishPayload = {
  name: string;
  displayName: string;
  ownerHandle?: string;
  family: "code-plugin" | "bundle-plugin";
  version: string;
  changelog: string;
  manualOverrideReason?: string;
  tags: string[];
  source?: NonNullable<PackagePublishSource>;
  bundle?: {
    format?: string;
    hostTargets: string[];
  };
};

type PackagePublishPlan = {
  folder: string;
  cleanup?: () => Promise<void>;
  filesOnDisk: PackageFile[];
  clawpackOnDisk?: PackageFile;
  packageJson?: unknown;
  payload: PackagePublishPayload;
  compatibility?: PackageCompatibility;
  sourceLabel: string;
  output: {
    source: string;
    name: string;
    displayName: string;
    family: "code-plugin" | "bundle-plugin";
    version: string;
    commit?: string;
    files: number;
    totalBytes: number;
  };
};

type PackedClawPack = {
  path: string;
  file: PackageFile;
  parsed: ReturnType<typeof parseClawPack>;
  identity: ArtifactIdentity;
};

function appendPackageExploreFilters(url: URL, options: PackageExploreOptions) {
  if (options.target) url.searchParams.set("target", options.target);
  if (options.os) url.searchParams.set("os", options.os);
  if (options.arch) url.searchParams.set("arch", options.arch);
  if (options.libc) url.searchParams.set("libc", options.libc);
  if (options.requiresBrowser) url.searchParams.set("requiresBrowser", "true");
  if (options.requiresDesktop) url.searchParams.set("requiresDesktop", "true");
  if (options.requiresNativeDeps) url.searchParams.set("requiresNativeDeps", "true");
  if (options.requiresExternalService) url.searchParams.set("requiresExternalService", "true");
  if (options.externalService) url.searchParams.set("externalService", options.externalService);
  if (options.binary) url.searchParams.set("binary", options.binary);
  if (options.osPermission) url.searchParams.set("osPermission", options.osPermission);
  if (options.artifactKind) url.searchParams.set("artifactKind", options.artifactKind);
  if (options.npmMirror) url.searchParams.set("npmMirror", "true");
}

type PrintableFile = {
  path: string;
  size: number | null;
  sha256: string | null;
  contentType: string | null;
};

type PackageResponse = Awaited<ReturnType<typeof apiRequestPackageDetail>>;
type PackageVersionResponse = Awaited<ReturnType<typeof apiRequestPackageVersion>>;
type PackageArtifactResponse = Awaited<ReturnType<typeof apiRequestPackageArtifact>>;
type ArtifactIdentity = {
  sha256: string;
  npmIntegrity: string;
  npmShasum: string;
  byteLength: number;
};

export async function cmdExplorePackages(
  opts: GlobalOpts,
  query: string,
  options: PackageExploreOptions = {},
) {
  const trimmedQuery = query.trim();
  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(trimmedQuery ? "Searching packages" : "Listing packages");
  try {
    const limit = clampLimit(options.limit ?? 25, 100);
    if (trimmedQuery) {
      const url = registryUrl(`${ApiRoutes.packages}/search`, registry);
      url.searchParams.set("q", trimmedQuery);
      url.searchParams.set("limit", String(limit));
      if (options.family) url.searchParams.set("family", options.family);
      if (options.official) url.searchParams.set("isOfficial", "true");
      if (typeof options.executesCode === "boolean") {
        url.searchParams.set("executesCode", String(options.executesCode));
      }
      appendPackageExploreFilters(url, options);
      const result = await apiRequest(
        registry,
        { method: "GET", url: url.toString(), token },
        ApiV1PackageSearchResponseSchema,
      );
      spinner.stop();
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.results.length === 0) {
        console.log("No packages found.");
        return;
      }
      for (const entry of result.results) {
        console.log(formatPackageLine(entry.package));
      }
      return;
    }

    const route =
      options.family === "code-plugin"
        ? ApiRoutes.codePlugins
        : options.family === "bundle-plugin"
          ? ApiRoutes.bundlePlugins
          : ApiRoutes.packages;
    const url = registryUrl(route, registry);
    url.searchParams.set("limit", String(limit));
    if (options.family === "skill") url.searchParams.set("family", "skill");
    if (options.official) url.searchParams.set("isOfficial", "true");
    if (typeof options.executesCode === "boolean") {
      url.searchParams.set("executesCode", String(options.executesCode));
    }
    appendPackageExploreFilters(url, options);
    const result = await apiRequest(
      registry,
      { method: "GET", url: url.toString(), token },
      ApiV1PackageListResponseSchema,
    );
    spinner.stop();
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.items.length === 0) {
      console.log("No packages found.");
      return;
    }
    for (const item of result.items) {
      console.log(formatPackageLine(item));
    }
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdInspectPackage(
  opts: GlobalOpts,
  packageName: string,
  options: PackageInspectOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  if (options.version && options.tag) fail("Use either --version or --tag");

  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Fetching package");
  try {
    const detail = await apiRequestPackageDetail(registry, trimmed, token);
    if (!detail.package) {
      spinner.fail("Package not found");
      return;
    }

    const tags = normalizeTags(detail.package.tags);
    const latestVersion = detail.package.latestVersion ?? tags.latest ?? null;
    const taggedVersion = options.tag ? (tags[options.tag] ?? null) : null;
    if (options.tag && !taggedVersion) {
      spinner.fail(`Unknown tag "${options.tag}"`);
      return;
    }
    const requestedVersion = options.version ?? taggedVersion ?? null;

    let versionResult: PackageVersionResponse | null = null;
    if (options.files || options.file || options.version || options.tag) {
      const targetVersion = requestedVersion ?? latestVersion;
      if (!targetVersion) fail("Could not resolve latest version");
      spinner.text = `Fetching ${trimmed}@${targetVersion}`;
      versionResult = await apiRequestPackageVersion(registry, trimmed, targetVersion, token);
    }

    let versionsList: Awaited<ReturnType<typeof apiRequestPackageVersions>> | null = null;
    if (options.versions) {
      const limit = clampLimit(options.limit ?? 25, 100);
      spinner.text = `Fetching versions (${limit})`;
      versionsList = await apiRequestPackageVersions(registry, trimmed, limit, token);
    }

    let fileContent: string | null = null;
    if (options.file) {
      const url = registryUrl(
        `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/file`,
        registry,
      );
      url.searchParams.set("path", options.file);
      if (options.version) {
        url.searchParams.set("version", options.version);
      } else if (options.tag) {
        url.searchParams.set("tag", options.tag);
      } else if (latestVersion) {
        url.searchParams.set("version", latestVersion);
      }
      spinner.text = `Fetching ${options.file}`;
      fileContent = await fetchText(registry, { url: url.toString(), token });
    }

    spinner.stop();

    const output = {
      package: detail.package,
      owner: detail.owner,
      version: versionResult?.version ?? null,
      versions: versionsList?.items ?? null,
      file: options.file ? { path: options.file, content: fileContent } : null,
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    const shouldPrintMeta = !options.file || options.files || options.versions || options.version;
    if (shouldPrintMeta) {
      printPackageSummary(detail);
    }

    if (shouldPrintMeta && versionResult?.version) {
      printVersionSummary(versionResult.version);
      printCompatibility(
        versionResult.version.compatibility ?? detail.package.compatibility ?? null,
      );
      printCapabilities(versionResult.version.capabilities ?? detail.package.capabilities ?? null);
      printVerification(versionResult.version.verification ?? detail.package.verification ?? null);
      printArtifact(versionResult.version.artifact ?? detail.package.artifact ?? null);
    } else if (shouldPrintMeta) {
      printCompatibility(detail.package.compatibility ?? null);
      printCapabilities(detail.package.capabilities ?? null);
      printVerification(detail.package.verification ?? null);
      printArtifact(detail.package.artifact ?? null);
    }

    if (versionsList?.items) {
      if (versionsList.items.length === 0) {
        console.log("No versions found.");
      } else {
        console.log("Versions:");
        for (const item of versionsList.items) {
          console.log(`- ${item.version}  ${formatTimestamp(item.createdAt)}`);
        }
      }
    }

    if (versionResult?.version && options.files) {
      const files = normalizeFiles(versionResult.version.files);
      if (files.length === 0) {
        console.log("No files found.");
      } else {
        console.log("Files:");
        for (const file of files) {
          console.log(formatFileLine(file));
        }
      }
    }

    if (options.file && fileContent !== null) {
      if (shouldPrintMeta) console.log(`\n${options.file}:\n`);
      process.stdout.write(fileContent);
      if (!fileContent.endsWith("\n")) process.stdout.write("\n");
    }
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdGetPackageTrustedPublisher(
  opts: GlobalOpts,
  packageName: string,
  options: PackageTrustedPublisherGetOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Fetching trusted publisher");
  try {
    const result = await apiRequestPackageTrustedPublisher(registry, trimmed, token);
    spinner.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (!result.trustedPublisher) {
      console.log("No trusted publisher configured.");
      return;
    }
    printTrustedPublisher(result.trustedPublisher);
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

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

export async function cmdPackPackage(
  opts: GlobalOpts,
  sourceArg: string,
  options: PackagePackOptions = {},
) {
  if (!sourceArg?.trim()) fail("Path required");
  const sourcePath = resolve(opts.workdir, sourceArg);
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat?.isDirectory()) fail("Path must be a package folder");

  const packageJson = await readJsonFile(join(sourcePath, "package.json"));
  if (!packageJson) fail("package.json required");
  const pluginManifest = await readJsonFile(join(sourcePath, "openclaw.plugin.json"));
  if (!pluginManifest) fail("openclaw.plugin.json required");

  const packageName = packageJsonString(packageJson, "name");
  const packageVersion = packageJsonString(packageJson, "version");
  if (!packageName) fail("package.json name required");
  if (!packageVersion) fail("package.json version required");
  if (!semver.valid(packageVersion)) fail("package.json version must be valid semver");

  const validation = validateOpenClawExternalCodePluginPackageJson(packageJson);
  if (validation.issues.length > 0) {
    fail(validation.issues.map((issue) => issue.message).join(" "));
  }

  const packDestination = resolve(opts.workdir, options.packDestination ?? ".");
  await mkdir(packDestination, { recursive: true });

  const spinner = options.json ? null : createSpinner(`Packing ${packageName}@${packageVersion}`);
  try {
    const packed = await createClawPackFromFolder({
      sourcePath,
      packDestination,
      cwd: opts.workdir,
    });
    const contentValidation = validateOpenClawExternalCodePluginPackageContents(
      packed.parsed.packageJson,
      packed.parsed.entries.map((entry) => entry.path),
    );
    if (contentValidation.issues.length > 0) {
      fail(contentValidation.issues.map((issue) => issue.message).join(" "));
    }
    const output = {
      path: packed.path,
      name: packed.parsed.packageName,
      version: packed.parsed.packageVersion,
      size: packed.file.bytes.byteLength,
      files: packed.parsed.entries.length,
      sha256: packed.identity.sha256,
      npmIntegrity: packed.identity.npmIntegrity,
      npmShasum: packed.identity.npmShasum,
    };

    spinner?.succeed(
      `Packed ${packed.parsed.packageName}@${packed.parsed.packageVersion} -> ${packed.path}`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      console.log(`Path: ${packed.path}`);
      console.log(`Size: ${packed.file.bytes.byteLength} bytes`);
      console.log(`SHA-256: ${packed.identity.sha256}`);
      console.log(`npm integrity: ${packed.identity.npmIntegrity}`);
    }
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

async function createClawPackFromFolder(options: {
  sourcePath: string;
  packDestination: string;
  cwd: string;
}): Promise<PackedClawPack> {
  const result = spawnSync(
    "npm",
    [
      "pack",
      options.sourcePath,
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      options.packDestination,
    ],
    {
      cwd: options.cwd,
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail((result.stderr || result.stdout || "npm pack failed").trim());
  }

  let npmOutput: Array<{ filename?: string }> = [];
  try {
    npmOutput = JSON.parse(result.stdout) as Array<{ filename?: string }>;
  } catch {
    fail("npm pack did not return JSON output");
  }
  const filename = npmOutput[0]?.filename;
  if (!filename) fail("npm pack did not return a tarball filename");

  const packPath = resolve(options.packDestination, filename);
  const bytes = new Uint8Array(await readFile(packPath));
  assertClawPackSize(bytes.byteLength, basename(packPath));
  const parsed = parseClawPack(bytes);
  return {
    path: packPath,
    file: {
      relPath: basename(packPath),
      bytes,
      contentType: "application/octet-stream",
    },
    parsed,
    identity: computeArtifactIdentity(bytes),
  };
}

export async function cmdPublishPackage(
  opts: GlobalOpts,
  sourceArg: string,
  options: PackagePublishOptions = {},
) {
  if (!sourceArg?.trim()) fail("Path required");

  let plan: PackagePublishPlan | undefined;
  try {
    plan = await preparePackagePublishPlan(opts, sourceArg, options);

    if (options.dryRun) {
      if (options.json) {
        process.stdout.write(`${JSON.stringify(plan.output, null, 2)}\n`);
      } else {
        printPackageDryRun({
          source: plan.sourceLabel,
          family: plan.payload.family,
          name: plan.payload.name,
          displayName: plan.payload.displayName,
          version: plan.payload.version,
          commit: plan.payload.source?.commit,
          compatibility: plan.compatibility,
          tags: plan.payload.tags,
          files: plan.filesOnDisk,
        });
      }
      return;
    }

    if (plan.payload.family === "code-plugin") {
      const validation = validateOpenClawExternalCodePluginPackageContents(
        plan.packageJson,
        plan.filesOnDisk.map((file) => file.relPath),
      );
      if (validation.issues.length > 0) {
        fail(validation.issues.map((issue) => issue.message).join(" "));
      }
    }

    const registry = await getRegistry(opts, { cache: true });
    const spinner = options.json
      ? null
      : createSpinner(`Preparing ${plan.payload.name}@${plan.payload.version}`);
    try {
      const publishToken = await resolvePackagePublishToken({
        registry,
        packageName: plan.payload.name,
        version: plan.payload.version,
        manualOverrideReason: plan.payload.manualOverrideReason,
        spinner,
      });
      const form = new FormData();
      form.set("payload", JSON.stringify(plan.payload));

      if (plan.clawpackOnDisk) {
        if (spinner) spinner.text = `Uploading ${plan.clawpackOnDisk.relPath}`;
        const blob = new Blob([Buffer.from(plan.clawpackOnDisk.bytes)], {
          type: "application/octet-stream",
        });
        form.append("clawpack", blob, plan.clawpackOnDisk.relPath);
      } else {
        let index = 0;
        for (const file of plan.filesOnDisk) {
          index += 1;
          if (spinner) {
            spinner.text = `Uploading ${file.relPath} (${index}/${plan.filesOnDisk.length})`;
          }
          const blob = new Blob([Buffer.from(file.bytes)], {
            type: file.contentType ?? "application/octet-stream",
          });
          form.append("files", blob, file.relPath);
        }
      }

      if (spinner) spinner.text = `Publishing ${plan.payload.name}@${plan.payload.version}`;
      const result = await apiRequestForm(
        registry,
        { method: "POST", path: ApiRoutes.packages, token: publishToken, form },
        ApiV1PackagePublishResponseSchema,
      );

      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({ ...plan.output, releaseId: result.releaseId }, null, 2)}\n`,
        );
      } else {
        spinner?.succeed(
          `OK. Published ${plan.payload.name}@${plan.payload.version} (${result.releaseId})`,
        );
      }
    } catch (error) {
      spinner?.fail(formatError(error));
      throw error;
    }
  } finally {
    await plan?.cleanup?.();
  }
}

export async function cmdDownloadPackage(
  opts: GlobalOpts,
  packageName: string,
  options: PackageDownloadOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  if (options.version && options.tag) fail("Use either --version or --tag");

  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner("Resolving package artifact");
  try {
    const targetVersion = await resolvePackageVersion(registry, trimmed, {
      token,
      version: options.version,
      tag: options.tag,
    });
    spinnerText(spinner, `Resolving ${trimmed}@${targetVersion}`);
    const artifactResult = await apiRequestPackageArtifact(registry, trimmed, targetVersion, token);
    spinnerText(spinner, `Downloading ${trimmed}@${targetVersion}`);
    const bytes = await fetchBinary(registry, {
      url: artifactResult.artifact.downloadUrl,
      token,
    });
    const identity = computeArtifactIdentity(bytes);
    validateDownloadedArtifact(trimmed, artifactResult, bytes, identity);

    const filename = defaultArtifactFilename(trimmed, targetVersion, artifactResult.artifact);
    const outputPath = await resolveArtifactOutputPath(opts, options.output, filename);
    await assertOutputWritable(outputPath, Boolean(options.force));
    await writeFile(outputPath, bytes);
    spinner?.stop();

    const output = {
      package: artifactResult.package.name,
      version: targetVersion,
      artifact: artifactResult.artifact,
      path: outputPath,
      bytes: bytes.byteLength,
      sha256: identity.sha256,
      npmIntegrity: artifactResult.artifact.kind === "npm-pack" ? identity.npmIntegrity : undefined,
      npmShasum: artifactResult.artifact.kind === "npm-pack" ? identity.npmShasum : undefined,
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return;
    }
    console.log(`Downloaded ${artifactResult.package.name}@${targetVersion} -> ${outputPath}`);
    console.log(`Artifact: ${artifactResult.artifact.kind}`);
    console.log(`SHA-256: ${identity.sha256}`);
    if (artifactResult.artifact.kind === "npm-pack") {
      console.log(`npm integrity: ${identity.npmIntegrity}`);
      console.log(`npm shasum: ${identity.npmShasum}`);
    }
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdVerifyPackage(
  opts: GlobalOpts,
  filePath: string,
  options: PackageVerifyOptions = {},
) {
  const targetFile = resolve(opts.workdir, filePath);
  if (options.version && options.tag) fail("Use either --version or --tag");
  if ((options.version || options.tag) && !options.packageName?.trim()) {
    fail("--package is required with --version or --tag");
  }

  const spinner = options.json ? null : createSpinner("Reading artifact");
  try {
    const bytes = new Uint8Array(await readFile(targetFile));
    const identity = computeArtifactIdentity(bytes);
    let artifactResult: PackageArtifactResponse | null = null;

    if (options.packageName?.trim()) {
      const packageName = normalizePackageNameOrFail(options.packageName);
      const token = await getOptionalAuthToken();
      const registry = await getRegistry(opts, { cache: true });
      spinnerText(spinner, `Resolving ${packageName}`);
      const targetVersion = await resolvePackageVersion(registry, packageName, {
        token,
        version: options.version,
        tag: options.tag,
      });
      artifactResult = await apiRequestPackageArtifact(registry, packageName, targetVersion, token);
      validateDownloadedArtifact(packageName, artifactResult, bytes, identity);
    }

    const expectedSha256 =
      options.sha256?.trim() ||
      (artifactResult?.artifact.kind === "npm-pack" ? artifactResult.artifact.sha256 : undefined);
    const expectedNpmIntegrity =
      options.npmIntegrity?.trim() || artifactResult?.artifact.npmIntegrity;
    const expectedNpmShasum = options.npmShasum?.trim() || artifactResult?.artifact.npmShasum;
    assertDigestMatch("SHA-256", expectedSha256, identity.sha256);
    assertDigestMatch("npm integrity", expectedNpmIntegrity, identity.npmIntegrity);
    assertDigestMatch("npm shasum", expectedNpmShasum, identity.npmShasum);

    spinner?.stop();
    const output = {
      path: targetFile,
      bytes: bytes.byteLength,
      sha256: identity.sha256,
      npmIntegrity: identity.npmIntegrity,
      npmShasum: identity.npmShasum,
      expected: {
        sha256: expectedSha256,
        npmIntegrity: expectedNpmIntegrity,
        npmShasum: expectedNpmShasum,
        package: artifactResult?.package.name,
        version: artifactResult?.version,
        artifactKind: artifactResult?.artifact.kind,
      },
      verified: Boolean(expectedSha256 || expectedNpmIntegrity || expectedNpmShasum),
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return;
    }
    console.log(`Path: ${targetFile}`);
    console.log(`SHA-256: ${identity.sha256}`);
    console.log(`npm integrity: ${identity.npmIntegrity}`);
    console.log(`npm shasum: ${identity.npmShasum}`);
    if (output.verified) {
      console.log("OK. Artifact verification passed.");
    } else {
      console.log("Computed artifact digests. Pass --package or expected digests to verify.");
    }
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdDeletePackage(
  opts: GlobalOpts,
  nameArg: string,
  options: PackageDeleteOptions = {},
  inputAllowed = true,
) {
  const name = nameArg.trim();
  if (!name) fail("Package name required");

  if (!options.yes) {
    if (!isInteractive() || inputAllowed === false) fail("Pass --yes (no input)");
    const ok = await promptConfirm(`Delete ${name}? (soft delete package and all releases)`);
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Deleting ${name}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "DELETE",
        path: `${ApiRoutes.packages}/${encodeURIComponent(name)}`,
        token,
      },
      ApiV1DeleteResponseSchema,
    );
    spinner.succeed(`OK. Deleted ${name}`);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
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

export async function cmdReportPackage(
  opts: GlobalOpts,
  packageName: string,
  options: PackageReportOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const reason = options.reason?.trim();
  const version = options.version?.trim();
  if (!reason) fail("--reason required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner(`Reporting ${trimmed}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/report`,
        token,
        body: {
          reason,
          ...(version ? { version } : {}),
        },
      },
      ApiV1PackageReportResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (result.alreadyReported) {
      console.log(`Already reported ${trimmed}.`);
      return;
    }
    const versionSuffix = version ? `@${version}` : "";
    console.log(`OK. Reported ${trimmed}${versionSuffix} for moderator review.`);
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdAppealPackage(
  opts: GlobalOpts,
  packageName: string,
  options: PackageAppealOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const version = options.version?.trim();
  const message = options.message?.trim();
  if (!version) fail("--version required");
  if (!message) fail("--message required");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createSpinner(`Submitting appeal for ${trimmed}@${version}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/appeal`,
        token,
        body: { version, message },
      },
      ApiV1PackageAppealResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (result.alreadyOpen) {
      console.log(`Already has an open appeal: ${result.appealId}`);
      return;
    }
    console.log(`OK. Appeal submitted: ${result.appealId}`);
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
  const status = options.status?.trim();
  if (!status || !["open", "accepted", "rejected"].includes(status)) {
    fail("--status must be open, accepted, or rejected");
  }
  const note = options.note?.trim();
  if (status !== "open" && !note) fail("--note required unless reopening");

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
        },
      },
      ApiV1PackageAppealResolveResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    console.log(`OK. Appeal ${trimmed} set to ${result.status}.`);
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
  if (!["open", "triaged", "dismissed", "all"].includes(status)) {
    fail("--status must be open, triaged, dismissed, or all");
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
      if (item.triageNote) console.log(`  triage: ${item.triageNote}`);
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
  const status = options.status?.trim();
  if (!status || !["open", "triaged", "dismissed"].includes(status)) {
    fail("--status must be open, triaged, or dismissed");
  }
  const note = options.note?.trim();
  if (status !== "open" && !note) fail("--note required unless reopening");

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
        },
      },
      ApiV1PackageReportTriageResponseSchema,
    );
    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    console.log(`OK. Report ${trimmed} set to ${result.status}.`);
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdPackageModerationStatus(
  opts: GlobalOpts,
  packageName: string,
  options: PackageModerationStatusOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/moderation`,
      token,
    },
    ApiV1PackageModerationStatusResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`${result.package.name} moderation`);
  console.log(`  package scan: ${result.package.scanStatus ?? "unknown"}`);
  console.log(`  open reports: ${result.package.reportCount}`);
  if (!result.latestRelease) {
    console.log("  latest release: none");
    return;
  }
  const state = result.latestRelease.moderationState ?? "none";
  console.log(`  latest: ${result.latestRelease.version}`);
  console.log(`  release scan: ${result.latestRelease.scanStatus}`);
  console.log(`  manual state: ${state}`);
  console.log(`  blocked: ${result.latestRelease.blockedFromDownload ? "yes" : "no"}`);
  if (result.latestRelease.reasons.length > 0) {
    console.log(`  reasons: ${result.latestRelease.reasons.join(", ")}`);
  }
  if (result.latestRelease.moderationReason) {
    console.log(`  note: ${result.latestRelease.moderationReason}`);
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

export async function cmdPackageReadiness(
  opts: GlobalOpts,
  packageName: string,
  options: PackageReadinessOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/readiness`,
      token,
    },
    ApiV1PackageReadinessResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`${result.package.name} readiness: ${result.ready ? "ready" : "blocked"}`);
  for (const check of result.checks) {
    console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  }
  if (result.blockers.length > 0) {
    console.log(`Blockers: ${result.blockers.join(", ")}`);
  }
}

export async function cmdPackageMigrationStatus(
  opts: GlobalOpts,
  packageName: string,
  options: PackageMigrationStatusOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const token = await getOptionalAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/readiness`,
      token,
    },
    ApiV1PackageReadinessResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const version = result.package.latestVersion ?? "no release";
  console.log(`${result.package.name} migration: ${result.ready ? "ready" : "blocked"}`);
  console.log(`Version: ${version}`);
  console.log(`Official: ${result.package.isOfficial ? "yes" : "no"}`);
  for (const check of result.checks) {
    console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  }
  if (result.blockers.length > 0) {
    console.log(`Blockers: ${result.blockers.join(", ")}`);
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

async function apiRequestPackageDetail(registry: string, name: string, token?: string) {
  return await apiRequest(
    registry,
    { method: "GET", path: `${ApiRoutes.packages}/${encodeURIComponent(name)}`, token },
    ApiV1PackageResponseSchema,
  );
}

async function apiRequestPackageArtifact(
  registry: string,
  name: string,
  version: string,
  token?: string,
) {
  return await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/artifact`,
      token,
    },
    ApiV1PackageArtifactResponseSchema,
  );
}

async function apiRequestPackageTrustedPublisher(registry: string, name: string, token?: string) {
  return await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/${encodeURIComponent(name)}/trusted-publisher`,
      token,
    },
    ApiV1PackageTrustedPublisherResponseSchema,
  );
}

async function apiRequestPackageVersion(
  registry: string,
  name: string,
  version: string,
  token?: string,
) {
  return await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
      token,
    },
    ApiV1PackageVersionResponseSchema,
  );
}

async function apiRequestPackageVersions(
  registry: string,
  name: string,
  limit: number,
  token?: string,
) {
  const url = registryUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}/versions`, registry);
  url.searchParams.set("limit", String(limit));
  return await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1PackageVersionListResponseSchema,
  );
}

async function resolvePackageVersion(
  registry: string,
  name: string,
  args: { token?: string; version?: string; tag?: string },
) {
  if (args.version?.trim()) return args.version.trim();
  const detail = await apiRequestPackageDetail(registry, name, args.token);
  if (!detail.package) fail("Package not found");
  const tags = normalizeTags(detail.package.tags);
  if (args.tag?.trim()) {
    const tagged = tags[args.tag.trim()];
    if (!tagged) fail(`Unknown tag "${args.tag.trim()}"`);
    return tagged;
  }
  const latest = detail.package.latestVersion ?? tags.latest;
  if (!latest) fail("Could not resolve latest version");
  return latest;
}

function normalizePackageNameOrFail(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) fail("Package name required");
  return trimmed;
}

function spinnerText(spinner: ReturnType<typeof createSpinner> | null, text: string) {
  if (spinner) spinner.text = text;
}

function clampLimit(value: number, max: number) {
  if (!Number.isFinite(value)) return Math.min(25, max);
  return Math.max(1, Math.min(Math.round(value), max));
}

function formatPackageLine(item: {
  name: string;
  displayName: string;
  family: PackageFamily;
  latestVersion?: string | null;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  verificationTier?: string | null;
  summary?: string | null;
}) {
  const flags = [
    familyLabel(item.family),
    item.isOfficial ? "official" : item.channel,
    item.verificationTier ?? null,
  ].filter(Boolean);
  const version = item.latestVersion ? ` v${item.latestVersion}` : "";
  const summary = item.summary ? `  ${item.summary}` : "";
  return `${item.name}${version}  ${item.displayName}  [${flags.join(", ")}]${summary}`;
}

function computeArtifactIdentity(bytes: Uint8Array): ArtifactIdentity {
  return {
    sha256: digestHex(bytes, "sha256"),
    npmIntegrity: `sha512-${digestBase64(bytes, "sha512")}`,
    npmShasum: digestHex(bytes, "sha1"),
    byteLength: bytes.byteLength,
  };
}

function digestHex(bytes: Uint8Array, algorithm: "sha1" | "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function digestBase64(bytes: Uint8Array, algorithm: "sha512") {
  return createHash(algorithm).update(bytes).digest("base64");
}

function validateDownloadedArtifact(
  requestedPackageName: string,
  artifactResult: PackageArtifactResponse,
  bytes: Uint8Array,
  identity: ArtifactIdentity,
) {
  const artifact = artifactResult.artifact;
  if (artifact.kind === "npm-pack") {
    assertDigestMatch("SHA-256", artifact.sha256, identity.sha256);
    if (typeof artifact.size === "number" && artifact.size !== identity.byteLength) {
      fail(`artifact size mismatch: expected ${artifact.size}, got ${identity.byteLength}`);
    }
    assertDigestMatch("npm integrity", artifact.npmIntegrity, identity.npmIntegrity);
    assertDigestMatch("npm shasum", artifact.npmShasum, identity.npmShasum);
    const parsed = parseClawPack(bytes);
    if (parsed.packageName !== artifactResult.package.name) {
      fail(
        `ClawPack package name mismatch: expected ${artifactResult.package.name}, got ${parsed.packageName}`,
      );
    }
    if (parsed.packageVersion !== artifactResult.version) {
      fail(
        `ClawPack package version mismatch: expected ${artifactResult.version}, got ${parsed.packageVersion}`,
      );
    }
    if (requestedPackageName !== artifactResult.package.name) {
      fail(
        `Resolved package mismatch: expected ${requestedPackageName}, got ${artifactResult.package.name}`,
      );
    }
  }
  if (requestedPackageName !== artifactResult.package.name) {
    fail(
      `Resolved package mismatch: expected ${requestedPackageName}, got ${artifactResult.package.name}`,
    );
  }
}

function assertDigestMatch(label: string, expected: string | null | undefined, actual: string) {
  if (!expected) return;
  if (expected !== actual) {
    fail(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function defaultArtifactFilename(
  name: string,
  version: string,
  artifact: PackageArtifactResponse["artifact"],
) {
  if (artifact.kind === "npm-pack" && artifact.npmTarballName) return artifact.npmTarballName;
  const safeName = name
    .replace(/^@/, "")
    .replaceAll("/", "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${safeName}-${version}.${artifact.kind === "npm-pack" ? "tgz" : "zip"}`;
}

async function resolveArtifactOutputPath(
  opts: GlobalOpts,
  output: string | undefined,
  filename: string,
) {
  if (!output?.trim()) return resolve(opts.workdir, filename);
  const resolved = resolve(opts.workdir, output.trim());
  const outputStat = await stat(resolved).catch(() => null);
  if (outputStat?.isDirectory()) return join(resolved, filename);
  return resolved;
}

async function assertOutputWritable(path: string, force: boolean) {
  const existing = await stat(path).catch(() => null);
  if (existing && !force) fail(`Refusing to overwrite ${path}. Use --force.`);
  await mkdir(dirname(path), { recursive: true });
}

function printPackageSummary(detail: PackageResponse) {
  if (!detail.package) return;
  const pkg = detail.package;
  console.log(`${pkg.name}  ${pkg.displayName}`);
  console.log(`Family: ${familyLabel(pkg.family)}`);
  console.log(`Channel: ${pkg.channel}${pkg.isOfficial ? " (official)" : ""}`);
  if (pkg.summary) console.log(`Summary: ${pkg.summary}`);
  if (pkg.runtimeId) console.log(`Runtime ID: ${pkg.runtimeId}`);
  if (detail.owner?.handle || detail.owner?.displayName) {
    console.log(`Owner: ${detail.owner.handle ?? detail.owner.displayName}`);
  }
  console.log(`Created: ${formatTimestamp(pkg.createdAt)}`);
  console.log(`Updated: ${formatTimestamp(pkg.updatedAt)}`);
  if (pkg.latestVersion) console.log(`Latest: ${pkg.latestVersion}`);
  printArtifact(pkg.artifact ?? null);
  const tags = Object.entries(normalizeTags(pkg.tags));
  if (tags.length > 0) {
    console.log(`Tags: ${tags.map(([tag, version]) => `${tag}=${version}`).join(", ")}`);
  }
}

function printVersionSummary(version: NonNullable<PackageVersionResponse["version"]>) {
  console.log(`Selected: ${version.version}`);
  console.log(`Selected At: ${formatTimestamp(version.createdAt)}`);
  if (version.changelog.trim()) console.log(`Changelog: ${truncate(version.changelog, 120)}`);
}

function printTrustedPublisher(trustedPublisher: PackageTrustedPublisher) {
  console.log(`Provider: ${trustedPublisher.provider}`);
  console.log(`Repository: ${trustedPublisher.repository}`);
  console.log(`Workflow: ${trustedPublisher.workflowFilename}`);
  if (trustedPublisher.environment) {
    console.log(`Environment: ${trustedPublisher.environment}`);
  }
}

function printCompatibility(compatibility: PackageCompatibility | null | undefined) {
  if (!compatibility) return;
  const entries = formatCompatibilityEntries(compatibility);
  if (entries.length > 0) console.log(`Compatibility: ${entries.join(", ")}`);
}

function formatCompatibilityEntries(compatibility: PackageCompatibility) {
  return [
    compatibility.pluginApiRange ? `pluginApi=${compatibility.pluginApiRange}` : null,
    compatibility.builtWithOpenClawVersion
      ? `builtWith=${compatibility.builtWithOpenClawVersion}`
      : null,
    compatibility.pluginSdkVersion ? `sdk=${compatibility.pluginSdkVersion}` : null,
    compatibility.minGatewayVersion ? `minGateway=${compatibility.minGatewayVersion}` : null,
  ].filter(Boolean);
}

function printCapabilities(capabilities: PackageCapabilitySummary | null | undefined) {
  if (!capabilities) return;
  console.log(`Executes code: ${capabilities.executesCode ? "yes" : "no"}`);
  if (capabilities.pluginKind) console.log(`Plugin kind: ${capabilities.pluginKind}`);
  if (capabilities.bundleFormat) console.log(`Bundle format: ${capabilities.bundleFormat}`);
  if (capabilities.hostTargets?.length) {
    console.log(`Host targets: ${capabilities.hostTargets.join(", ")}`);
  }
  if (capabilities.channels?.length) console.log(`Channels: ${capabilities.channels.join(", ")}`);
  if (capabilities.providers?.length) {
    console.log(`Providers: ${capabilities.providers.join(", ")}`);
  }
  if (capabilities.toolNames?.length) console.log(`Tools: ${capabilities.toolNames.join(", ")}`);
  if (capabilities.commandNames?.length) {
    console.log(`Commands: ${capabilities.commandNames.join(", ")}`);
  }
  if (capabilities.serviceNames?.length) {
    console.log(`Services: ${capabilities.serviceNames.join(", ")}`);
  }
}

function printVerification(verification: PackageVerificationSummary | null | undefined) {
  if (!verification) return;
  console.log(`Verification: ${verification.tier} / ${verification.scope}`);
  if (verification.summary) console.log(`Verification Summary: ${verification.summary}`);
  if (verification.sourceRepo) console.log(`Source Repo: ${verification.sourceRepo}`);
  if (verification.sourceCommit) console.log(`Source Commit: ${verification.sourceCommit}`);
  if (verification.sourceTag) console.log(`Source Ref: ${verification.sourceTag}`);
  if (verification.scanStatus) console.log(`Scan: ${verification.scanStatus}`);
}

function printArtifact(artifact: PackageArtifactSummary | null | undefined) {
  if (!artifact || typeof artifact !== "object") return;
  const summary = artifact as {
    kind?: string;
    sha256?: string;
    size?: number;
    format?: string;
    npmIntegrity?: string;
    npmShasum?: string;
    npmTarballName?: string;
  };
  if (!summary.kind) return;
  console.log(`Artifact: ${summary.kind}${summary.format ? ` (${summary.format})` : ""}`);
  if (summary.sha256) console.log(`Artifact SHA-256: ${summary.sha256}`);
  if (typeof summary.size === "number") {
    console.log(`Artifact Size: ${formatByteCount(summary.size)}`);
  }
  if (summary.npmIntegrity) console.log(`npm integrity: ${summary.npmIntegrity}`);
  if (summary.npmShasum) console.log(`npm shasum: ${summary.npmShasum}`);
  if (summary.npmTarballName) console.log(`npm tarball: ${summary.npmTarballName}`);
}

function normalizeTags(tags: unknown): Record<string, string> {
  if (!tags || typeof tags !== "object") return {};
  const resolved: Record<string, string> = {};
  for (const [tag, version] of Object.entries(tags as Record<string, unknown>)) {
    if (typeof version === "string") resolved[tag] = version;
  }
  return resolved;
}

function normalizeFiles(files: unknown): PrintableFile[] {
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => {
      if (!file || typeof file !== "object") return null;
      const entry = file as {
        path?: unknown;
        size?: unknown;
        sha256?: unknown;
        contentType?: unknown;
      };
      if (typeof entry.path !== "string") return null;
      return {
        path: entry.path,
        size: typeof entry.size === "number" ? entry.size : null,
        sha256: typeof entry.sha256 === "string" ? entry.sha256 : null,
        contentType: typeof entry.contentType === "string" ? entry.contentType : null,
      };
    })
    .filter((entry): entry is PrintableFile => Boolean(entry));
}

function formatFileLine(file: PrintableFile) {
  const size = typeof file.size === "number" ? `${file.size}B` : "?";
  const hash = file.sha256 ?? "?";
  return `- ${file.path}  ${size}  ${hash}`;
}

function familyLabel(family: PackageFamily) {
  switch (family) {
    case "code-plugin":
      return "Code Plugin";
    case "bundle-plugin":
      return "Bundle Plugin";
    default:
      return "Skill";
  }
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function formatTimestamp(value: number) {
  return new Date(value).toISOString();
}

async function readJsonFile(path: string) {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function packageJsonString(value: Record<string, unknown> | null, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function assertClawPackSize(size: number, label: string) {
  if (size > MAX_CLAWPACK_BYTES) {
    fail(`ClawPack "${label}" exceeds 120MB limit`);
  }
}

const REAL_BUNDLE_MANIFESTS = [
  { path: ".codex-plugin/plugin.json", format: "codex" },
  { path: ".claude-plugin/plugin.json", format: "claude" },
  { path: ".cursor-plugin/plugin.json", format: "cursor" },
] as const;

function hasRealBundleMarker(fileSet: Set<string>) {
  return (
    REAL_BUNDLE_MANIFESTS.some((marker) => fileSet.has(marker.path)) ||
    Array.from(fileSet).some(
      (path) =>
        path.startsWith("skills/") ||
        path.startsWith("commands/") ||
        path.startsWith("agents/") ||
        path === "hooks/hooks.json" ||
        path === ".mcp.json" ||
        path === ".lsp.json" ||
        path === "settings.json",
    )
  );
}

function detectPackageFamily(
  fileSet: Set<string>,
  explicit?: "code-plugin" | "bundle-plugin",
): "code-plugin" | "bundle-plugin" {
  if (explicit) return explicit;
  if (hasRealBundleMarker(fileSet)) return "bundle-plugin";
  if (fileSet.has("openclaw.plugin.json")) return "code-plugin";
  return fail("Could not detect package family. Use --family.");
}

async function readBundleManifestInfo(
  filesOnDisk: PackageFile[],
  folder: string,
  parsedClawpack: ReturnType<typeof parseClawPack> | undefined,
) {
  for (const marker of REAL_BUNDLE_MANIFESTS) {
    const manifest =
      readJsonEntry(filesOnDisk, marker.path) ??
      (parsedClawpack ? null : await readJsonFile(join(folder, marker.path)));
    if (manifest) return { manifest, format: marker.format };
  }
  return { manifest: null, format: undefined };
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCsv(value: string | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function applyGitHubSourcePath(
  source: Awaited<ReturnType<typeof resolveSourceInput>>,
  sourcePath: string | undefined,
) {
  const explicitPath = sourcePath?.trim();
  if (!explicitPath || source.kind !== "github") return source;
  return { ...source, path: explicitPath };
}

async function preparePackagePublishPlan(
  opts: GlobalOpts,
  sourceArg: string,
  options: PackagePublishOptions,
): Promise<PackagePublishPlan> {
  const resolvedSource = await resolveSourceInput(sourceArg, { workdir: opts.workdir });
  const sourceForFetch = applyGitHubSourcePath(resolvedSource, options.sourcePath);
  let folder = sourceForFetch.kind === "local" ? sourceForFetch.path : "";
  let cleanup: (() => Promise<void>) | undefined;
  let inferredSource: InferredPublishSource | undefined;
  let clawpackOnDisk: PackageFile | undefined;
  let parsedClawpack: ReturnType<typeof parseClawPack> | undefined;
  const addCleanup = (next: () => Promise<void>) => {
    const previous = cleanup;
    cleanup = async () => {
      await next();
      await previous?.();
    };
  };

  if (sourceForFetch.kind === "github") {
    const fetchSpinner = options.json
      ? null
      : createSpinner(`Fetching ${sourceForFetch.owner}/${sourceForFetch.repo}`);
    try {
      const fetched = await fetchGitHubSource(sourceForFetch);
      folder = fetched.dir;
      cleanup = fetched.cleanup;
      inferredSource = fetched.source;
      fetchSpinner?.stop();
    } catch (error) {
      fetchSpinner?.fail(formatError(error));
      throw error;
    }
  } else {
    const folderStat = await stat(folder).catch(() => null);
    if (!folderStat) fail("Path must be a folder or ClawPack .tgz");
    if (folderStat.isFile()) {
      if (!folder.endsWith(".tgz")) fail("ClawPack publish files must end in .tgz");
      const bytes = new Uint8Array(await readFile(folder));
      assertClawPackSize(bytes.byteLength, basename(folder));
      parsedClawpack = parseClawPack(bytes);
      clawpackOnDisk = {
        relPath: basename(folder),
        bytes,
        contentType: "application/octet-stream",
      };
    } else if (!folderStat.isDirectory()) {
      fail("Path must be a folder or ClawPack .tgz");
    }

    const localGitInfo = folderStat.isDirectory() ? resolveLocalGitInfo(folder) : null;
    if (localGitInfo) {
      inferredSource = {
        repo: localGitInfo.repo,
        commit: localGitInfo.commit,
        ref: localGitInfo.ref,
        path: localGitInfo.path,
        ...(localGitInfo.repo ? { url: `https://github.com/${localGitInfo.repo}` } : {}),
      };
    }
  }

  let filesOnDisk = parsedClawpack
    ? parsedClawpack.entries.map((entry) => ({
        relPath: entry.path,
        bytes: entry.bytes,
        contentType: mime.getType(entry.path) ?? "application/octet-stream",
      }))
    : await listPackageFiles(folder);
  if (filesOnDisk.length === 0) fail("No files found");

  const fileSet = new Set(filesOnDisk.map((file) => file.relPath.toLowerCase()));
  const packageJson =
    parsedClawpack?.packageJson ?? (await readJsonFile(join(folder, "package.json")));
  const pluginManifest =
    readJsonEntry(filesOnDisk, "openclaw.plugin.json") ??
    (parsedClawpack ? null : await readJsonFile(join(folder, "openclaw.plugin.json")));
  const bundleManifestInfo = await readBundleManifestInfo(filesOnDisk, folder, parsedClawpack);
  const bundleManifest = bundleManifestInfo.manifest;
  const family = detectPackageFamily(fileSet, options.family);
  const name =
    options.name?.trim() ||
    parsedClawpack?.packageName ||
    packageJsonString(packageJson, "name") ||
    packageJsonString(pluginManifest, "id") ||
    packageJsonString(bundleManifest, "id") ||
    basename(folder).trim().toLowerCase();
  const displayName =
    options.displayName?.trim() ||
    packageJsonString(packageJson, "displayName") ||
    packageJsonString(pluginManifest, "name") ||
    packageJsonString(bundleManifest, "name") ||
    titleCase(basename(folder));
  const ownerHandle = options.owner?.trim().replace(/^@+/, "");
  const version =
    options.version?.trim() ||
    parsedClawpack?.packageVersion ||
    packageJsonString(packageJson, "version");
  const changelog = options.changelog ?? "";
  const tags = parseTags(options.tags ?? "latest");
  const source = buildSource(options, inferredSource);

  if (!name) fail("--name required");
  if (!displayName) fail("--display-name required");
  if (!version) fail("--version required");
  if (!fileSet.has("openclaw.plugin.json")) fail("openclaw.plugin.json required");
  if (family === "code-plugin" && !semver.valid(version)) {
    fail("--version must be valid semver for code plugins");
  }
  if (family === "code-plugin") {
    if (!fileSet.has("package.json")) fail("package.json required");
    if (!source) fail("--source-repo and --source-commit required for code plugins");
    const validation = validateOpenClawExternalCodePluginPackageJson(packageJson);
    if (validation.issues.length > 0) {
      fail(validation.issues.map((issue) => issue.message).join(" "));
    }
  }

  if (family === "code-plugin" && !clawpackOnDisk) {
    const packDestination = await mkdtemp(join(tmpdir(), "clawhub-clawpack-"));
    let packed: PackedClawPack;
    try {
      packed = await createClawPackFromFolder({
        sourcePath: folder,
        packDestination,
        cwd: opts.workdir,
      });
      if (packed.parsed.packageName !== name) {
        fail(`ClawPack package name mismatch: expected ${name}, got ${packed.parsed.packageName}`);
      }
      if (packed.parsed.packageVersion !== version) {
        fail(
          `ClawPack package version mismatch: expected ${version}, got ${packed.parsed.packageVersion}`,
        );
      }
    } catch (error) {
      await rm(packDestination, { recursive: true, force: true });
      throw error;
    }
    addCleanup(async () => {
      await rm(packDestination, { recursive: true, force: true });
    });
    parsedClawpack = packed.parsed;
    clawpackOnDisk = packed.file;
    filesOnDisk = packed.parsed.entries.map((entry) => ({
      relPath: entry.path,
      bytes: entry.bytes,
      contentType: mime.getType(entry.path) ?? "application/octet-stream",
    }));
  }

  const payload: PackagePublishPayload = {
    name,
    displayName,
    ...(ownerHandle ? { ownerHandle } : {}),
    family,
    version,
    changelog,
    ...(options.manualOverrideReason?.trim()
      ? { manualOverrideReason: options.manualOverrideReason.trim() }
      : {}),
    tags,
    ...(source ? { source } : {}),
    ...(family === "bundle-plugin"
      ? {
          bundle: {
            format: options.bundleFormat?.trim() || bundleManifestInfo.format,
            hostTargets: parseCsv(options.hostTargets),
          },
        }
      : {}),
  };
  const sourceLabel = describePublishSource(sourceForFetch, source, folder);

  return {
    folder,
    cleanup,
    filesOnDisk,
    clawpackOnDisk,
    packageJson,
    payload,
    compatibility:
      family === "code-plugin"
        ? normalizeOpenClawExternalPluginCompatibility(packageJson)
        : undefined,
    sourceLabel,
    output: {
      source: sourceLabel,
      name,
      displayName,
      family,
      version,
      ...(source?.commit ? { commit: source.commit } : {}),
      files: filesOnDisk.length,
      totalBytes: clawpackOnDisk
        ? clawpackOnDisk.bytes.byteLength
        : filesOnDisk.reduce((sum, file) => sum + file.bytes.byteLength, 0),
    },
  };
}

function readJsonEntry(files: PackageFile[], path: string) {
  const file = files.find((entry) => entry.relPath.toLowerCase() === path.toLowerCase());
  if (!file) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(file.bytes)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasGitHubActionsOidcEnv(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

async function requestGitHubActionsOidcToken(
  audience: string,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim();
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim();
  if (!requestUrl || !requestToken) {
    throw new Error("GitHub Actions OIDC is not available in this environment.");
  }

  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${requestToken}`,
    },
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub OIDC token request failed (${response.status}): ${responseText || response.statusText}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("GitHub OIDC token request returned invalid JSON.");
  }

  const token = (parsed as { value?: unknown }).value;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("GitHub OIDC token response did not include a token value.");
  }
  return token;
}

async function mintPackagePublishToken(
  registry: string,
  packageName: string,
  version: string,
  githubOidcToken: string,
) {
  const response = await apiRequest(
    registry,
    {
      method: "POST",
      path: ApiRoutes.publishTokenMint,
      body: {
        packageName,
        version,
        githubOidcToken,
      },
    },
    ApiV1PublishTokenMintResponseSchema,
  );
  return response.token;
}

async function resolvePackagePublishToken(params: {
  registry: string;
  packageName: string;
  version: string;
  manualOverrideReason?: string;
  spinner: ReturnType<typeof createSpinner> | null;
}) {
  if (params.manualOverrideReason?.trim()) {
    return await requireAuthToken();
  }

  if (!hasGitHubActionsOidcEnv()) {
    return await requireAuthToken();
  }

  if (params.spinner) {
    params.spinner.text = "Requesting GitHub Actions OIDC token";
  }
  try {
    const githubOidcToken = await requestGitHubActionsOidcToken("clawhub");
    if (params.spinner) {
      params.spinner.text = "Minting short-lived ClawHub publish token";
    }
    return await mintPackagePublishToken(
      params.registry,
      params.packageName,
      params.version,
      githubOidcToken,
    );
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: unknown }).status
        : undefined;
    if (status !== undefined && status !== 400 && status !== 403 && status !== 404) {
      throw error;
    }
    if (params.spinner) {
      params.spinner.text = "Trusted publishing unavailable, falling back to ClawHub token";
    }
    return await requireAuthToken();
  }
}

function buildSource(options: PackagePublishOptions, inferred?: InferredPublishSource) {
  const rawRepo = options.sourceRepo?.trim() || inferred?.repo?.trim();
  const rawCommit = options.sourceCommit?.trim() || inferred?.commit?.trim();
  const rawRef = options.sourceRef?.trim() || inferred?.ref?.trim();
  const explicitPath = options.sourcePath?.trim();
  const rawPath = explicitPath !== undefined ? explicitPath : inferred?.path?.trim();
  if (!rawRepo && !rawCommit && !rawRef && !rawPath) return undefined;
  if (!rawRepo || !rawCommit) fail("--source-repo and --source-commit must be set together");
  const repo = normalizeGitHubRepo(rawRepo);
  if (!repo) fail("--source-repo must be a GitHub repo or URL");
  const explicitRepo = options.sourceRepo?.trim();
  const url = explicitRepo
    ? explicitRepo.startsWith("http")
      ? explicitRepo
      : `https://github.com/${repo}`
    : inferred?.url || `https://github.com/${repo}`;
  return {
    kind: "github" as const,
    url,
    repo,
    ref: rawRef || rawCommit,
    commit: rawCommit,
    path: rawPath || ".",
    importedAt: Date.now(),
  };
}

function describePublishSource(
  sourceInput: Awaited<ReturnType<typeof resolveSourceInput>>,
  source: ReturnType<typeof buildSource>,
  folder: string,
) {
  if (source) {
    return `github:${source.repo}@${source.ref}${source.path !== "." ? `:${source.path}` : ""}`;
  }
  if (sourceInput.kind === "github") {
    const repo = `${sourceInput.owner}/${sourceInput.repo}`;
    return `github:${repo}@${sourceInput.ref ?? "HEAD"}${
      sourceInput.path !== "." ? `:${sourceInput.path}` : ""
    }`;
  }
  return `local:${folder}`;
}

function printPackageDryRun(params: {
  source: string;
  family: PackageFamily;
  name: string;
  displayName: string;
  version: string;
  commit?: string;
  compatibility?: PackageCompatibility;
  tags: string[];
  files: PackageFile[];
}) {
  console.log("Dry run - nothing will be published.");
  console.log("");
  console.log(`Source:    ${params.source}`);
  console.log(`Family:    ${params.family}`);
  console.log(`Name:      ${params.name}`);
  console.log(`Display:   ${params.displayName}`);
  console.log(`Version:   ${params.version}`);
  if (params.commit) console.log(`Commit:    ${params.commit}`);
  if (params.compatibility) {
    console.log(`Compat:    ${formatCompatibilityEntries(params.compatibility).join(", ")}`);
  }
  console.log(
    `Files:     ${params.files.length} files (${formatByteCount(
      params.files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
    )})`,
  );
  console.log(`Tags:      ${params.tags.join(", ")}`);
  console.log("");
  console.log("Files:");
  for (const file of params.files) {
    console.log(`  ${file.relPath.padEnd(28)} ${formatByteCount(file.bytes.byteLength)}`);
  }
}

function formatByteCount(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function listPackageFiles(root: string) {
  const files: PackageFile[] = [];
  const absRoot = resolve(root);
  const ig = ignore();
  ig.add([".git/", "node_modules/", `${DOT_DIR}/`, `${LEGACY_DOT_DIR}/`]);
  await addIgnoreFile(ig, join(absRoot, DOT_IGNORE));
  await addIgnoreFile(ig, join(absRoot, LEGACY_DOT_IGNORE));
  await walk(absRoot, async (absPath) => {
    const relPath = normalizePath(relative(absRoot, absPath));
    if (!relPath || ig.ignores(relPath)) return;
    const bytes = new Uint8Array(await readFile(absPath));
    files.push({
      relPath,
      bytes,
      contentType: mime.getType(relPath) ?? "application/octet-stream",
    });
  });
  return files;
}

function normalizePath(path: string) {
  return path
    .split(sep)
    .join("/")
    .replace(/^\.\/+/, "");
}

async function walk(dir: string, onFile: (path: string) => Promise<void>) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    await onFile(full);
  }
}

async function addIgnoreFile(ig: ReturnType<typeof ignore>, path: string) {
  try {
    const raw = await readFile(path, "utf8");
    ig.add(raw.split(/\r?\n/));
  } catch {
    // optional
  }
}
