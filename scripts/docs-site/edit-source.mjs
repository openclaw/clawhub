import fs from "node:fs";
import path from "node:path";

const defaultSourceRepositories = {
  openclaw: "openclaw/openclaw",
  clawhub: "openclaw/clawhub",
};

export function readSourceMetadata(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".openclaw-sync", "source.json"), "utf8"));
  } catch {
    return {};
  }
}

export function frontmatterSourcePath(data) {
  const sourcePath = data?.["x-i18n"]?.source_path;
  return typeof sourcePath === "string" ? normalizeDocRel(sourcePath) : "";
}

export function editSourceUrlForPage(page, sourceMetadata = {}) {
  const target = editSourceTargetForPage(page, sourceMetadata);
  if (!target) return "";
  return `https://github.com/${target.repository}/edit/main/${encodePath(target.path)}`;
}

export function editSourceTargetForPage(page, sourceMetadata = {}) {
  if (page?.hidden) return null;

  const rel = normalizeDocRel(page?.sourcePath || page?.rel || "");
  if (!rel || rel.startsWith(".") || rel.includes("\0")) return null;

  if (rel === "clawhub/index.md" || rel.startsWith("clawhub/")) {
    const sourcePath = clawHubSourcePath(rel);
    if (!sourcePath) return null;
    return {
      owner: "clawhub",
      repository: sourceRepository(sourceMetadata, "clawhub"),
      path: `docs/${sourcePath}`,
    };
  }

  return {
    owner: "openclaw",
    repository: sourceRepository(sourceMetadata, "openclaw"),
    path: `docs/${rel}`,
  };
}

function sourceRepository(sourceMetadata, source) {
  return normalizeRepositorySlug(
    sourceMetadata?.sources?.[source]?.repository ||
      (source === "openclaw" ? sourceMetadata?.repository : ""),
    defaultSourceRepositories[source],
  );
}

function clawHubSourcePath(rel) {
  const inner = rel.slice("clawhub/".length);
  if (!inner) return "";
  if (/^index\.mdx?$/iu.test(inner)) return "clawhub.md";
  return inner.replace(/\/index\.mdx?$/iu, "/README.md");
}

function normalizeDocRel(value) {
  const normalized = String(value).replaceAll("\\", "/").replace(/^\/+/, "");
  const collapsed = path.posix.normalize(normalized);
  return collapsed === "." || collapsed.startsWith("../") ? "" : collapsed;
}

function normalizeRepositorySlug(value, fallback) {
  const raw = String(value || "")
    .trim()
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "");
  const githubMatch = raw.match(/github\.com[:/]([^/\s]+\/[^/\s]+)$/u);
  const slug = githubMatch?.[1] ?? raw;
  return /^[^/\s]+\/[^/\s]+$/u.test(slug) ? slug : fallback;
}

function encodePath(value) {
  return String(value).split("/").map(encodeURIComponent).join("/");
}
