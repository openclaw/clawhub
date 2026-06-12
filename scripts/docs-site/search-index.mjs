#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mintlifyLocaleToDir } from "./config.mjs";

const root = process.cwd();
const site = path.join(root, "dist", "docs-site");
const outPath = path.join(site, "docs-search.json");
const basePath = normalizeBasePath(process.env.DOCS_SITE_BASE_PATH ?? "");
const maxBodyChars = 12_000;
const localeDirs = new Set(Object.values(mintlifyLocaleToDir));
const excludedTopLevel = new Set(["__elements", "assets", "og", "pagefind"]);
const excludedFiles = new Set(["AGENTS.md", "CLAUDE.md", "__elements.md", "docs.json"]);

if (!fs.existsSync(site)) {
  throw new Error("dist/docs-site does not exist; run docs-site/build.mjs first");
}

const entries = [];
for (const file of walk(site)) {
  const rel = toKey(path.relative(site, file));
  if (!rel.endsWith(".md")) continue;
  const parts = rel.split("/");
  const basename = path.basename(rel);
  const topLevelLocaleMarkdown =
    parts.length === 1 && localeDirs.has(basename.replace(/\.md$/u, ""));
  if (
    localeDirs.has(parts[0]) ||
    topLevelLocaleMarkdown ||
    excludedTopLevel.has(parts[0]) ||
    excludedFiles.has(basename)
  ) {
    continue;
  }

  const raw = fs.readFileSync(file, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const title = frontmatter.title || headingTitle(body) || titleFromPath(rel);
  const summary = frontmatter.summary || firstParagraph(body);
  const route = routeForMarkdown(rel);
  const searchable = normalizeSearchText([title, summary, body].filter(Boolean).join("\n\n"));
  if (!searchable) continue;

  entries.push({
    title,
    url: route,
    snippet: clip(normalizeSnippet(summary || firstParagraph(body)), 260),
    search: clip(searchable, maxBodyChars),
  });
}

entries.sort((a, b) => a.url.localeCompare(b.url));

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: entries.length,
  entries,
};
const json = `${JSON.stringify(payload)}\n`;
fs.writeFileSync(outPath, json, "utf8");
const bytes = Buffer.byteLength(json);
const sha256 = crypto.createHash("sha256").update(json).digest("hex");
console.log(
  `docs search index ok: ${entries.length} entries, ${Math.round(bytes / 1024)} KiB, sha256=${sha256.slice(0, 12)}`,
);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function parseFrontmatter(raw) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const field = /^(title|summary):\s*(.*)$/u.exec(line.trim());
    if (!field) continue;
    frontmatter[field[1]] = field[2].replace(/^["']|["']$/g, "").trim();
  }
  return { frontmatter, body: raw.slice(match[0].length) };
}

function headingTitle(body) {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? "";
}

function titleFromPath(rel) {
  const base = rel.replace(/\.md$/u, "").split("/").pop() || "Docs";
  return base
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function firstParagraph(body) {
  const withoutMdx = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#+\s+.*$/gm, " ");
  return (
    withoutMdx
      .split(/\n\s*\n/)
      .map((part) => normalizeSnippet(part))
      .find(Boolean) ?? ""
  );
}

function routeForMarkdown(rel) {
  const route = rel.replace(/\.md$/u, "").replace(/\/index$/u, "");
  if (route === "index") return publicPath("/");
  return publicPath(`/${route || ""}`);
}

function publicPath(value) {
  if (!basePath) return value;
  if (value === "/") return `${basePath}/`;
  return `${basePath}${value.startsWith("/") ? value : `/${value}`}`;
}

function normalizeBasePath(value) {
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeSearchText(value) {
  return normalizeSnippet(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2"),
  );
}

function normalizeSnippet(value) {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value, max) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trimEnd()}...`;
}

function toKey(value) {
  return value.split(path.sep).join("/");
}
