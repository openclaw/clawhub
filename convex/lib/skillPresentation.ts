import { parseDocument } from "yaml";

export const OPENAI_SKILL_PRESENTATION_PATH = "agents/openai.yaml";
export const MAX_SKILL_PRESENTATION_YAML_BYTES = 64 * 1024;
export const MAX_SKILL_PRESENTATION_ICON_BYTES = 512 * 1024;
export const MAX_SKILL_PRESENTATION_DISPLAY_NAME_LENGTH = 120;
export const MAX_SKILL_PRESENTATION_SHORT_DESCRIPTION_LENGTH = 300;

const ICON_CONTENT_TYPES = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
} as const;
const PRESENTATION_EMOJI_PATTERN =
  /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200D|\uFE0F|\u20E3/gu;

export type OpenAiSkillPresentation = {
  displayName?: string;
  shortDescription?: string;
  iconPaths?: string[];
};

export type ResolvedSkillPresentation = {
  displayName: string;
  displayNameSource: "publisher" | "openai" | "skill" | "slug";
  summary?: string;
  summarySource?: "publisher" | "openai" | "skill" | "generated";
  iconPaths?: string[];
};

export function parseOpenAiSkillPresentation(
  raw: string | undefined | null,
): OpenAiSkillPresentation | null {
  if (!raw?.trim()) return null;
  if (new TextEncoder().encode(raw).byteLength > MAX_SKILL_PRESENTATION_YAML_BYTES) return null;

  try {
    const document = parseDocument(raw);
    if (document.errors.length > 0) return null;
    const parsed = document.toJS({ maxAliasCount: 20 }) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.interface)) return null;

    const interfaceMetadata = parsed.interface;
    const displayName = cleanText(
      interfaceMetadata.display_name,
      MAX_SKILL_PRESENTATION_DISPLAY_NAME_LENGTH,
    );
    const shortDescription = cleanText(
      interfaceMetadata.short_description,
      MAX_SKILL_PRESENTATION_SHORT_DESCRIPTION_LENGTH,
    );
    const iconPaths = [
      normalizeSkillPresentationPath(interfaceMetadata.icon_small),
      normalizeSkillPresentationPath(interfaceMetadata.icon_large),
    ].filter(
      (path, index, paths): path is string => Boolean(path) && paths.indexOf(path) === index,
    );

    if (!displayName && !shortDescription && iconPaths.length === 0) return null;
    return {
      ...(displayName ? { displayName } : {}),
      ...(shortDescription ? { shortDescription } : {}),
      ...(iconPaths.length > 0 ? { iconPaths } : {}),
    };
  } catch {
    return null;
  }
}

export function resolveSkillPresentation(args: {
  publisherDisplayName?: string | null;
  publisherSummary?: string | null;
  openAi?: OpenAiSkillPresentation | null;
  skillDisplayName?: string | null;
  skillDescription?: string | null;
  slug: string;
}): ResolvedSkillPresentation {
  const publisherDisplayName = cleanText(args.publisherDisplayName);
  const openAiDisplayName = cleanText(args.openAi?.displayName);
  const skillDisplayName = cleanText(args.skillDisplayName);
  const displayName = stripPresentationEmoji(
    publisherDisplayName ?? openAiDisplayName ?? skillDisplayName ?? titleizeSlug(args.slug),
  );
  const displayNameSource = displayName
    ? publisherDisplayName
      ? "publisher"
      : openAiDisplayName
        ? "openai"
        : skillDisplayName
          ? "skill"
          : "slug"
    : "slug";
  const publisherSummary = cleanText(args.publisherSummary);
  const openAiSummary = cleanText(args.openAi?.shortDescription);
  const skillSummary = cleanText(args.skillDescription);
  const summary = publisherSummary ?? openAiSummary ?? skillSummary;
  const summarySource = publisherSummary
    ? "publisher"
    : openAiSummary
      ? "openai"
      : skillSummary
        ? "skill"
        : undefined;
  const iconPaths = (args.openAi?.iconPaths ?? [])
    .map(normalizeSkillPresentationPath)
    .filter((path, index, paths): path is string => Boolean(path) && paths.indexOf(path) === index);

  return {
    displayName: displayName || titleizeSlug(args.slug),
    displayNameSource,
    ...(summary && summarySource ? { summary, summarySource } : {}),
    ...(iconPaths.length > 0 ? { iconPaths } : {}),
  };
}

export function normalizeSkillPresentationPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (!path || path.startsWith("/") || path.includes("\0")) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) return undefined;
  if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  if (/(?:^|\/)%2e(?:%2e)?(?:\/|$)/i.test(path)) return undefined;
  return path;
}

export function validateSkillPresentationIcon(args: {
  path: string;
  bytes: Uint8Array;
  contentType?: string | null;
}): { contentType: (typeof ICON_CONTENT_TYPES)[keyof typeof ICON_CONTENT_TYPES]; size: number } {
  const extension = iconExtension(args.path);
  if (!extension) throw new Error("Unsupported skill presentation icon type.");
  const expectedContentType = ICON_CONTENT_TYPES[extension];
  if (args.bytes.byteLength > MAX_SKILL_PRESENTATION_ICON_BYTES) {
    throw new Error("Skill presentation icon exceeds the 512KB limit.");
  }
  if (args.bytes.byteLength === 0) throw new Error("Skill presentation icon is empty.");

  const suppliedContentType = args.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (suppliedContentType && suppliedContentType !== expectedContentType) {
    throw new Error(`Skill presentation icon content type does not match ${extension}.`);
  }

  if (expectedContentType === "image/png" && !isStructurallyValidPng(args.bytes)) {
    throw new Error("Invalid PNG skill presentation icon.");
  }
  if (expectedContentType === "image/jpeg" && !isStructurallyValidJpeg(args.bytes)) {
    throw new Error("Invalid JPEG skill presentation icon.");
  }
  if (expectedContentType === "image/webp" && !isStructurallyValidWebp(args.bytes)) {
    throw new Error("Invalid WebP skill presentation icon.");
  }
  if (expectedContentType === "image/svg+xml") validateSafeSvg(args.bytes);

  return { contentType: expectedContentType, size: args.bytes.byteLength };
}

export function buildSkillPresentationIconPath(sha256: string) {
  const normalized = sha256.trim().toLowerCase();
  if (!/^[a-f\d]{64}$/.test(normalized)) throw new Error("A SHA-256 digest is required.");
  return `/api/v1/skill-icons/${normalized}`;
}

export function isHostedSkillPresentationIconPath(value: string | null | undefined) {
  return /^\/api\/v1\/skill-icons\/[a-f\d]{64}$/u.test(value?.trim() ?? "");
}

export function stripPresentationEmoji(value: string) {
  return value.replace(PRESENTATION_EMOJI_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function validateSafeSvg(bytes: Uint8Array) {
  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Invalid SVG skill presentation icon.");
  }
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(svg)) {
    throw new Error("Invalid SVG skill presentation icon.");
  }
  if (
    /<\/?(?:script|foreignObject|iframe|object|embed|audio|video)\b/i.test(svg) ||
    /\son[a-z]+\s*=/i.test(svg) ||
    /(?:javascript|vbscript)\s*:/i.test(svg) ||
    /<!DOCTYPE|<!ENTITY/i.test(svg) ||
    /\b(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/|data:)/i.test(svg)
  ) {
    throw new Error("Unsafe SVG skill presentation icon.");
  }
}

function iconExtension(path: string): keyof typeof ICON_CONTENT_TYPES | undefined {
  const match = /\.[a-z\d]+$/i.exec(path.trim());
  const extension = match?.[0]?.toLowerCase();
  return extension && Object.hasOwn(ICON_CONTENT_TYPES, extension)
    ? (extension as keyof typeof ICON_CONTENT_TYPES)
    : undefined;
}

function hasPrefix(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function isStructurallyValidPng(bytes: Uint8Array) {
  if (!hasPrefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return false;
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32Be(bytes, offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    const nextOffset = offset + 12 + length;
    if (nextOffset > bytes.byteLength) return false;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return false;
      if (readUint32Be(bytes, offset + 8) === 0 || readUint32Be(bytes, offset + 12) === 0) {
        return false;
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "IEND") {
      return length === 0 && sawImageData && nextOffset === bytes.byteLength;
    }
    offset = nextOffset;
  }
  return false;
}

function isStructurallyValidJpeg(bytes: Uint8Array) {
  if (
    bytes.byteLength < 12 ||
    !hasPrefix(bytes, [255, 216, 255]) ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  ) {
    return false;
  }
  let offset = 2;
  while (offset + 4 <= bytes.byteLength - 2) {
    if (bytes[offset] !== 255) return false;
    while (bytes[offset] === 255) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0 || marker === 255) return false;
    if (marker === 217) return false;
    if (marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.byteLength - 2) return false;
    const segmentLength = readUint16Be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength - 2) return false;
    if (isJpegStartOfFrame(marker)) {
      return (
        segmentLength >= 7 &&
        readUint16Be(bytes, offset + 3) > 0 &&
        readUint16Be(bytes, offset + 5) > 0
      );
    }
    offset += segmentLength;
  }
  return false;
}

function isStructurallyValidWebp(bytes: Uint8Array) {
  if (
    bytes.byteLength < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP" ||
    readUint32Le(bytes, 4) + 8 !== bytes.byteLength
  ) {
    return false;
  }
  const chunkType = ascii(bytes, 12, 16);
  const chunkLength = readUint32Le(bytes, 16);
  const paddedLength = chunkLength + (chunkLength % 2);
  if (20 + paddedLength > bytes.byteLength) return false;
  if (chunkType === "VP8X") return chunkLength >= 10;
  if (chunkType === "VP8L") return chunkLength >= 5 && bytes[20] === 47;
  return chunkType === "VP8 " && chunkLength >= 10;
}

function isJpegStartOfFrame(marker: number) {
  return marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker);
}

function readUint16Be(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32Be(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function readUint32Le(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function cleanText(value: unknown, maxLength?: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || (maxLength !== undefined && normalized.length > maxLength)) return undefined;
  return normalized;
}

function titleizeSlug(slug: string) {
  const title = slug
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
  return title || "Skill";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
