import type { Root } from "mdast";
import { visit } from "unist-util-visit";

type SkillReadmeLinkOptions = {
  readmePath?: string;
  skillSlug: string;
};

type MarkdownUrlNode = {
  type: string;
  url: string;
};

const ALLOWED_ABSOLUTE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function isMarkdownUrlNode(node: unknown): node is MarkdownUrlNode {
  if (!node || typeof node !== "object") return false;
  const maybeNode = node as { type?: unknown; url?: unknown };
  return (
    (maybeNode.type === "definition" || maybeNode.type === "image" || maybeNode.type === "link") &&
    typeof maybeNode.url === "string"
  );
}

function splitReference(reference: string) {
  const hashIndex = reference.indexOf("#");
  const beforeHash = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference;
  const hash = hashIndex >= 0 ? reference.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  return {
    hash,
    path: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
  };
}

function hasUnsafePathSyntax(path: string) {
  if (!path || path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return true;
  if (path.includes("..")) return true;

  try {
    const decoded = decodeURIComponent(path);
    return decoded.includes("..") || decoded.includes("\\") || decoded.startsWith("/");
  } catch {
    return true;
  }
}

function normalizeRelativePath(path: string) {
  if (hasUnsafePathSyntax(path)) return null;
  const parts = path.split("/").filter((part) => part && part !== ".");
  return parts.join("/");
}

function resolveReadmeRelativePath(readmePath: string, targetPath: string) {
  const normalizedReadmePath = normalizeRelativePath(readmePath);
  const normalizedTargetPath = normalizeRelativePath(targetPath);
  if (!normalizedReadmePath || !normalizedTargetPath) return null;

  const baseDir = normalizedReadmePath.split("/").slice(0, -1);
  return baseDir.concat(normalizedTargetPath.split("/")).filter(Boolean).join("/");
}

export function rewriteSkillReadmeMarkdownUrl(reference: string, options: SkillReadmeLinkOptions) {
  const trimmed = reference.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return reference;

  if (SCHEME_RE.test(trimmed)) {
    const scheme = trimmed.slice(0, trimmed.indexOf(":") + 1).toLowerCase();
    return ALLOWED_ABSOLUTE_SCHEMES.has(scheme) ? reference : null;
  }

  const { hash, path } = splitReference(trimmed);
  const resolvedPath = resolveReadmeRelativePath(options.readmePath ?? "SKILL.md", path);
  if (!resolvedPath) return null;

  return `/api/v1/skills/${encodeURIComponent(options.skillSlug)}/file?path=${encodeURIComponent(
    resolvedPath,
  )}${hash}`;
}

export function sanitizeRenderedSkillReadmeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return url;

  if (SCHEME_RE.test(trimmed)) {
    const scheme = trimmed.slice(0, trimmed.indexOf(":") + 1).toLowerCase();
    return ALLOWED_ABSOLUTE_SCHEMES.has(scheme) ? url : "";
  }

  return "";
}

export function remarkSkillReadmeLinks(options: SkillReadmeLinkOptions) {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (!isMarkdownUrlNode(node)) return;
      node.url = rewriteSkillReadmeMarkdownUrl(node.url, options) ?? "";
    });
  };
}
