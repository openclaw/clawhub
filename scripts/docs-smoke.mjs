#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const site = path.join(repoRoot, "public", "docs");

const index = read("index.html");
const quickstart = read("quickstart/index.html");
const siteCss = read("assets/docs-site.css");
const siteJs = read("assets/docs-site.js");
const cli = read("cli/index.html");
const pluginValidationFixes = read("plugin-validation-fixes/index.html");
const pluginDevelopment = read("plugin-development/index.html");
const pluginInspector = read("plugin-inspector/index.html");
const skillFormat = read("skill-format/index.html");
const buildingPlugins = read("plugins/building-plugins/index.html");
const pluginBundles = read("plugins/bundles/index.html");
const cliBackendPlugins = read("plugins/cli-backend-plugins/index.html");
const pluginCompatibility = read("plugins/compatibility/index.html");
const pluginMigration = read("plugins/sdk-migration/index.html");
const pluginProvider = read("plugins/sdk-provider-plugins/index.html");
const pluginChannel = read("plugins/sdk-channel-plugins/index.html");
const pluginSetup = read("plugins/sdk-setup/index.html");
const pluginTesting = read("plugins/sdk-testing/index.html");
const toolPlugins = read("plugins/tool-plugins/index.html");
const creatingSkills = read("creating-skills/index.html");
const renderedPluginDocs = fs
  .readdirSync(path.join(site, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    html: read(path.join("plugins", entry.name, "index.html")),
    name: entry.name,
  }));
const llms = read("llms.txt");
const llmsDiscovery = fs.readFileSync(
  path.join(repoRoot, "public", ".well-known", "llms.txt"),
  "utf8",
);
const robots = read("robots.txt");
const searchIndex = JSON.parse(read("docs-search.json"));
const sourceIndexMeta = JSON.parse(read("source-index-meta.json"));
const renderedHtmlFiles = listHtmlFiles(site);
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
  siteCss.includes(
    ".doc .oc-table th,.doc .oc-table td,.doc .oc-table code{overflow-wrap:normal;word-break:normal}",
  ) &&
    siteCss.includes(".doc .oc-table th,.doc .oc-table code{white-space:nowrap}") &&
    siteCss.includes(
      "@media(max-width:820px){.doc .oc-table{min-width:560px;table-layout:auto}.doc h2,.doc h3,.doc h4{overflow-wrap:anywhere;word-break:normal}}",
    ),
  "docs tables should remain readable and long headings should fit on narrow screens",
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
  codeTextFromPage(index).includes(
    "clawhub package publish ./my-plugin --family code-plugin --dry-run",
  ) && !codeTextFromPage(index).includes("clawhub package publish your-org/"),
  "docs home should use ClawHub local-source package publishing",
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
  pluginValidationFixes.includes('href="/plugins/building-plugins"') &&
    !pluginValidationFixes.includes('href="https://docs.openclaw.ai/plugins/building-plugins"'),
  "plugin validation fixes should link to the imported plugin development docs",
);
assert(
  pluginDevelopment.includes('href="/plugins/building-plugins"') &&
    buildingPlugins.includes("Create your first OpenClaw plugin in minutes"),
  "plugin development docs should render and link to the first-plugin tutorial",
);
assert(
  pluginDevelopment.includes('href="/plugins/tool-plugins"') &&
    pluginDevelopment.includes('href="/plugins/sdk-provider-plugins"') &&
    pluginDevelopment.includes('href="/plugin-inspector"') &&
    creatingSkills.includes("Ship a skill inside a plugin"),
  "the Build tab should include plugin-type and skill-authoring guidance",
);
assert(
  skillFormat.includes('class="tab-link active" href="/plugin-development">Build') &&
    skillFormat.includes("<h2>Skill Development</h2>"),
  "skill-format should live in the Build tab without an ambiguous duplicate navigation entry",
);
assert(
  pluginInspector.includes("plugin-inspector check --no-openclaw") &&
    pluginInspector.includes("plugin-inspector ci --no-openclaw") &&
    !pluginInspector.includes("plugin-inspector inspect --no-openclaw") &&
    pluginInspector.includes("plugin-inspector-reports") &&
    buildingPlugins.includes('href="/plugin-inspector"') &&
    cli.includes('href="/plugin-inspector"') &&
    pluginCompatibility.includes('href="/plugin-inspector"') &&
    !pluginCompatibility.includes("openclaw-plugin-inspector ./my-plugin"),
  "Plugin Inspector development and CI guidance should render and be linked",
);
assert(
  codeTextFromPage(buildingPlugins).includes(
    "clawhub package publish . --family code-plugin --dry-run",
  ) &&
    renderedPluginDocs.every(
      ({ html }) => !codeTextFromPage(html).includes("clawhub package publish your-org/"),
    ),
  "plugin guides should use ClawHub local-source publish commands",
);
assert(
  pluginBundles.includes("does not currently provide a pure ecosystem-bundle publish path") &&
    codeTextFromPage(pluginBundles).includes("clawhub skill publish ./my-bundle/skills/my-skill") &&
    !codeTextFromPage(pluginBundles).includes("clawhub package publish ./my-bundle"),
  "bundle guide should not advertise a package publish path that changes bundle semantics",
);
assert(
  [buildingPlugins, cliBackendPlugins, pluginProvider, pluginChannel, pluginSetup].every((html) =>
    html.includes("runtimeExtensions"),
  ) &&
    [
      buildingPlugins,
      cliBackendPlugins,
      pluginCompatibility,
      pluginInspector,
      pluginProvider,
      pluginChannel,
      pluginSetup,
      pluginTesting,
      toolPlugins,
    ].every((html) => codeTextFromPage(html).includes("npm run build")) &&
    pluginChannel.includes("runtimeSetupEntry"),
  "ClawHub code-plugin workflows should declare and build published JavaScript runtime entries",
);
assert(
  codeTextFromPage(buildingPlugins).includes(
    'import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";',
  ) &&
    codeTextFromPage(cli).includes('"runtimeExtensions": ["./dist/index.js"]') &&
    cli.includes("Run <code>npm run build</code> before validation or publishing") &&
    cli.includes("packs and uploads a ClawPack") &&
    cli.includes("with lifecycle scripts disabled"),
  "the primary quickstart and CLI reference should describe a buildable code-plugin package",
);
assert(
  codeTextFromPage(toolPlugins).includes('"pluginApi": ">=2026.5.17"') &&
    codeTextFromPage(toolPlugins).includes('"openclawVersion": "2026.6.6"') &&
    toolPlugins.includes("GitHub-backed checkout"),
  "the tool-plugin publish guide should include required ClawHub metadata and provenance",
);
assert(
  pluginMigration.includes('href="/plugins/sdk-channel-plugins"'),
  "mirrored migration references should link to the mirrored ClawHub route",
);
assert(
  pluginTesting.includes("External plugin workflow") &&
    pluginTesting.includes("OpenClaw repository test utilities") &&
    pluginCompatibility.includes("For ClawHub publishers") &&
    buildingPlugins.includes("OpenClaw contributors working on a bundled plugin"),
  "mirrored runtime docs should make ClawHub publishers the primary audience",
);
assert(
  renderedPluginDocs.every(({ html }) => !html.includes("OPENCLAW_DOCS_MARKER")),
  "rendered plugin docs should not leak unsupported component markers",
);
assert(
  renderedPluginDocs.every(({ html }) =>
    renderedCodeBlocks(html).every((block) => textFromCodeBlock(block).trim()),
  ),
  "rendered plugin docs should not contain empty code blocks",
);
assert(
  renderedPluginDocs.every(({ html }) =>
    renderedCodeBlocks(html).every((block) => !/&(?:amp|lt|gt);/u.test(textFromCodeBlock(block))),
  ),
  "rendered plugin code should not display double-escaped HTML entities",
);
for (const { html, name } of renderedPluginDocs) {
  const source = fs.readFileSync(path.join(repoRoot, "docs", "plugins", `${name}.md`), "utf8");
  const renderedCode = renderedCodeBlocks(html).map(textFromCodeBlock).join("\n");
  for (const line of fencedImportLines(source)) {
    assert(renderedCode.includes(line), `${name} should preserve fenced import: ${line}`);
  }
}
for (const name of ["building-plugins", "sdk-provider-plugins", "sdk-channel-plugins"]) {
  const html = renderedPluginDocs.find((doc) => doc.name === name)?.html ?? "";
  assert(
    /data-code-label="package\.json"[\s\S]*?data-line="2">  <span/u.test(html),
    `${name} should preserve package.json indentation inside its code group`,
  );
}
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
assertInternalDocsLinks(renderedHtmlFiles);
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

function renderedCodeBlocks(html) {
  return [
    ...html.matchAll(
      /<figure\b[^>]*class="[^"]*\boc-code\b[^"]*"[^>]*>[\s\S]*?<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>[\s\S]*?<\/figure>/gu,
    ),
  ].map((match) => match[1]);
}

function textFromCodeBlock(html) {
  return html
    .replace(/<[^>]+>/gu, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function codeTextFromPage(html) {
  return renderedCodeBlocks(html).map(textFromCodeBlock).join("\n");
}

function listHtmlFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith("__")) {
      files.push(...listHtmlFiles(file));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(file);
    }
  }
  return files;
}

function assertInternalDocsLinks(files) {
  for (const sourceFile of files) {
    const sourceHtml = fs.readFileSync(sourceFile, "utf8");
    for (const match of sourceHtml.matchAll(/href="([^"]+)"/gu)) {
      const href = decodeHtmlAttribute(match[1]);
      if (!href.startsWith("/") && !href.startsWith("#")) continue;
      const [route, hash] = href.split("#");
      const target = route ? renderedDocsTarget(route) : sourceFile;
      assert(
        fs.existsSync(target),
        `${path.relative(site, sourceFile)} should link to an existing docs route: ${href}`,
      );
      if (!hash || !target.endsWith(".html")) continue;
      const targetHtml = fs.readFileSync(target, "utf8");
      assert(
        targetHtml.includes(`id="${hash}"`),
        `${path.relative(site, sourceFile)} should link to an existing docs anchor: ${href}`,
      );
    }
  }
}

function renderedDocsTarget(route) {
  const relative = route.split("?")[0].replace(/^\/+/u, "");
  if (!relative) return path.join(site, "index.html");
  const direct = path.join(site, relative);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  return path.join(direct, "index.html");
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function fencedImportLines(markdown) {
  let fence = null;
  const imports = [];
  for (const line of String(markdown).split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      const chars = marker[1];
      if (!fence) {
        fence = { char: chars[0], length: chars.length };
      } else if (
        chars[0] === fence.char &&
        chars.length >= fence.length &&
        marker[2].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (fence && /^import\s/u.test(line)) imports.push(line);
  }
  return imports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
