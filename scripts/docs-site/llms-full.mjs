#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ignoredDocDirs, ignoredDocFiles, localeLabels } from "./config.mjs";

const root = process.cwd();
const sourceRoot = process.env.DOCS_SOURCE_REPO_DIR
  ? path.resolve(root, process.env.DOCS_SOURCE_REPO_DIR)
  : root;
const docsDir = path.join(sourceRoot, "docs");
const outputDir = path.join(root, "dist", "docs-llms-full");
const manifestPath = path.join(root, "dist", "docs-llms-full-manifest.json");
const canonicalOrigin = (
  process.env.DOCS_SITE_CANONICAL_ORIGIN ??
  (process.env.DOCS_SITE_CNAME
    ? `https://${process.env.DOCS_SITE_CNAME}`
    : "https://docs.openclaw.ai")
).replace(/\/$/, "");
if (!fs.existsSync(docsDir))
  throw new Error(`missing docs source directory: ${path.relative(root, docsDir) || docsDir}`);

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outputDir, ".well-known"), { recursive: true });

const pages = collectEnglishPages().sort((a, b) => a.slug.localeCompare(b.slug));
if (!pages.length)
  throw new Error(`no English docs pages found in ${path.relative(root, docsDir) || docsDir}`);
const content = renderLlmsFull(pages);
const rootFile = path.join(outputDir, "llms-full.txt");
const wellKnownFile = path.join(outputDir, ".well-known", "llms-full.txt");

fs.writeFileSync(rootFile, content, "utf8");
fs.writeFileSync(wellKnownFile, content, "utf8");
writeManifest([
  entryFor("llms-full.txt", rootFile),
  entryFor(".well-known/llms-full.txt", wellKnownFile),
]);

console.log(
  `llms-full ok: ${pages.length} pages, ${content.length} chars, ${path.relative(root, outputDir)}`,
);

function collectEnglishPages() {
  const result = [];
  for (const file of walkDocs(docsDir)) {
    const rel = path.relative(docsDir, file).replaceAll(path.sep, "/");
    if (ignoredDocFiles.has(rel) || rel.endsWith("/AGENTS.md")) continue;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = parseFrontmatter(raw);
    const slug = fileSlug(rel);
    result.push({
      slug,
      file,
      rel,
      title: parsed.data.title || firstHeading(parsed.content) || titleize(path.basename(slug)),
      body: parsed.content,
    });
  }
  return result;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, content: raw };
  const data = {};
  const frontmatter = match[1].split("\n");
  for (const line of frontmatter) {
    const property = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!property) continue;
    data[property[1]] = unquoteYamlScalar(property[2]);
  }
  return { data, content: raw.slice(match[0].length).replace(/^\n+/, "") };
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function walkDocs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    if (entry.isDirectory() && (ignoredDocDirs.has(entry.name) || localeLabels[entry.name]))
      return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkDocs(full);
    return /\.(md|mdx)$/.test(entry.name) ? [full] : [];
  });
}

function renderLlmsFull(pages) {
  const blocks = pages.map((page) =>
    [
      `# ${page.title}`,
      `Source: ${docsOrigin()}${pageRoute(page)}`,
      "",
      stripMdxForLlms(page.body).trim(),
    ].join("\n"),
  );
  return `${blocks.join("\n\n---\n\n")}\n`;
}

function writeManifest(entries) {
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourceMetadata(),
    sourceDir: path.relative(root, docsDir).replaceAll(path.sep, "/") || "docs",
    outputDir: "dist/docs-llms-full",
    objectCount: entries.length,
    entries,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function entryFor(key, file) {
  const data = fs.readFileSync(file);
  return {
    key,
    sourceKey: key,
    file: path.relative(root, file).replaceAll(path.sep, "/"),
    size: data.byteLength,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    contentType: "text/plain; charset=utf-8",
    cacheControl: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  };
}

function stripMdxForLlms(input) {
  return input
    .replace(/^import\s+.+?;?\s*$/gm, "")
    .replace(/<([A-Z][A-Za-z0-9_.-]*)([^>]*)\/>/g, (_, name, attrs) => componentLabel(name, attrs))
    .replace(/<([A-Z][A-Za-z0-9_.-]*)([^>]*)>/g, (_, name, attrs) => componentLabel(name, attrs))
    .replace(/<\/[A-Z][A-Za-z0-9_.-]*>/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function componentLabel(name, attrs) {
  const parsed = Object.fromEntries(
    [...String(attrs).matchAll(/([A-Za-z0-9_-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
      match[1],
      match[2] ?? match[3] ?? "",
    ]),
  );
  const label = parsed.title ?? parsed.name ?? parsed.href ?? "";
  return label ? `\n${label}\n` : `\n${name}\n`;
}

function docsOrigin() {
  return (canonicalOrigin || "https://docs.openclaw.ai").replace(/\/$/, "");
}

function pageRoute(page) {
  return page.slug === "index" ? "/" : `/${page.slug}`;
}

function sourceMetadata() {
  const repositoryFromEnv = process.env.DOCS_SOURCE_REPO_URL
    ? process.env.DOCS_SOURCE_REPO_URL.replace(/^https:\/\/github\.com\//, "")
    : null;
  if (repositoryFromEnv || process.env.DOCS_SOURCE_SHA) {
    return {
      repository: repositoryFromEnv,
      sha: process.env.DOCS_SOURCE_SHA ?? null,
      syncedAt: null,
    };
  }
  const file = path.join(root, ".openclaw-sync", "source.json");
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    repository: data.repository ?? data.sources?.openclaw?.repository ?? null,
    sha: data.sha ?? data.sources?.openclaw?.sha ?? null,
    syncedAt: data.syncedAt ?? null,
  };
}

function fileSlug(rel) {
  return normalizeSlug(rel.replace(/\.(md|mdx)$/, ""));
}

function normalizeSlug(value) {
  return value.replace(/\/index$/, "") || "index";
}

function firstHeading(markdown) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
  return heading === undefined ? undefined : textFromHtml(heading).trim();
}

function titleize(value) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function textFromHtml(value) {
  let text = "";
  let inTag = false;
  for (const char of String(value)) {
    if (char === "<") {
      inTag = true;
      continue;
    }
    if (char === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) text += char;
  }
  return text;
}
