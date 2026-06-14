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
const llmsDiscovery = fs.readFileSync(
  path.join(repoRoot, "public", ".well-known", "llms.txt"),
  "utf8",
);
const robots = read("robots.txt");
const searchIndex = JSON.parse(read("docs-search.json"));
const sourceIndexMeta = JSON.parse(read("source-index-meta.json"));
const vercelConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));

assert(
  index.includes("<title>ClawHub - ClawHub</title>"),
  "index should render ClawHub as the docs home",
);
assert(
  index.includes('href="https://docs.clawhub.ai/"'),
  "index should use docs.clawhub.ai canonical URL",
);
assert(index.includes('href="/quickstart"'), "index should link to the quickstart child route");
assert(
  !fs.existsSync(path.join(site, "clawhub", "index.html")),
  "home page should not publish /docs/clawhub",
);
assert(
  !fs.existsSync(path.join(site, "README", "index.html")),
  "README.md should not publish as a docs page",
);
assert(!fs.existsSync(path.join(site, "specs")), "specs should not publish under /docs");
assert(fs.existsSync(path.join(site, "assets", "clawd-logo.png")), "docs assets should be copied");
assert(quickstart.includes("Quickstart"), "quickstart child route should render");
assert(index.includes("Ask Molty"), "Ask Molty widget should render");
assert(index.includes("ClawHub docs assistant"), "Ask Molty should use the ClawHub chat label");
assert(
  siteJs.includes('new URL("https://clawhub.ai/auth/docs",location.href)'),
  "Ask Molty auth should use canonical ClawHub auth",
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
  /https:\/\/docs\.clawhub\.ai\/[^)\s]+\.md/u.test(llms) &&
    !llms.includes("/start/getting-started.md"),
  "llms.txt should advertise a real ClawHub Markdown page",
);
assert(llmsDiscovery === llms, "root .well-known LLMS discovery should match the docs artifact");
assert(
  robots.includes("# ClawHub documentation crawler policy") &&
    robots.includes("Sitemap: https://docs.clawhub.ai/sitemap.xml") &&
    !robots.includes("OpenClaw documentation crawler policy"),
  "robots.txt should use ClawHub docs metadata",
);
assert(
  pluginValidationFixes.includes('href="/plugin-validation-fixes#package-json-missing"') &&
    !pluginValidationFixes.includes('href="./plugin-validation-fixes.md#package-json-missing"'),
  "relative Markdown links should resolve to docs routes",
);
assert(
  pluginValidationFixes.includes('href="https://docs.openclaw.ai/plugins/building-plugins"') &&
    !pluginValidationFixes.includes('href="/docs/plugins/building-plugins"'),
  "OpenClaw plugin guide links should use the canonical OpenClaw docs host",
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
assert(
  vercelConfig.redirects?.some(
    (route) =>
      route.source === "/docs/:path*" &&
      route.destination === "https://docs.clawhub.ai/:path*" &&
      route.statusCode === 308,
  ),
  "legacy ClawHub docs paths should redirect to the canonical docs host",
);
assert(
  vercelConfig.rewrites?.some(
    (route) =>
      route.source === "/" &&
      route.destination === "/docs" &&
      route.has?.some(
        (condition) =>
          condition.type === "header" &&
          condition.key === "host" &&
          condition.value === "docs.clawhub.ai",
      ),
  ),
  "docs.clawhub.ai root should serve the generated docs artifact",
);
assert(
  vercelConfig.redirects?.some(
    (route) =>
      route.source === "/docs/:path*" &&
      route.destination === "https://docs.clawhub.ai/:path*" &&
      route.statusCode === 308 &&
      route.has?.some(
        (condition) =>
          condition.type === "header" &&
          condition.key === "host" &&
          condition.value === "docs.clawhub.ai",
      ),
  ),
  "docs.clawhub.ai/docs paths should redirect to root docs paths",
);
assert(
  vercelConfig.rewrites?.some(
    (route) =>
      route.source === "/:path*" &&
      route.destination === "/docs/:path*" &&
      route.has?.some(
        (condition) =>
          condition.type === "header" &&
          condition.key === "host" &&
          condition.value === "docs.clawhub.ai",
      ),
  ),
  "docs.clawhub.ai should serve the generated docs artifact",
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
