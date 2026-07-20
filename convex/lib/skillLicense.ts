import { normalizeSupportedSkillLicense, type SkillPlatformLicense } from "clawhub-schema";
import type { Id } from "../_generated/dataModel";

const PLATFORM_SKILL_LICENSE = "MIT-0" as const;

type StoredSkillLicenseFile = {
  path: string;
  storageId: Id<"_storage">;
};

export async function detectStoredSkillLicense(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  files: StoredSkillLicenseFile[],
): Promise<SkillPlatformLicense> {
  return (await detectDeclaredStoredSkillLicense(ctx, files)) ?? PLATFORM_SKILL_LICENSE;
}

export async function detectDeclaredStoredSkillLicense(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  files: StoredSkillLicenseFile[],
): Promise<SkillPlatformLicense | null> {
  const packageJsonFiles = files
    .filter((file) => file.path.toLowerCase() === "package.json")
    .sort((left, right) => packagePathRank(left.path) - packagePathRank(right.path));
  for (const file of packageJsonFiles) {
    const license = normalizeSupportedSkillLicense(await readPackageJsonLicense(ctx, file));
    if (license) return license;
  }

  const licenseFiles = files
    .filter((file) => isRootLicenseFilePath(file.path))
    .sort((left, right) => licensePathRank(left.path) - licensePathRank(right.path));
  for (const file of licenseFiles) {
    const license = detectLicenseFromText(await fetchStoredText(ctx, file.storageId));
    if (license) return license;
  }

  return null;
}

async function readPackageJsonLicense(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  file: StoredSkillLicenseFile,
) {
  try {
    const raw = await fetchStoredText(ctx, file.storageId);
    const parsed = JSON.parse(raw) as { license?: unknown };
    return typeof parsed.license === "string" ? parsed.license : null;
  } catch {
    return null;
  }
}

async function fetchStoredText(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  storageId: Id<"_storage">,
) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) return "";
  return blob.text();
}

export function detectLicenseFromText(text: string): SkillPlatformLicense | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const supported = normalizeSupportedSkillLicense(normalized);
  if (supported) return supported;
  const lower = normalized.toLowerCase();
  if (lower.includes("mit no attribution") || lower.includes("mit-0")) {
    return PLATFORM_SKILL_LICENSE;
  }
  if (
    lower.includes("permission is hereby granted, free of charge") &&
    lower.includes("the above copyright notice and this permission notice shall be included")
  ) {
    return "MIT";
  }
  return null;
}

function isRootLicenseFilePath(path: string) {
  if (!isRootPath(path)) return false;
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    basename === "license" ||
    basename === "license.md" ||
    basename === "license.txt" ||
    basename === "copying" ||
    basename === "copying.md" ||
    basename === "copying.txt"
  );
}

function packagePathRank(path: string) {
  return path.toLowerCase() === "package.json" ? 0 : path.split("/").length;
}

function licensePathRank(path: string) {
  return isRootPath(path) ? 0 : path.split("/").length;
}

function isRootPath(path: string) {
  return !path.includes("/");
}
