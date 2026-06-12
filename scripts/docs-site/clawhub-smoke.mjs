#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const site = path.join(root, "dist", "docs-site");
const publicSite = path.join(root, "public", "docs");
const required = [
  "index.html",
  "quickstart/index.html",
  "auth/index.html",
  "security-audits/index.html",
  "assets/docs-site.css",
  "assets/docs-site.js",
  "assets/pixel-lobster.svg",
  "docs-search.json",
  "source-index.jsonl",
  "llms.txt",
  "robots.txt",
  "sitemap.xml",
  "pagefind/pagefind.js",
];

for (const rel of required) {
  assertFile(path.join(site, rel), `missing ${rel}`);
  assertFile(path.join(publicSite, rel), `missing public/docs/${rel}`);
}

const index = read("index.html");
const js = read("assets/docs-site.js");
assert(index.includes("ClawHub"), "index should render ClawHub branding");
assert(index.includes('window.OPENCLAW_DOCS_BASE="/docs"'), "index should set /docs base path");
assert(
  index.includes('<a data-primary-site-link href="https://clawhub.ai"'),
  "compact docs header should keep an obvious link back to the ClawHub app",
);
assert(index.includes("icon-globe"), "ClawHub app link should render with a website globe icon");
assert(
  index.includes('<a class="nav-link active" href="/docs/">ClawHub</a>'),
  "Start nav should include the ClawHub home page",
);
assert(js.includes('new URL("/auth/docs",location.href)'), "Molty sign-in should use /auth/docs");
assert(
  !js.includes("https://hub.openclaw.ai/docs/auth"),
  "old docs auth URL should not be embedded",
);
const css = read("assets/docs-site.css");
assert(
  css.includes(".header-links a:not([data-primary-site-link]){display:none}") &&
    css.includes(
      ".header-links a[data-primary-site-link] .icon{width:14px;height:14px;min-width:14px;max-width:14px;color:currentColor}",
    ),
  "compact docs header should hide secondary links and keep the primary icon color matched to text",
);
assert(index.includes("data-docs-chat"), "Ask Molty widget should render");

const auth = read("auth/index.html");
assert(auth.includes("<h1>Auth</h1>"), "public /docs/auth page should render auth docs");

const searchIndex = JSON.parse(read("docs-search.json"));
assert(searchIndex.count >= 10, "docs-search.json should include ClawHub docs entries");
assert(
  searchIndex.entries.some((entry) => entry.title === "ClawHub" && entry.url === "/docs/"),
  "docs-search.json should index the /docs home page",
);
assert(
  searchIndex.entries.some((entry) => entry.title === "Auth" && entry.url === "/docs/auth"),
  "docs-search.json should index the public auth page",
);
assert(
  !searchIndex.entries.some((entry) => entry.url.includes("specs")),
  "specs must not be indexed",
);

const pluginValidation = read("plugin-validation-fixes/index.html");
assert(
  pluginValidation.includes('href="/docs/plugin-validation-fixes#package-json-missing"'),
  "relative same-page markdown links should resolve to generated docs URLs",
);
assert(
  !pluginValidation.includes('href="./plugin-validation-fixes.md#package-json-missing"'),
  "relative markdown source links should not be published unchanged",
);
assert(
  pluginValidation.includes('href="/plugins/building-plugins"'),
  "unknown app-root links should stay rooted at the ClawHub app",
);
assert(
  !pluginValidation.includes('href="/docs/plugins/building-plugins"'),
  "unknown app-root links should not be incorrectly prefixed with /docs",
);

const cli = read("cli/index.html");
assert(
  cli.includes(
    'href="https://github.com/openclaw/clawhub/blob/main/.github/workflows/package-publish.yml"',
  ),
  "relative links outside docs should point at source files",
);
assert(
  cli.includes('href="https://github.com/openclaw/clawhub/edit/main/docs/cli.md"'),
  "edit source links should point at the ClawHub docs source repository",
);

const robots = read("robots.txt");
assert(
  robots.includes("Sitemap: https://clawhub.ai/docs/sitemap.xml"),
  "robots should advertise ClawHub docs sitemap",
);

const sitemap = read("sitemap.xml");
assert(
  sitemap.includes("<loc>https://clawhub.ai/docs/</loc>"),
  "sitemap should include /docs root",
);
assert(
  sitemap.includes("<loc>https://clawhub.ai/docs/auth</loc>"),
  "sitemap should include public auth docs",
);

console.log(`clawhub docs smoke ok: ${searchIndex.count} search entries`);

function read(rel) {
  return fs.readFileSync(path.join(site, rel), "utf8");
}

function assertFile(file, message) {
  assert(fs.existsSync(file), message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
