import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync, unzipSync } from "fflate";
import ignore from "ignore";
import mime from "mime";
import semver from "semver";
import { apiRequest, apiRequestForm, fetchText, registryUrl } from "../../http.js";
import {
  ApiRoutes,
  ApiV1PackageListResponseSchema,
  ApiV1PackagePublishResponseSchema,
  ApiV1PackageResponseSchema,
  ApiV1PackageSearchResponseSchema,
  ApiV1PackageTrustedPublisherResponseSchema,
  ApiV1PackageVersionListResponseSchema,
  ApiV1PackageVersionResponseSchema,
  ApiV1PublishTokenMintResponseSchema,
  normalizeOpenClawExternalPluginCompatibility,
  type PackageCapabilitySummary,
  type PackageCompatibility,
  type PackageFamily,
  type PackageStorePackSummary,
  type PackageTrustedPublisher,
  type PackageVerificationSummary,
  validateOpenClawExternalCodePluginPackageJson,
} from "../../schema/index.js";
import { getOptionalAuthToken, requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import { titleCase } from "../slug.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError } from "../ui.js";
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
  hostTarget?: string;
  environment?: string;
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

type PackageDownloadOptions = {
  version?: string;
  tag?: string;
  output?: string;
  json?: boolean;
};

type PackageStorePackInspectOptions = {
  version?: string;
  manifest?: boolean;
  json?: boolean;
};

type PackageVerifyOptions = {
  sha256?: string;
  json?: boolean;
};

type PackageStorePackMigrationOptions = {
  limit?: number;
  cursor?: string;
  json?: boolean;
};

type PackageStorePackMigrationRunOptions = PackageStorePackMigrationOptions & {
  operation?: string;
  status?: string;
};

type PackageStorePackRevokeOptions = {
  reason?: string;
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

type PackageFile = {
  relPath: string;
  bytes: Uint8Array;
  contentType?: string;
};

type PackageStorePackInspectResponse = {
  package: { name: string; displayName: string; family: PackageFamily };
  version: string | { version: string; createdAt?: number };
  storepack: PackageStorePackSummary;
  links?: {
    download?: string;
    immutable?: string | null;
    manifest?: string;
  };
  manifest?: Record<string, unknown>;
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

type PrintableFile = {
  path: string;
  size: number | null;
  sha256: string | null;
  contentType: string | null;
};

type PackageResponse = Awaited<ReturnType<typeof apiRequestPackageDetail>>;
type PackageVersionResponse = Awaited<ReturnType<typeof apiRequestPackageVersion>>;

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
      if (options.hostTarget) url.searchParams.set("hostTarget", options.hostTarget);
      if (options.environment) url.searchParams.set("environment", options.environment);
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
    if (options.hostTarget) url.searchParams.set("hostTarget", options.hostTarget);
    if (options.environment) url.searchParams.set("environment", options.environment);
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
      printStorePack(versionResult.version.storepack);
      printCompatibility(
        versionResult.version.compatibility ?? detail.package.compatibility ?? null,
      );
      printCapabilities(versionResult.version.capabilities ?? detail.package.capabilities ?? null);
      printVerification(versionResult.version.verification ?? detail.package.verification ?? null);
    } else if (shouldPrintMeta) {
      printStorePack(detail.package.storepack);
      printCompatibility(detail.package.compatibility ?? null);
      printCapabilities(detail.package.capabilities ?? null);
      printVerification(detail.package.verification ?? null);
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
  const url = registryUrl(
    `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/download`,
    registry,
  );
  if (options.version) url.searchParams.set("version", options.version);
  if (options.tag) url.searchParams.set("tag", options.tag);
  const spinner = options.json ? null : createSpinner("Downloading StorePack");
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/zip",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error((await response.text()) || `Download failed (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sha256 = sha256Hex(bytes);
    const filename =
      options.output?.trim() ||
      filenameFromContentDisposition(response.headers.get("content-disposition")) ||
      `${trimmed.replaceAll("/", "-")}.storepack.zip`;
    const outputPath = resolve(opts.workdir, filename);
    await mkdir(resolve(outputPath, ".."), { recursive: true }).catch(() => undefined);
    await writeFile(outputPath, bytes);
    spinner?.succeed(`Downloaded ${outputPath}`);
    const result = {
      path: outputPath,
      bytes: bytes.byteLength,
      sha256,
      storepackSha256: response.headers.get("x-clawhub-storepack-sha256"),
      specVersion: response.headers.get("x-clawhub-storepack-spec-version"),
    };
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

async function resolvePackageStorePackVersion(
  registry: string,
  packageName: string,
  token: string | null,
  options: PackageStorePackInspectOptions,
) {
  if (options.version?.trim()) return options.version.trim();
  const detail = await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.packages}/${encodeURIComponent(packageName)}`,
      ...(token ? { token } : {}),
    },
    ApiV1PackageResponseSchema,
  );
  if (!detail.package) fail(`Package not found: ${packageName}`);
  const version = detail.package.latestVersion;
  if (!version) fail(`Package has no published versions: ${packageName}`);
  return version;
}

export async function cmdInspectPackageStorePack(
  opts: GlobalOpts,
  packageName: string,
  options: PackageStorePackInspectOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const token = (await getOptionalAuthToken()) ?? null;
  const registry = await getRegistry(opts, { cache: true });
  const version = await resolvePackageStorePackVersion(registry, trimmed, token, options);
  const response = await apiRequest<PackageStorePackInspectResponse>(registry, {
    method: "GET",
    path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/versions/${encodeURIComponent(version)}/storepack${
      options.manifest ? "/manifest" : ""
    }`,
    ...(token ? { token } : {}),
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  if (options.manifest) {
    process.stdout.write(`${JSON.stringify(response.manifest ?? {}, null, 2)}\n`);
    return;
  }

  const responseVersion =
    typeof response.version === "string" ? response.version : response.version.version;
  console.log(`${response.package.name}@${responseVersion}`);
  printStorePack(response.storepack);
  if (response.links?.download) console.log(`StorePack Download: ${response.links.download}`);
  if (response.links?.immutable)
    console.log(`StorePack Immutable URL: ${response.links.immutable}`);
  if (response.links?.manifest) console.log(`StorePack Manifest URL: ${response.links.manifest}`);
}

export async function cmdVerifyPackageStorePack(
  filePath: string,
  options: PackageVerifyOptions = {},
) {
  const bytes = new Uint8Array(await readFile(resolve(filePath)));
  const sha256 = sha256Hex(bytes);
  const zipEntries = unzipSync(bytes);
  const manifestBytes = zipEntries["package/STOREPACK.json"];
  if (!manifestBytes) fail("Missing package/STOREPACK.json");
  const manifestText = new TextDecoder().decode(manifestBytes);
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const expected = options.sha256?.trim();
  const ok = expected ? sha256 === expected : true;
  const result = {
    ok,
    sha256,
    expectedSha256: expected || null,
    specVersion: manifest.specVersion ?? null,
    package: manifest.package ?? null,
    fileCount: Object.keys(zipEntries).length,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log(`StorePack: ${ok ? "ok" : "mismatch"}`);
  console.log(`SHA-256: ${sha256}`);
  if (expected) console.log(`Expected: ${expected}`);
  console.log(`Spec: ${formatUnknownScalar(manifest.specVersion)}`);
  if (!ok) fail("StorePack digest mismatch");
}

export async function cmdPackageStorePackMigrationStatus(
  opts: GlobalOpts,
  options: PackageStorePackMigrationOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.packages}/storepack/migration-status`, registry);
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    url.searchParams.set("limit", String(options.limit));
  }
  const result = await apiRequest<Record<string, unknown>>(registry, {
    method: "GET",
    url: url.toString(),
    token,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack migration");
  console.log(`Missing sample: ${formatUnknownScalar(result.missingSampleSize)}`);
  console.log(`Open failures: ${formatUnknownScalar(result.failureSampleSize)}`);
  console.log(`Generated sample: ${formatUnknownScalar(result.generatedStorePackSampleSize)}`);
  console.log(`Generated bytes: ${formatUnknownScalar(result.generatedStorePackBytes)}`);
}

export async function cmdPackageStorePackMigrationReadiness(
  opts: GlobalOpts,
  options: Pick<PackageStorePackMigrationOptions, "json"> = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<{
    items?: Array<{
      bundledPluginId?: string;
      displayName?: string;
      desiredPackageName?: string;
      readinessState?: string;
      blockers?: string[];
    }>;
    readyCount?: number;
    blockedCount?: number;
    generatedAt?: number;
  }>(registry, {
    method: "GET",
    path: `${ApiRoutes.packages}/storepack/migration-readiness`,
    token,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack migration readiness");
  console.log(`Ready: ${formatUnknownScalar(result.readyCount)}`);
  console.log(`Blocked: ${formatUnknownScalar(result.blockedCount)}`);
  for (const item of result.items ?? []) {
    const blockers = item.blockers?.length ? ` [${item.blockers.join(", ")}]` : "";
    console.log(
      `${item.bundledPluginId ?? "unknown"}: ${item.readinessState ?? "unknown"} -> ${
        item.desiredPackageName ?? item.displayName ?? "unknown"
      }${blockers}`,
    );
  }
}

export async function cmdPackageStorePackMigrationDryRun(
  opts: GlobalOpts,
  options: PackageStorePackMigrationRunOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.packages}/storepack/migration-runs/dry-run`, registry);
  url.searchParams.set("operation", options.operation?.trim() || "artifact-backfill");
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    url.searchParams.set("limit", String(options.limit));
  }
  if (options.cursor?.trim()) url.searchParams.set("cursor", options.cursor.trim());
  const result = await apiRequest<Record<string, unknown>>(registry, {
    method: "GET",
    url: url.toString(),
    token,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack migration dry-run");
  console.log(`Operation: ${formatUnknownScalar(result.operation)}`);
  console.log(`Candidates: ${formatUnknownScalar(result.candidateCount)}`);
  console.log(`Open failures: ${formatUnknownScalar(result.failureCount)}`);
  console.log(`Next cursor: ${formatUnknownScalar(result.continueCursor)}`);
  console.log(`Done: ${formatUnknownScalar(result.isDone)}`);
}

export async function cmdPackageStorePackMigrationRuns(
  opts: GlobalOpts,
  options: PackageStorePackMigrationRunOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.packages}/storepack/migration-runs`, registry);
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    url.searchParams.set("limit", String(options.limit));
  }
  if (options.status?.trim()) url.searchParams.set("status", options.status.trim());
  const result = await apiRequest<
    { items?: Array<Record<string, unknown>> } & Record<string, unknown>
  >(registry, {
    method: "GET",
    url: url.toString(),
    token,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack migration runs");
  for (const run of result.items ?? []) {
    console.log(formatStorePackMigrationRunLine(run));
  }
}

export async function cmdPackageStorePackMigrationRunCreate(
  opts: GlobalOpts,
  options: PackageStorePackMigrationRunOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<Record<string, unknown>>(registry, {
    method: "POST",
    path: `${ApiRoutes.packages}/storepack/migration-runs`,
    token,
    body: {
      operation: options.operation?.trim() || "artifact-backfill",
      ...(typeof options.limit === "number" && Number.isFinite(options.limit)
        ? { limit: options.limit }
        : {}),
      ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
    },
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack migration run created");
  console.log(formatStorePackMigrationRunLine(result));
}

export async function cmdPackageStorePackMigrationRunContinue(
  opts: GlobalOpts,
  runId: string,
  options: Pick<PackageStorePackMigrationRunOptions, "json"> = {},
) {
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) fail("Run id required");
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<{
    run?: Record<string, unknown> | null;
    result?: Record<string, unknown> | null;
    error?: string;
  }>(registry, {
    method: "POST",
    path: `${ApiRoutes.packages}/storepack/migration-runs/${encodeURIComponent(trimmedRunId)}/continue`,
    token,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack migration run continued");
  if (result.run) console.log(formatStorePackMigrationRunLine(result.run));
  if (result.result) {
    console.log(`Processed: ${formatUnknownScalar(result.result.processed)}`);
    console.log(`Succeeded: ${formatUnknownScalar(result.result.succeeded)}`);
    console.log(`Failed: ${formatUnknownScalar(result.result.failed)}`);
    console.log(`Next cursor: ${formatUnknownScalar(result.result.continueCursor)}`);
  }
  if (result.error) console.log(`Error: ${result.error}`);
}

export async function cmdPackageStorePackBackfill(
  opts: GlobalOpts,
  options: PackageStorePackMigrationOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<Record<string, unknown>>(registry, {
    method: "POST",
    path: `${ApiRoutes.packages}/storepack/backfill`,
    token,
    body:
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? { limit: options.limit }
        : {},
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack backfill");
  console.log(`Processed: ${formatUnknownScalar(result.processed)}`);
  console.log(`Succeeded: ${formatUnknownScalar(result.succeeded)}`);
  console.log(`Failed: ${formatUnknownScalar(result.failed)}`);
}

export async function cmdPackageStorePackRetryFailures(
  opts: GlobalOpts,
  options: PackageStorePackMigrationOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<Record<string, unknown>>(registry, {
    method: "POST",
    path: `${ApiRoutes.packages}/storepack/retry-failures`,
    token,
    body:
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? { limit: options.limit }
        : {},
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack failure retry");
  console.log(`Processed: ${formatUnknownScalar(result.processed)}`);
  console.log(`Succeeded: ${formatUnknownScalar(result.succeeded)}`);
  console.log(`Failed: ${formatUnknownScalar(result.failed)}`);
}

export async function cmdPackageStorePackIndexBackfill(
  opts: GlobalOpts,
  options: PackageStorePackMigrationOptions = {},
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<Record<string, unknown>>(registry, {
    method: "POST",
    path: `${ApiRoutes.packages}/storepack/index-backfill`,
    token,
    body: {
      ...(typeof options.limit === "number" && Number.isFinite(options.limit)
        ? { limit: options.limit }
        : {}),
      ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
    },
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack index backfill");
  console.log(`Processed: ${formatUnknownScalar(result.processed)}`);
  console.log(`Succeeded: ${formatUnknownScalar(result.succeeded)}`);
  console.log(`Failed: ${formatUnknownScalar(result.failed)}`);
  console.log(`Next cursor: ${formatUnknownScalar(result.continueCursor)}`);
  console.log(`Done: ${formatUnknownScalar(result.isDone)}`);
}

export async function cmdPackageStorePackRevoke(
  opts: GlobalOpts,
  packageName: string,
  version: string,
  options: PackageStorePackRevokeOptions = {},
) {
  const trimmed = normalizePackageNameOrFail(packageName);
  const trimmedVersion = version.trim();
  if (!trimmedVersion) fail("Version required");
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const reason = options.reason?.trim();
  const result = await apiRequest<Record<string, unknown>>(registry, {
    method: "POST",
    path: `${ApiRoutes.packages}/${encodeURIComponent(trimmed)}/versions/${encodeURIComponent(trimmedVersion)}/storepack/revoke`,
    token,
    body: reason ? { reason } : {},
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log("StorePack revoked");
  console.log(`Package: ${trimmed}`);
  console.log(`Version: ${formatUnknownScalar(result.version ?? trimmedVersion)}`);
  console.log(`SHA-256: ${formatUnknownScalar(result.sha256)}`);
  console.log(`Revoked artifacts: ${formatUnknownScalar(result.revokedArtifactCount)}`);
}

async function apiRequestPackageDetail(registry: string, name: string, token?: string) {
  return await apiRequest(
    registry,
    { method: "GET", path: `${ApiRoutes.packages}/${encodeURIComponent(name)}`, token },
    ApiV1PackageResponseSchema,
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

function normalizePackageNameOrFail(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) fail("Package name required");
  return trimmed;
}

function clampLimit(value: number, max: number) {
  if (!Number.isFinite(value)) return Math.min(25, max);
  return Math.max(1, Math.min(Math.round(value), max));
}

function formatUnknownScalar(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "unknown";
}

function formatStorePackMigrationRunLine(run: Record<string, unknown>) {
  const id = formatUnknownScalar(run._id);
  const operation = formatUnknownScalar(run.operation);
  const status = formatUnknownScalar(run.status);
  const processed = formatUnknownScalar(run.processed);
  const failed = formatUnknownScalar(run.failed);
  const cursor = formatUnknownScalar(run.continueCursor ?? run.cursor);
  return `${id}  ${operation}  ${status}  processed=${processed} failed=${failed} cursor=${cursor}`;
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

function printStorePack(storepack: PackageStorePackSummary | null | undefined) {
  if (!storepack) return;
  console.log(`StorePack: ${storepack.available ? "available" : "unavailable"}`);
  if (!storepack.available) return;
  if (storepack.sha256) console.log(`StorePack SHA-256: ${storepack.sha256}`);
  if (typeof storepack.size === "number") console.log(`StorePack Size: ${storepack.size}B`);
  if (storepack.specVersion) console.log(`StorePack Spec: v${storepack.specVersion}`);
  if (storepack.hostTargets?.length) {
    const targets = storepack.hostTargets
      .map((target) => [target.os, target.arch, target.libc].filter(Boolean).join("-"))
      .join(", ");
    console.log(`StorePack Targets: ${targets}`);
  }
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

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function filenameFromContentDisposition(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/i);
  return match?.[1] ? basename(match[1]) : null;
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

function detectPackageFamily(
  fileSet: Set<string>,
  explicit?: "code-plugin" | "bundle-plugin",
): "code-plugin" | "bundle-plugin" {
  if (explicit) return explicit;
  if (fileSet.has("openclaw.plugin.json")) return "code-plugin";
  if (fileSet.has("openclaw.bundle.json")) return "bundle-plugin";
  return fail("Could not detect package family. Use --family.");
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
    const sourceStat = await stat(folder).catch(() => null);
    if (!sourceStat) fail("Path must be a folder or package archive");
    if (sourceStat.isFile()) {
      const extracted = await extractPackageArchive(folder);
      folder = extracted.folder;
      cleanup = extracted.cleanup;
    } else if (sourceStat.isDirectory()) {
      const localGitInfo = resolveLocalGitInfo(folder);
      if (localGitInfo) {
        inferredSource = {
          repo: localGitInfo.repo,
          commit: localGitInfo.commit,
          ref: localGitInfo.ref,
          path: localGitInfo.path,
          ...(localGitInfo.repo ? { url: `https://github.com/${localGitInfo.repo}` } : {}),
        };
      }
    } else {
      fail("Path must be a folder or package archive");
    }
  }

  const filesOnDisk = await listPackageFiles(folder);
  if (filesOnDisk.length === 0) fail("No files found");

  const fileSet = new Set(filesOnDisk.map((file) => file.relPath.toLowerCase()));
  const packageJson = await readJsonFile(join(folder, "package.json"));
  const pluginManifest = await readJsonFile(join(folder, "openclaw.plugin.json"));
  const bundleManifest = await readJsonFile(join(folder, "openclaw.bundle.json"));
  const family = detectPackageFamily(fileSet, options.family);
  const name =
    options.name?.trim() ||
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
  const version = options.version?.trim() || packageJsonString(packageJson, "version");
  const changelog = options.changelog ?? "";
  const tags = parseTags(options.tags ?? "latest");
  const source = buildSource(options, inferredSource);

  if (!name) fail("--name required");
  if (!displayName) fail("--display-name required");
  if (!version) fail("--version required");
  if (family === "code-plugin" && !semver.valid(version)) {
    fail("--version must be valid semver for code plugins");
  }
  if (family === "code-plugin") {
    if (!fileSet.has("package.json")) fail("package.json required");
    if (!fileSet.has("openclaw.plugin.json")) fail("openclaw.plugin.json required");
    if (!source) fail("--source-repo and --source-commit required for code plugins");
    const validation = validateOpenClawExternalCodePluginPackageJson(packageJson);
    if (validation.issues.length > 0) {
      fail(validation.issues.map((issue) => issue.message).join(" "));
    }
  }
  if (family === "bundle-plugin") {
    const hostTargets = parseCsv(options.hostTargets);
    if (!fileSet.has("openclaw.bundle.json") && hostTargets.length === 0) {
      fail("Bundle plugins need openclaw.bundle.json or --host-targets");
    }
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
            format: options.bundleFormat?.trim() || undefined,
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
      totalBytes: filesOnDisk.reduce((sum, file) => sum + file.bytes.byteLength, 0),
    },
  };
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
  return `local:${sourceInput.path || folder}`;
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

async function extractPackageArchive(archivePath: string) {
  const archiveName = basename(archivePath);
  const lower = archiveName.toLowerCase();
  const bytes = new Uint8Array(await readFile(archivePath));
  const entries = lower.endsWith(".zip")
    ? Object.entries(unzipSync(bytes)).map(([path, data]) => ({ path, data }))
    : lower.endsWith(".tgz") || lower.endsWith(".tar.gz")
      ? untar(gunzipSync(bytes))
      : fail("Path must be a folder or .zip/.tgz package archive");
  const normalizedEntries = stripSingleArchiveRoot(entries);
  if (normalizedEntries.length === 0) fail("Package archive does not contain any files");

  const tempDir = await mkdtemp(join(tmpdir(), "clawhub-package-publish-"));
  try {
    for (const entry of normalizedEntries) {
      const relPath = normalizeArchivePath(entry.path);
      if (!relPath) continue;
      const destination = resolve(tempDir, relPath);
      if (!destination.startsWith(`${tempDir}${sep}`)) {
        throw new Error(`Unsafe archive path: ${entry.path}`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, entry.data);
    }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    folder: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
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

function stripSingleArchiveRoot(entries: Array<{ path: string; data: Uint8Array }>) {
  const normalized = entries
    .map((entry) => ({ path: normalizeArchivePath(entry.path), data: entry.data }))
    .filter((entry) => entry.path && !entry.path.endsWith("/"));
  const partsList = normalized.map((entry) => entry.path.split("/").filter(Boolean));
  if (partsList.length === 0 || partsList.some((parts) => parts.length < 2)) return normalized;

  const first = partsList[0]?.[0];
  if (!first || !partsList.every((parts) => parts[0] === first)) return normalized;
  return normalized.map((entry) => ({
    path: entry.path.split("/").slice(1).join("/"),
    data: entry.data,
  }));
}

function normalizeArchivePath(path: string) {
  const normalized = path
    .replaceAll("\u0000", "")
    .replaceAll("\\", "/")
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
  return parts.join("/");
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

function untar(bytes: Uint8Array) {
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header.subarray(0, 100));
    const size = readTarOctal(header.subarray(124, 136));
    const typeflag = header[156];
    offset += 512;
    const data = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (!name || typeflag === 53) continue;
    entries.push({ path: name, data });
  }
  return entries;
}

function readTarString(bytes: Uint8Array) {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.subarray(0, end);
  return new TextDecoder().decode(slice).trim();
}

function readTarOctal(bytes: Uint8Array) {
  const raw = readTarString(bytes).replaceAll("\u0000", "").trim();
  if (!raw) return 0;
  return Number.parseInt(raw, 8);
}
