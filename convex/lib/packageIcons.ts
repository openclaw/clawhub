import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  isDecodableSkillPresentationRaster,
  storeSkillPresentationAsset,
} from "../skillPresentationAssets";
import { sha256Hex } from "./clawpack";
import {
  buildSkillPresentationIconPath,
  MAX_SKILL_PRESENTATION_ICON_BYTES,
  validateSkillPresentationIcon,
} from "./skillPresentation";

const PORTABLE_PLUGIN_ICON = "assets/icon.png";
type IconContext = Pick<ActionCtx, "storage" | "runAction" | "runQuery" | "runMutation">;
type IconSource = Pick<
  NonNullable<Doc<"packageReleases">["verification"]>,
  "sourceRepo" | "sourceCommit" | "sourcePath"
>;

export function bundledPluginIconSourceUrl(source: IconSource | undefined) {
  if (
    source?.sourceRepo !== "openclaw/openclaw" ||
    !/^[a-f\d]{40}$/i.test(source.sourceCommit ?? "") ||
    !/^extensions\/[a-z0-9][a-z0-9-]*$/.test(source.sourcePath ?? "")
  )
    return undefined;
  return `https://raw.githubusercontent.com/openclaw/openclaw/${source.sourceCommit}/${source.sourcePath}/${PORTABLE_PLUGIN_ICON}`;
}

/** Use the same fixed asset convention as OpenClaw; never interpret a manifest path as a URL. */
export async function resolvePackageIcon(
  ctx: IconContext,
  args: {
    files: Array<{ path: string; size: number; sha256: string; storageId: string }>;
    trustedSource?: IconSource;
    dryRun?: boolean;
  },
): Promise<string | undefined> {
  const file = args.files.find((entry) => entry.path === PORTABLE_PLUGIN_ICON);
  let bytes: Uint8Array;
  if (file) {
    if (file.size > MAX_SKILL_PRESENTATION_ICON_BYTES) return undefined;
    const blob = await ctx.storage.get(file.storageId as Id<"_storage">);
    if (!blob) throw new ConvexError("Plugin icon could not be read. Please retry.");
    if (blob.size > MAX_SKILL_PRESENTATION_ICON_BYTES) return undefined;
    bytes = new Uint8Array(await blob.arrayBuffer());
    if ((await sha256Hex(bytes)) !== file.sha256.toLowerCase()) {
      throw new ConvexError("Plugin icon changed during upload. Please retry.");
    }
  } else {
    // Older official npm archives omitted assets despite recording a source commit that has them.
    const sourceUrl = bundledPluginIconSourceUrl(args.trustedSource);
    if (!sourceUrl) return undefined;
    const downloaded = await fetchBundledIcon(sourceUrl);
    if (!downloaded) return undefined;
    bytes = downloaded;
  }

  try {
    // npm archives commonly label every entry application/octet-stream; validate the bytes.
    validateSkillPresentationIcon({ path: PORTABLE_PLUGIN_ICON, bytes });
  } catch {
    return undefined;
  }
  if (!(await isDecodableSkillPresentationRaster(ctx, { bytes, contentType: "image/png" })))
    return undefined;
  const sha256 = await sha256Hex(bytes);
  if (args.dryRun) return buildSkillPresentationIconPath(sha256);
  // Reuse the content-addressed raster store and serving route already used for catalog icons.
  return storeSkillPresentationAsset(ctx, { bytes, sha256, contentType: "image/png" });
}

async function fetchBundledIcon(url: string): Promise<Uint8Array | undefined> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Bundled plugin icon fetch failed (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SKILL_PRESENTATION_ICON_BYTES) return undefined;
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
