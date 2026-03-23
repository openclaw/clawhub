import type { ActionCtx } from "../_generated/server";
import { runStaticModerationScan, type StaticScanResult } from "./moderationEngine";
import { readStorageText } from "./packageRegistry";
import { isTextFile } from "./skills";

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

export async function runStaticPublishScan(
  ctx: Pick<ActionCtx, "storage">,
  input: StaticPublishScanInput,
): Promise<StaticScanResult> {
  const fileContents: Array<{ path: string; content: string }> = [];
  for (const file of input.files) {
    if (!isTextFile(file.path, file.contentType ?? undefined)) continue;
    const content = await readStorageText(ctx, file.storageId);
    fileContents.push({ path: file.path, content });
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
