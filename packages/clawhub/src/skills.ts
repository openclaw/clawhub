import { createHash } from "node:crypto";
import { access, mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { zipSync } from "fflate";
import ignore from "ignore";
import mime from "mime";
import {
  type Lockfile,
  LockfileSchema,
  parseArk,
  TEXT_FILE_EXTENSION_SET,
} from "./schema/index.js";

const DOT_DIR = ".clawhub";
const LEGACY_DOT_DIR = ".clawdhub";
const DOT_IGNORE = ".clawhubignore";
const LEGACY_DOT_IGNORE = ".clawdhubignore";
const TEXT_SAMPLE_BYTES = 4096;

export type SkillOrigin = {
  version: 1;
  registry: string;
  slug: string;
  ownerHandle?: string;
  installedVersion: string;
  installedAt: number;
  fingerprint?: string;
};

export async function extractZipToDir(zipBytes: Uint8Array, targetDir: string) {
  const entries = unzipSync(zipBytes);
  await mkdir(targetDir, { recursive: true });
  for (const [rawPath, data] of Object.entries(entries)) {
    const safePath = sanitizeRelPath(rawPath);
    if (!safePath) continue;
    const outPath = join(targetDir, safePath);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, data);
  }
}

export async function extractGitHubZipPathToDir(
  zipBytes: Uint8Array,
  targetDir: string,
  sourcePath: string,
) {
  const entries = unzipSync(zipBytes);
  const normalizedSourcePath = normalizeGitHubSourcePath(sourcePath);
  let wroteFile = false;

  await mkdir(targetDir, { recursive: true });
  for (const [rawPath, data] of Object.entries(entries)) {
    const safeZipPath = sanitizeRelPath(rawPath);
    if (!safeZipPath) continue;
    const repoRelativePath = stripGitHubZipRoot(safeZipPath);
    if (repoRelativePath === null) continue;
    const targetRelativePath = getGitHubSourceRelativePath(repoRelativePath, normalizedSourcePath);
    if (!targetRelativePath) continue;
    const safeTargetPath = sanitizeRelPath(targetRelativePath);
    if (!safeTargetPath) continue;

    const outPath = join(targetDir, safeTargetPath);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, data);
    wroteFile = true;
  }

  if (!wroteFile) {
    throw new Error(`GitHub zip did not contain ${sourcePath}`);
  }
}

export async function listTextFiles(root: string) {
  const files: Array<{ relPath: string; bytes: Uint8Array; contentType?: string }> = [];
  const absRoot = resolve(root);
  const ig = ignore();
  ig.add([".git/", "node_modules/", `${DOT_DIR}/`, `${LEGACY_DOT_DIR}/`]);
  await addIgnoreFile(ig, join(absRoot, ".gitignore"));
  await addIgnoreFile(ig, join(absRoot, DOT_IGNORE));
  await addIgnoreFile(ig, join(absRoot, LEGACY_DOT_IGNORE));

  await walk(absRoot, async (absPath) => {
    const relPath = normalizePath(relative(absRoot, absPath));
    if (!relPath) return;
    if (ig.ignores(relPath)) return;
    if (hasDotPathSegment(relPath)) return;
    const ext = getFileExtension(relPath);
    if (ext && !TEXT_FILE_EXTENSION_SET.has(ext)) return;
    if (!ext && !(await isLikelyTextFile(absPath))) return;
    const buffer = await readFile(absPath);
    const contentType = mime.getType(relPath) ?? "text/plain";
    files.push({ relPath, bytes: new Uint8Array(buffer), contentType });
  });
  return files;
}

type SkillFileHash = { path: string; sha256: string; size: number };

// Above this total upload size, the inline multipart POST /api/v1/skills request
// is rejected at the platform edge (Vercel serverless body limit ~4.5MB) with a
// raw 413. The CLI switches to the staged-bundle flow (zip -> storage upload
// ticket -> publish by reference) past this threshold. Kept well under 4.5MB to
// leave headroom for multipart framing and the JSON payload part.
export const SKILL_INLINE_MULTIPART_MAX_BYTES = 4 * 1024 * 1024;

export type SkillBundleFile = { relPath: string; bytes: Uint8Array };

// Total on-disk bytes of the files the CLI would upload. This is the metric the
// inline-vs-staged decision is based on (multipart framing overhead is minor).
export function totalSkillFileBytes(files: Array<{ bytes: Uint8Array }>): number {
  return files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
}

export function shouldStageSkillBundle(files: Array<{ bytes: Uint8Array }>): boolean {
  return totalSkillFileBytes(files) > SKILL_INLINE_MULTIPART_MAX_BYTES;
}

// Build a deterministic zip of the skill files for the staged-upload flow. The
// server unzips it and runs each entry through the same per-file/total size
// gates as the inline multipart path, so this only needs to preserve paths and
// bytes. Level 6 matches the server-side download zip builder.
export function buildSkillBundleZip(files: SkillBundleFile[]): Uint8Array {
  const zipData: Record<string, Uint8Array> = {};
  for (const file of files) {
    zipData[file.relPath] = file.bytes;
  }
  return Uint8Array.from(zipSync(zipData, { level: 6 }));
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildSkillFingerprint(files: Array<{ path: string; sha256: string }>) {
  const normalized = files
    .filter((file) => Boolean(file.path) && Boolean(file.sha256))
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const payload = normalized.map((file) => `${file.path}:${file.sha256}`).join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

export function hashSkillFiles(files: Array<{ relPath: string; bytes: Uint8Array }>) {
  const hashed = files.map((file) => ({
    path: file.relPath,
    sha256: sha256Hex(file.bytes),
    size: file.bytes.byteLength,
  }));
  return { files: hashed, fingerprint: buildSkillFingerprint(hashed) };
}

export function hashSkillZip(zipBytes: Uint8Array) {
  const entries = unzipSync(zipBytes);
  const hashed = Object.entries(entries)
    .map(([rawPath, bytes]) => {
      const safePath = sanitizeZipPath(rawPath);
      if (!safePath) return null;
      if (hasDotPathSegment(safePath)) return null;
      const ext = getFileExtension(safePath);
      if (ext && !TEXT_FILE_EXTENSION_SET.has(ext)) return null;
      if (!ext && !isLikelyTextBytes(bytes)) return null;
      return { path: safePath, sha256: sha256Hex(bytes), size: bytes.byteLength };
    })
    .filter(Boolean) as SkillFileHash[];

  return { files: hashed, fingerprint: buildSkillFingerprint(hashed) };
}

export async function readLockfile(workdir: string): Promise<Lockfile> {
  const paths = [join(workdir, DOT_DIR, "lock.json"), join(workdir, LEGACY_DOT_DIR, "lock.json")];
  for (const path of paths) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return parseArk(LockfileSchema, parsed, "Lockfile");
    } catch {
      // try next
    }
  }
  return { version: 1, skills: {} };
}

export async function writeLockfile(workdir: string, lock: Lockfile) {
  const path = join(workdir, DOT_DIR, "lock.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export async function readSkillOrigin(skillFolder: string): Promise<SkillOrigin | null> {
  const paths = [
    join(skillFolder, DOT_DIR, "origin.json"),
    join(skillFolder, LEGACY_DOT_DIR, "origin.json"),
  ];
  for (const path of paths) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<SkillOrigin>;
      if (parsed.version !== 1) return null;
      if (!parsed.registry || !parsed.slug || !parsed.installedVersion) return null;
      if (typeof parsed.installedAt !== "number" || !Number.isFinite(parsed.installedAt)) {
        return null;
      }
      return {
        version: 1,
        registry: parsed.registry,
        slug: parsed.slug,
        ownerHandle: typeof parsed.ownerHandle === "string" ? parsed.ownerHandle : undefined,
        installedVersion: parsed.installedVersion,
        installedAt: parsed.installedAt,
        fingerprint: typeof parsed.fingerprint === "string" ? parsed.fingerprint : undefined,
      };
    } catch {
      // try next
    }
  }
  return null;
}

export async function writeSkillOrigin(skillFolder: string, origin: SkillOrigin) {
  const path = join(skillFolder, DOT_DIR, "origin.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(origin, null, 2)}\n`, "utf8");
}

function normalizePath(path: string) {
  return path
    .split(sep)
    .join("/")
    .replace(/^\.\/+/, "");
}

function getFileExtension(path: string) {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function hasDotPathSegment(path: string) {
  return path.split("/").some((segment) => segment.startsWith("."));
}

async function isLikelyTextFile(path: string) {
  const handle = await open(path, "r");
  try {
    const sample = new Uint8Array(TEXT_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(sample, 0, sample.byteLength, 0);
    return isLikelyTextBytes(sample.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function isLikelyTextBytes(bytes: Uint8Array) {
  const sample = bytes.slice(0, TEXT_SAMPLE_BYTES);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function sanitizeRelPath(path: string) {
  const normalized = path.replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/")) return null;
  if (normalized.includes("\\")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return normalized;
}

function sanitizeZipPath(path: string) {
  return sanitizeRelPath(path);
}

function normalizeGitHubSourcePath(path: string) {
  return path.replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
}

function stripGitHubZipRoot(path: string) {
  const slash = path.indexOf("/");
  if (slash < 0) return null;
  return path.slice(slash + 1);
}

function getGitHubSourceRelativePath(repoRelativePath: string, sourcePath: string) {
  if (!sourcePath) return repoRelativePath;
  if (repoRelativePath === sourcePath) return null;
  if (!repoRelativePath.startsWith(`${sourcePath}/`)) return null;
  return repoRelativePath.slice(sourcePath.length + 1);
}

async function walk(dir: string, onFile: (path: string) => Promise<void>) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
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

export async function listManualSkills(skillsDir: string, lockedSlugs: Set<string>) {
  const manual: string[] = [];
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return manual;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (lockedSlugs.has(entry.name)) continue;
    if (await hasSkillMetadata(join(skillsDir, entry.name))) {
      manual.push(entry.name);
    }
  }
  return manual.sort((a, b) => a.localeCompare(b));
}

async function hasSkillMetadata(skillDir: string) {
  const candidates = [
    join(skillDir, "SKILL.md"),
    join(skillDir, DOT_DIR, "origin.json"),
    join(skillDir, LEGACY_DOT_DIR, "origin.json"),
  ];
  for (const path of candidates) {
    try {
      await access(path);
      return true;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
  return false;
}

function isMissingPathError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
