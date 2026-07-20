import { decodeUtf8Text } from "clawhub-schema";
import type { ActionCtx } from "../_generated/server";
import { runStaticModerationScan, type StaticScanResult } from "./moderationEngine";

const MAX_STATIC_SCAN_TEXT_FILES = 200;
const MAX_STATIC_SCAN_TEXT_FILE_BYTES = 256 * 1024;

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
    if (fileContents.length >= MAX_STATIC_SCAN_TEXT_FILES) break;
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) throw new Error(`File missing in storage: ${file.path}`);
    if (blob.size > MAX_STATIC_SCAN_TEXT_FILE_BYTES) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const content = decodeUtf8Text(bytes);
    if (content === null) continue;
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
