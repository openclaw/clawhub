import { hashSkillFiles } from "./skills";

export const SKILL_CARD_FILE_PATH = "skill-card.md";
export const MAX_SKILL_CARD_FILE_BYTES = 200 * 1024;

export type SkillCardFile = {
  path: string;
  size: number;
  storageId: unknown;
  sha256: string;
  contentType?: string;
};

function normalizeSkillCardPathForComparison(path: string) {
  return path
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/")
    .toLowerCase();
}

export function isSkillCardPath(path: string) {
  return normalizeSkillCardPathForComparison(path) === SKILL_CARD_FILE_PATH;
}

export function sourceSkillVersionFiles<T extends { path: string }>(
  files: T[],
  options: { generatedBundleFingerprints?: readonly string[] } = {},
) {
  if (!options.generatedBundleFingerprints?.length) return files;
  return files.filter((file) => !isSkillCardPath(file.path));
}

export function selectSkillCardFile<T extends { path: string }>(files: T[]) {
  return files.find((file) => isSkillCardPath(file.path)) ?? null;
}

export async function buildBundleFingerprint(files: Array<{ path: string; sha256: string }>) {
  return await hashSkillFiles(files.map((file) => ({ path: file.path, sha256: file.sha256 })));
}

export async function selectGeneratedSkillCardFile<T extends { path: string; sha256: string }>(
  files: T[],
  generatedBundleFingerprints: readonly string[],
) {
  const cardFile = selectSkillCardFile(files);
  if (!cardFile || generatedBundleFingerprints.length === 0) return null;
  const currentBundleFingerprint = await buildBundleFingerprint(files);
  return generatedBundleFingerprints.includes(currentBundleFingerprint) ? cardFile : null;
}

export async function selectTrustedSkillCardFile<T extends { path: string; sha256: string }>(
  files: T[],
  generatedBundleFingerprints: readonly string[],
  options: { allowPublisherSupplied?: boolean } = {},
) {
  const generatedCardFile = await selectGeneratedSkillCardFile(files, generatedBundleFingerprints);
  if (generatedCardFile) return generatedCardFile;
  return options.allowPublisherSupplied ? selectSkillCardFile(files) : null;
}

export async function replaceGeneratedSkillCardFile<T extends SkillCardFile>(
  files: T[],
  cardFile: T,
) {
  const replaced: T[] = [];
  let found = false;
  for (const file of files) {
    if (isSkillCardPath(file.path)) {
      if (!found) replaced.push(cardFile);
      found = true;
      continue;
    }
    replaced.push(file);
  }
  if (!found) replaced.push(cardFile);
  const bundleFingerprint = await buildBundleFingerprint(replaced);
  return { files: replaced, bundleFingerprint };
}

export function normalizeSkillCardSecurityStatus(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "pending";
  if (normalized === "clean" || normalized === "benign") return "clean";
  if (normalized === "suspicious" || normalized === "review") return "suspicious";
  if (normalized === "malicious") return "malicious";
  if (normalized === "error" || normalized === "failed") return "error";
  if (normalized === "completed") return "pending";
  return normalized;
}

export function hasSettledSkillCardInputs(version: {
  staticScan?: unknown;
  llmAnalysis?: { status?: string; verdict?: string };
}) {
  const status = normalizeSkillCardSecurityStatus(
    version.llmAnalysis?.verdict ?? version.llmAnalysis?.status,
  );
  return Boolean(version.staticScan && ["clean", "suspicious", "malicious"].includes(status));
}
