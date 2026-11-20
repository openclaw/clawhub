import { parse as parseYaml } from "yaml";
// Skill markdown, path and embedding helpers that need no schema validation library.
import { toHex } from "./fileHash";
import { getFrontmatterValue, type ParsedSkillFrontmatter } from "./frontmatterValue";

export type ParsedSkillMarkdown = {
  frontmatter: ParsedSkillFrontmatter;
  body: string;
};

const DEFAULT_EMBEDDING_MAX_CHARS = 12_000;
// Each OpenAI token maps to at least one UTF-8 byte; keep publish embeddings
// below the 8192-token model limit with conservative headroom.
const DEFAULT_EMBEDDING_MAX_BYTES = 7_500;

const encoder = new TextEncoder();

export function parseSkillMarkdown(content: string): ParsedSkillMarkdown {
  const frontmatter: ParsedSkillFrontmatter = {};
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutFrontmatter = { frontmatter, body: normalized };
  const lines = normalized.split("\n");
  if (!isFrontmatterDelimiter(lines[0])) return withoutFrontmatter;
  const closingLineIndex = lines.findIndex(
    (line, index) => index > 0 && isFrontmatterDelimiter(line),
  );
  if (closingLineIndex === -1) return withoutFrontmatter;
  const block = lines.slice(1, closingLineIndex).join("\n");

  try {
    const parsed = parseYaml(block) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return withoutFrontmatter;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[\w-]+$/.test(key)) continue;
      const jsonValue = toJsonValue(value);
      if (jsonValue !== undefined) frontmatter[key] = jsonValue;
    }
  } catch {
    return withoutFrontmatter;
  }

  return {
    frontmatter,
    body: lines.slice(closingLineIndex + 1).join("\n"),
  };
}

function isFrontmatterDelimiter(line: string | undefined) {
  return line !== undefined && /^---[\t ]*$/.test(line);
}

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  return parseSkillMarkdown(content).frontmatter;
}

export function getFrontmatterMetadata(frontmatter: ParsedSkillFrontmatter) {
  const raw = frontmatter.metadata;
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      // Strip trailing commas in JSON objects/arrays (common authoring mistake)
      const cleaned = raw.replace(/,\s*([\]}])/g, "$1");
      const parsed = JSON.parse(cleaned) as unknown;
      return parsed ?? undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw;
  return undefined;
}

export function isMacJunkPath(path: string) {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.includes("__macosx")) return true;
  const basename = segments.at(-1) ?? "";
  if (basename === ".ds_store") return true;
  if (basename.startsWith("._")) return true;
  return false;
}

export function sanitizePath(path: string) {
  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\\")) {
    return null;
  }
  return trimmed;
}

export function buildEmbeddingText(params: {
  frontmatter: ParsedSkillFrontmatter;
  readme: string;
  otherFiles: Array<{ path: string; content: string }>;
  maxChars?: number;
  maxBytes?: number;
}) {
  const {
    frontmatter,
    readme,
    otherFiles,
    maxChars = DEFAULT_EMBEDDING_MAX_CHARS,
    maxBytes = DEFAULT_EMBEDDING_MAX_BYTES,
  } = params;
  const headerParts = [
    getFrontmatterValue(frontmatter, "name"),
    getFrontmatterValue(frontmatter, "description"),
    getFrontmatterValue(frontmatter, "homepage"),
    getFrontmatterValue(frontmatter, "website"),
    getFrontmatterValue(frontmatter, "url"),
    getFrontmatterValue(frontmatter, "emoji"),
  ].filter(Boolean);
  const fileParts = otherFiles.map((file) => `# ${file.path}\n${file.content}`);
  const raw = [headerParts.join("\n"), readme, ...fileParts].filter(Boolean).join("\n\n");
  const charLimited = truncateCodePoints(raw, maxChars);
  return truncateUtf8Bytes(charLimited, maxBytes);
}

export async function buildPackageInventoryDigest(
  files: Array<{ path: string; sha256: string; size: number }>,
) {
  const payload = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\0${file.size}\0${file.sha256.toLowerCase()}`)
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  return toHex(new Uint8Array(digest));
}

function truncateCodePoints(text: string, maxChars: number) {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;

  let count = 0;
  let end = 0;
  for (const char of text) {
    if (count >= maxChars) break;
    end += char.length;
    count += 1;
  }
  return end >= text.length ? text : text.slice(0, end);
}

function truncateUtf8Bytes(text: string, maxBytes: number) {
  if (maxBytes <= 0) return "";
  if (encoder.encode(text).byteLength <= maxBytes) return text;

  const codePointEnds: number[] = [];
  let end = 0;
  for (const char of text) {
    end += char.length;
    codePointEnds.push(end);
  }

  let low = 0;
  let high = codePointEnds.length;
  let bestEnd = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateEnd = mid === 0 ? 0 : codePointEnds[mid - 1];
    const candidateBytes = encoder.encode(text.slice(0, candidateEnd)).byteLength;
    if (candidateBytes <= maxBytes) {
      bestEnd = candidateEnd;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, bestEnd);
}

function toJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmedEnd = value.trimEnd();
    return trimmedEnd.trim() ? trimmedEnd : undefined;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const next = toJsonValue(entry);
      return next === undefined ? null : next;
    });
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const next = toJsonValue(entry);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
