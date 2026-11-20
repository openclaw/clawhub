import type { TemplateManifest } from "clawhub-schema";
import { isSafeTemplatePackagePath, portablePathKey } from "clawhub-schema/templatePaths";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { storeSkillPresentationAsset } from "../skillPresentationAssets";
import { sha256Hex } from "./hash";
import {
  buildSkillPresentationIconPath,
  MAX_SKILL_PRESENTATION_ICON_BYTES,
} from "./skillPresentation";

type AvatarFormat = "png" | "jpeg" | "webp" | "gif" | "svg";
type Artwork = { bytes: Uint8Array<ArrayBuffer>; format: AvatarFormat };
type ArchiveFile = { path: string; size: number; sha256: string; storageId: string };
type Context = Pick<ActionCtx, "storage" | "runAction" | "runMutation" | "runQuery">;
const INPUT_LIMIT = MAX_SKILL_PRESENTATION_ICON_BYTES;

function formatOf(suffix: string): AvatarFormat | undefined {
  switch (suffix.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "svg+xml":
    case "svg":
      return "svg";
    case "gif":
      return "gif";
    case "png":
      return "png";
    case "webp":
      return "webp";
    default:
      return undefined;
  }
}

function inlineAvatar(avatar: string): Artwork | undefined {
  // Bound the encoded input BEFORE slicing or decoding. Escaped UTF-8 uses up to three chars/byte.
  if (avatar.length > 3 * INPUT_LIMIT + 64) return undefined;
  const comma = avatar.indexOf(",");
  if (comma < 0 || comma > 64) return undefined;
  const metadata = /^data:image\/(png|jpeg|webp|gif|svg\+xml)(?:;charset=utf-8)?(;base64)?$/i.exec(
    avatar.slice(0, comma),
  );
  if (!metadata) return undefined;
  const format = formatOf(metadata[1]);
  if (!format) return undefined;
  const payload = avatar.slice(comma + 1);
  if (!payload) return undefined;
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    if (metadata[2]) {
      if (
        payload.length > 4 * Math.ceil(INPUT_LIMIT / 3) ||
        payload.length % 4 ||
        !/^[a-z\d+/]+={0,2}$/i.test(payload)
      )
        return undefined;
      const decoded = atob(payload);
      if (decoded.length > INPUT_LIMIT || btoa(decoded) !== payload) return undefined;
      bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    return bytes.length > 0 && bytes.length <= INPUT_LIMIT ? { format, bytes } : undefined;
  } catch {
    return undefined;
  }
}

async function avatarSource(
  ctx: Pick<Context, "storage">,
  manifest: TemplateManifest,
  files: readonly ArchiveFile[],
): Promise<Artwork | undefined> {
  const avatar = manifest.agent.identity?.avatar;
  if (!avatar) return undefined;
  if (/^data:/i.test(avatar)) return inlineAvatar(avatar);
  // Installed avatar paths name a workspace destination, NOT an archive entry. Match the
  // Template schema's portable key, then read only the declared, exact package source.
  if (!isSafeTemplatePackagePath(avatar.replaceAll("\\", "/"))) return undefined;
  const format = formatOf(/\.(png|jpe?g|webp|gif|svg)$/i.exec(avatar)?.[1] ?? "");
  if (!format) return undefined;
  const key = portablePathKey(avatar);
  const destinations = manifest.workspace?.files?.filter(
    (entry) => portablePathKey(entry.path) === key,
  );
  if (
    !destinations ||
    destinations.length !== 1 ||
    !isSafeTemplatePackagePath(destinations[0].source)
  )
    return undefined;
  const file = files.find((entry) => entry.path === destinations[0].source);
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > INPUT_LIMIT)
    return undefined;
  const blob = await ctx.storage.get(file.storageId as Id<"_storage">);
  if (!blob || blob.size !== file.size) return undefined;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if ((await sha256Hex(bytes)) !== file.sha256.toLowerCase()) return undefined;
  return { format, bytes };
}

/** Template-only fallback after assets/icon.png. Dry runs compute exactly the hosted path without writes. */
export async function resolveTemplateAvatarArtwork(
  ctx: Context,
  args: { manifest: TemplateManifest; files: readonly ArchiveFile[]; dryRun?: boolean },
): Promise<string | undefined> {
  const artwork = await avatarSource(ctx, args.manifest, args.files);
  if (!artwork) return undefined;
  const png: ArrayBuffer | null = await ctx.runAction(
    internal.lib.templateAvatarArtworkNode.renderPngInternal,
    { bytes: artwork.bytes.buffer, format: artwork.format },
  );
  if (!png) return undefined;
  const bytes = new Uint8Array(png);
  const sha256 = await sha256Hex(bytes);
  return args.dryRun
    ? buildSkillPresentationIconPath(sha256)
    : storeSkillPresentationAsset(ctx, { bytes, sha256, contentType: "image/png" });
}
