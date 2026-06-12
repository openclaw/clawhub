#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { localeLabels } from "./config.mjs";

const root = process.cwd();
const site = path.join(root, "dist", "docs-site");
const pagefindDir = path.join(site, "pagefind");
const tempSearchSite = path.join(root, "dist", "pagefind-en-site");
const cloudflareFreeFileLimit = 20_000;
const nonEnglishLocales = Object.keys(localeLabels).filter((locale) => locale !== "en");

if (!fs.existsSync(site)) throw new Error("dist/docs-site does not exist; run docs:build first");

removeJunkFiles(site);
removeLocalizedMarkdown(site);
rebuildEnglishSearch();
writeStaticAssetHeaders();

const fileCount = countFiles(site);
if (fileCount > cloudflareFreeFileLimit) {
  throw new Error(
    `Cloudflare static assets file count is ${fileCount}, above ${cloudflareFreeFileLimit}`,
  );
}

console.log(`cloudflare prune ok: ${fileCount} files`);

function removeJunkFiles(dir) {
  for (const file of walk(dir)) {
    if (path.basename(file) === ".DS_Store") fs.rmSync(file, { force: true });
  }
}

function removeLocalizedMarkdown(dir) {
  for (const locale of nonEnglishLocales) {
    fs.rmSync(path.join(dir, `${locale}.md`), { force: true });
    const localeDir = path.join(dir, locale);
    if (!fs.existsSync(localeDir)) continue;
    for (const file of walk(localeDir)) {
      if (file.endsWith(".md")) fs.rmSync(file, { force: true });
    }
  }
}

function rebuildEnglishSearch() {
  fs.rmSync(pagefindDir, { recursive: true, force: true });
  fs.rmSync(tempSearchSite, { recursive: true, force: true });
  fs.mkdirSync(tempSearchSite, { recursive: true });

  const localeSet = new Set(nonEnglishLocales);
  for (const file of walk(site)) {
    if (!file.endsWith(".html")) continue;
    const rel = path.relative(site, file);
    const firstSegment = rel.split(path.sep)[0];
    if (localeSet.has(firstSegment)) continue;
    linkOrCopy(file, path.join(tempSearchSite, rel));
  }

  const pagefindBin = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pagefind.cmd" : "pagefind",
  );
  const result = spawnSync(
    pagefindBin,
    ["--site", tempSearchSite, "--output-path", pagefindDir, "--quiet"],
    { stdio: "inherit" },
  );
  fs.rmSync(tempSearchSite, { recursive: true, force: true });
  if (result.status !== 0)
    throw new Error(`pagefind failed with status ${result.status ?? "unknown"}`);
}

function writeStaticAssetHeaders() {
  fs.writeFileSync(
    path.join(site, "_headers"),
    [
      "/assets/docs-site.css",
      "  Cache-Control: public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
      "",
      "/assets/docs-site.js",
      "  Cache-Control: public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
      "",
      "/assets/*",
      "  Cache-Control: public, max-age=31536000, immutable",
      "",
      "/pagefind/*",
      "  Cache-Control: public, max-age=31536000, immutable",
      "",
      "/*.html",
      "  Cache-Control: public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
      "",
      "/*.md",
      "  Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "",
      "/*.txt",
      "  Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "",
      "/*.json",
      "  Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "",
      "/*.jsonl",
      "  Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "",
    ].join("\n"),
  );
}

function linkOrCopy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
}

function countFiles(dir) {
  let count = 0;
  for (const file of walk(dir)) {
    if (fs.statSync(file).isFile()) count += 1;
  }
  return count;
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
