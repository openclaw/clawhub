import type { ActionCtx } from "../_generated/server";
import {
  isExcludedSkillBundlePath,
  isPrimarySkillReadmePath,
  redactBundleContent,
  utf8Bytes,
} from "./securityDatasetRedaction";

const MAX_REDACTED_BUNDLE_FILE_BYTES = 192 * 1024;
const MAX_REDACTED_BUNDLE_BYTES_PER_ARTIFACT = 256 * 1024;

export async function readRedactedBundleFiles(
  ctx: Pick<ActionCtx, "storage">,
  files: unknown[],
  remainingResponseBytes: number,
) {
  const bundleFiles: Array<{ path: string; content: string }> = [];
  let remainingArtifactBytes = Math.min(
    remainingResponseBytes,
    MAX_REDACTED_BUNDLE_BYTES_PER_ARTIFACT,
  );
  for (const file of files) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      typeof file.storageId !== "string" ||
      isExcludedSkillBundlePath(file.path)
    ) {
      continue;
    }
    if (typeof file.size === "number" && file.size > MAX_REDACTED_BUNDLE_FILE_BYTES) continue;
    if (remainingArtifactBytes <= 0) break;
    const blob = await ctx.storage.get(file.storageId as never);
    if (!blob) continue;
    const content = redactBundleContent(await blob.text());
    const contentBytes = utf8Bytes(content);
    if (contentBytes > MAX_REDACTED_BUNDLE_FILE_BYTES || contentBytes > remainingArtifactBytes) {
      continue;
    }
    bundleFiles.push({ path: file.path, content });
    remainingArtifactBytes -= contentBytes;
  }
  return bundleFiles;
}

export async function readRedactedSkillMdContent(
  ctx: Pick<ActionCtx, "storage">,
  files: unknown[],
) {
  const skillFile = files.find((file) => {
    if (!isRecord(file) || typeof file.path !== "string") return false;
    return isPrimarySkillReadmePath(file.path);
  });
  if (!isRecord(skillFile) || typeof skillFile.storageId !== "string") return null;
  const blob = await ctx.storage.get(skillFile.storageId as never);
  if (!blob) return null;
  return redactBundleContent(await blob.text()).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
