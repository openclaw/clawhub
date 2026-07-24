import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseExperimentalClawFeed, type ExperimentalClawFeedEntry } from "clawhub-schema";
import { unzipSync } from "fflate";
import { parseClawPack } from "../convex/lib/clawpack";
import { isSafeClawPackagePath } from "../packages/clawhub/src/schema/clawPackage";

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;

type PublishedClawProofOptions = {
  feedUrl: string;
  packageName: string;
  registryUrl: string;
  openclawRepo: string;
  keepTemp?: boolean;
};

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function encodePackageName(name: string): string {
  return encodeURIComponent(name);
}

export function selectPublishedClaw(feedValue: unknown, packageName: string) {
  const feed = parseExperimentalClawFeed(feedValue);
  const entry = feed.entries.find(
    (candidate): candidate is ExperimentalClawFeedEntry => candidate.id === packageName,
  );
  if (!entry) throw new Error(`Claw ${packageName} was not present in the hosted feed`);
  const candidate = entry.install.candidates.find(
    (install) =>
      install.sourceRef === "public-clawhub" &&
      install.package === packageName &&
      install.version === entry.version,
  );
  if (!candidate) {
    throw new Error(`Claw ${packageName}@${entry.version} has no exact public-clawhub candidate`);
  }
  return { entry, candidate };
}

export async function findExtractedPackageRoot(root: string): Promise<string> {
  if (await readFile(join(root, "package.json"), "utf8").catch(() => undefined)) {
    return root;
  }
  const conventional = join(root, "package");
  if (await readFile(join(conventional, "package.json"), "utf8").catch(() => undefined)) {
    return conventional;
  }
  const candidates: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name);
    if (await readFile(join(candidate, "package.json"), "utf8").catch(() => undefined)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length !== 1) {
    throw new Error("Downloaded artifact did not contain exactly one package root");
  }
  return candidates[0]!;
}

export async function assertSafeClawArchive(archivePath: string): Promise<void> {
  const bytes = new Uint8Array(await readFile(archivePath));
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Artifact exceeds 64MB download limit");
  await parseClawPack(bytes);
}

async function extractSafeClawPack(bytes: Uint8Array, targetDir: string): Promise<void> {
  const parsed = await parseClawPack(bytes);
  await mkdir(targetDir, { recursive: true });
  for (const entry of parsed.entries) {
    const outputPath = join(targetDir, "package", entry.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, entry.bytes);
  }
}

export async function extractSafeClawZip(bytes: Uint8Array, targetDir: string): Promise<void> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Artifact exceeds 64MB download limit");
  const portablePaths = new Set<string>();
  let entryCount = 0;
  let unpackedBytes = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error("Artifact exceeds 10000 entry limit");
      unpackedBytes += entry.originalSize;
      if (unpackedBytes > MAX_UNPACKED_BYTES) {
        throw new Error("Artifact exceeds 50MB unpacked limit");
      }
      const path = entry.name.replace(/\/+$/, "");
      if (!path || !isSafeClawPackagePath(path)) {
        throw new Error(`Artifact contains an unsafe path: ${entry.name}`);
      }
      const portablePath = path.normalize("NFC").toLowerCase();
      if (portablePaths.has(portablePath)) {
        throw new Error(`Artifact contains a duplicate portable path: ${entry.name}`);
      }
      portablePaths.add(portablePath);
      return true;
    },
  });
  await mkdir(targetDir, { recursive: true });
  for (const [rawPath, data] of Object.entries(entries)) {
    const path = rawPath.replace(/\/+$/, "");
    if (!path) continue;
    if (rawPath.endsWith("/")) {
      await mkdir(join(targetDir, path), { recursive: true });
      continue;
    }
    const outputPath = join(targetDir, path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, data);
  }
}

export async function readResponseBytesBounded(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Artifact exceeds 64MB download limit");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ARCHIVE_BYTES) {
      await reader.cancel();
      throw new Error("Artifact exceeds 64MB download limit");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function runPublishedClawDryRun(options: PublishedClawProofOptions) {
  const root = await mkdtemp(join(tmpdir(), "clawhub-claw-e2e-"));
  try {
    const feedResponse = await fetch(options.feedUrl);
    if (!feedResponse.ok) {
      throw new Error(`Claws feed returned HTTP ${feedResponse.status}`);
    }
    const { entry, candidate } = selectPublishedClaw(
      await feedResponse.json(),
      options.packageName,
    );
    const artifactUrl = new URL(
      `/api/v1/packages/${encodePackageName(candidate.package)}/versions/${encodeURIComponent(candidate.version)}/artifact`,
      options.registryUrl,
    );
    const metadataResponse = await fetch(artifactUrl);
    if (!metadataResponse.ok) {
      throw new Error(`Artifact metadata returned HTTP ${metadataResponse.status}`);
    }
    const metadata = (await metadataResponse.json()) as {
      artifact?: { kind?: unknown; sha256?: unknown; downloadUrl?: unknown };
    };
    const artifactKind = metadata.artifact?.kind;
    const metadataSha256 = metadata.artifact?.sha256;
    const downloadUrl = metadata.artifact?.downloadUrl;
    if (
      (artifactKind !== "npm-pack" && artifactKind !== "legacy-zip") ||
      typeof metadataSha256 !== "string" ||
      typeof downloadUrl !== "string"
    ) {
      throw new Error("Artifact metadata did not include kind, sha256, and downloadUrl");
    }
    if (candidate.integrity !== `sha256:${metadataSha256.replace(/^sha256:/, "")}`) {
      throw new Error("Feed integrity does not match artifact metadata");
    }
    const artifactResponse = await fetch(new URL(downloadUrl, options.registryUrl));
    if (!artifactResponse.ok) {
      throw new Error(`Artifact download returned HTTP ${artifactResponse.status}`);
    }
    const artifactBytes = await readResponseBytesBounded(artifactResponse);
    if (sha256(artifactBytes) !== candidate.integrity) {
      throw new Error("Downloaded artifact does not match the feed integrity");
    }

    const extractRoot = join(root, "extract");
    if (artifactKind === "npm-pack") {
      await extractSafeClawPack(artifactBytes, extractRoot);
    } else {
      await extractSafeClawZip(artifactBytes, extractRoot);
    }
    const packageRoot = await findExtractedPackageRoot(extractRoot);
    const stateDir = join(root, "openclaw-state");
    const result = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/entry.ts", "claws", "add", packageRoot, "--dry-run", "--json"],
      {
        cwd: resolve(options.openclawRepo),
        env: {
          ...process.env,
          HOME: stateDir,
          USERPROFILE: stateDir,
          OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json"),
          OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
          OPENCLAW_EXPERIMENTAL_CLAWS: "1",
          OPENCLAW_HOME: stateDir,
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_TEST_FAST: "1",
          VITEST: "",
        },
        maxBuffer: 1024 * 1024,
      },
    );
    const plan = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    if (
      plan.schemaVersion !== "openclaw.clawAddPlan.v1" ||
      plan.dryRun !== true ||
      plan.mutationAllowed !== false
    ) {
      throw new Error("OpenClaw did not return a non-mutating Claw add plan");
    }
    return { entry, candidate, plan };
  } finally {
    if (!options.keepTemp) await rm(root, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  let keepTemp = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--keep-temp") {
      keepTemp = true;
      continue;
    }
    const value = argv[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid argument: ${arg}`);
    }
    values.set(arg, value);
    index += 1;
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  return {
    feedUrl: required("--feed"),
    packageName: required("--package"),
    registryUrl: required("--registry"),
    openclawRepo: required("--openclaw-repo"),
    keepTemp,
  };
}

if (import.meta.main) {
  const result = await runPublishedClawDryRun(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
