#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const site = path.join(repoRoot, "public", "docs");

const index = read("index.html");
const quickstart = read("quickstart/index.html");
const siteJs = read("assets/docs-site.js");
const cli = read("cli/index.html");
const pluginValidationFixes = read("plugin-validation-fixes/index.html");
const llms = read("llms.txt");
const robots = read("robots.txt");
const searchIndex = JSON.parse(read("docs-search.json"));
const sourceIndexMeta = JSON.parse(read("source-index-meta.json"));

assert(
  index.includes("<title>ClawHub - ClawHub</title>"),
  "index should render ClawHub as the docs home",
);
assert(
  index.includes('href="https://clawhub.ai/docs/"'),
  "index should use clawhub.ai/docs canonical URL",
);
assert(
  index.includes('href="/docs/quickstart"'),
  "index should link to the quickstart child route",
);
assert(
  !fs.existsSync(path.join(site, "clawhub", "index.html")),
  "home page should not publish /docs/clawhub",
);
assert(
  !fs.existsSync(path.join(site, "README", "index.html")),
  "README.md should not publish as a docs page",
);
assert(!fs.existsSync(path.join(site, "specs")), "specs should not publish under /docs");
assert(
  fs.existsSync(path.join(site, "assets", "pixel-lobster.svg")),
  "docs assets should be copied",
);
assert(quickstart.includes("Quickstart"), "quickstart child route should render");
assert(index.includes("Ask Molty"), "Ask Molty widget should render");
assert(index.includes("ClawHub docs assistant"), "Ask Molty should use the ClawHub chat label");
assert(
  siteJs.includes('new URL("/auth/docs",location.href)'),
  "Ask Molty auth should use ClawHub /auth/docs",
);
assert(
  !siteJs.includes("https://hub.openclaw.ai/docs/auth"),
  "Ask Molty auth should not use OpenClaw hub",
);
assert(
  index.includes("Search ClawHub docs..."),
  "search placeholder should come from ClawHub docs config",
);
assert(
  index.includes("Publish a package"),
  "search suggestions should come from ClawHub docs config",
);
assert(
  index.includes("https://github.com/openclaw/clawhub/edit/main/docs/clawhub.md"),
  "home page edit link should point back to ClawHub source docs",
);
assert(
  !index.includes("https://github.com/openclaw/openclaw"),
  "ClawHub docs should not render OpenClaw repo links in the header or edit links",
);
assert(
  llms.includes("ClawHub documentation") && !llms.includes("OpenClaw documentation"),
  "llms.txt should describe the ClawHub docs corpus",
);
assert(
  /https:\/\/clawhub\.ai\/docs\/[^)\s]+\.md/u.test(llms) &&
    !llms.includes("/start/getting-started.md"),
  "llms.txt should advertise a real ClawHub Markdown page",
);
assert(
  robots.includes("# ClawHub documentation crawler policy") &&
    robots.includes("Sitemap: https://clawhub.ai/docs/sitemap.xml") &&
    !robots.includes("OpenClaw documentation crawler policy"),
  "robots.txt should use ClawHub docs metadata",
);
assert(
  pluginValidationFixes.includes('href="/docs/plugin-validation-fixes#package-json-missing"') &&
    !pluginValidationFixes.includes('href="./plugin-validation-fixes.md#package-json-missing"'),
  "relative Markdown links should resolve to docs routes",
);
assert(
  pluginValidationFixes.includes('href="/plugins/building-plugins"') &&
    !pluginValidationFixes.includes('href="/docs/plugins/building-plugins"'),
  "root app links should stay outside the docs base path",
);
assert(
  cli.includes(
    "https://github.com/openclaw/clawhub/blob/main/.github/workflows/package-publish.yml",
  ) && !cli.includes('href="../.github/workflows/package-publish.yml"'),
  "repo-relative source links should resolve to GitHub",
);
assert(
  searchIndex.entries.some((entry) => entry.url === "/" && entry.title === "ClawHub"),
  "search index should include the docs home page",
);
assert(
  sourceIndexMeta.repository === "openclaw/clawhub",
  "source index should identify openclaw/clawhub",
);

console.log("ClawHub docs smoke ok");

function read(rel) {
  const file = path.join(site, rel);
  if (!fs.existsSync(file)) throw new Error(`${rel} does not exist; run bun run docs:build first`);
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
