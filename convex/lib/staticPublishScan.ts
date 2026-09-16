import { decodeUtf8Text } from "clawhub-schema";
import type { ActionCtx } from "../_generated/server";
import { runStaticModerationScan, type StaticScanResult } from "./moderationEngine";

type PublishFile = {
  path: string;
  size: number;
  storageId: string;
  contentType?: string;
};

type StaticPublishScanInput = {
  slug: string;
  displayName: string;
  summary?: string;
  frontmatter?: Record<string, unknown>;
  metadata?: unknown;
  files: PublishFile[];
};

// Storage reads are round trips; a large ClawPack has thousands of files, and
// reading them one at a time takes minutes inside the action's 10-minute budget.
// Batches are bounded by count and by declared bytes so a run of 10 MiB files
// cannot materialize hundreds of MiB at once inside the 512 MiB Node action.
const STORAGE_READ_BATCH_FILES = 32;
const STORAGE_READ_BATCH_BYTES = 8 * 1024 * 1024;

export function planStorageReadBatches<T extends { size: number }>(files: readonly T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const file of files) {
    const overflows =
      current.length >= STORAGE_READ_BATCH_FILES ||
      (current.length > 0 && currentBytes + file.size > STORAGE_READ_BATCH_BYTES);
    if (overflows) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function readTextFile(
  ctx: Pick<ActionCtx, "storage">,
  file: PublishFile,
): Promise<{ path: string; content: string } | null> {
  const blob = await ctx.storage.get(file.storageId);
  if (!blob) throw new Error(`File missing in storage: ${file.path}`);
  const content = decodeUtf8Text(new Uint8Array(await blob.arrayBuffer()));
  return content === null ? null : { path: file.path, content };
}

export async function runStaticPublishScan(
  ctx: Pick<ActionCtx, "storage">,
  input: StaticPublishScanInput,
): Promise<StaticScanResult> {
  const fileContents: Array<{ path: string; content: string }> = [];
  for (const batch of planStorageReadBatches(input.files)) {
    const read = await Promise.all(batch.map((file) => readTextFile(ctx, file)));
    for (const entry of read) {
      if (entry !== null) fileContents.push(entry);
    }
  }

  return runStaticModerationScan({
    slug: input.slug,
    displayName: input.displayName,
    summary: input.summary,
    frontmatter: input.frontmatter ?? {},
    metadata: input.metadata,
    files: input.files.map((file) => ({ path: file.path, size: file.size })),
    fileContents,
  });
}
