#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import matter from "gray-matter";
import { siteCss, siteJs } from "./assets.mjs";
import {
  ignoredDocDirs,
  ignoredDocFiles,
  localeLabels,
  mintlifyLocaleToDir,
  rtlLocales,
} from "./config.mjs";
import { editSourceUrlForPage, frontmatterSourcePath, readSourceMetadata } from "./edit-source.mjs";
import { elementsFixture } from "./elements-fixture.mjs";
import { createMarkdownRenderer, renderMdxish } from "./mdx-ish.mjs";
import { renderPageOgSvg } from "./og-card-template.mjs";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const siteAssetsDir = path.join(root, "scripts", "docs-site");
const shellPublicAssetsDir = path.join(siteAssetsDir, "assets");
const outDir = path.join(root, "dist", "docs-site");
const config = JSON.parse(fs.readFileSync(path.join(docsDir, "docs.json"), "utf8"));
const siteHomeSlug = normalizeSlug(config.home ?? "index");
const siteFavicon = normalizeAssetPath(
  config.favicon ?? config.logo?.dark ?? config.logo?.light ?? "/assets/pixel-lobster.svg",
);
const siteLogo = normalizeAssetPath(
  config.logo?.dark ?? config.logo?.light ?? config.favicon ?? "/assets/pixel-lobster.svg",
);
const siteThemeColor = config.colors?.primary ?? config.theme?.colors?.primary ?? "#FF5A36";
const siteChatName = config.chat?.name ?? "Molty";
const siteChatLabel = config.chat?.label ?? `${config.name} docs assistant`;
const siteHeaderLinks = Array.isArray(config.headerLinks) ? config.headerLinks : [];
const siteSearchSuggestions = Array.isArray(config.search?.suggestions)
  ? config.search.suggestions
  : ["Install OpenClaw", "Set up Telegram", "Fix Gateway", "Build a plugin"];
const detectedSourceMetadata = readSourceMetadata(root);
const sourceMetadata = {
  ...detectedSourceMetadata,
  repository: process.env.DOCS_SOURCE_REPO_URL || detectedSourceMetadata.repository,
};
const md = createMarkdownRenderer();
const basePath = normalizeBasePath(process.env.DOCS_SITE_BASE_PATH ?? "");
const legacyBasePath = normalizeBasePath(process.env.DOCS_SITE_LEGACY_BASE_PATH ?? "/docs");
const canonicalOrigin = (
  process.env.DOCS_SITE_CANONICAL_ORIGIN ??
  (process.env.DOCS_SITE_CNAME
    ? `https://${process.env.DOCS_SITE_CNAME}`
    : "https://docs.openclaw.ai")
).replace(/\/$/, "");
const feedbackIssueRepository = normalizeRepository(
  process.env.DOCS_FEEDBACK_ISSUE_REPO ?? "openclaw/openclaw",
);
const sourceRepositoryUrl = normalizeGithubRepositoryUrl(
  process.env.DOCS_SOURCE_REPO_URL ?? `https://github.com/${feedbackIssueRepository}`,
);
const llmsFullAvailable = process.env.DOCS_SITE_LLMS_FULL_AVAILABLE === "1";
const ogImagePath = "/og-card.png";
const renderedPageOgCards = new Set();
const chatApiUrl = process.env.DOCS_SITE_CHAT_API_URL ?? "/ask-molty/api/chat";
const chatAuthUrl = process.env.DOCS_SITE_CHAT_AUTH_URL ?? "/auth/docs";
const shellCss = siteCss();
const shellJs = siteJs({ authUrl: chatAuthUrl, assistantName: siteChatName });
const defaultShellAssetVersion = createHash("sha256")
  .update(shellCss)
  .update("\0")
  .update(shellJs)
  .digest("hex")
  .slice(0, 12);
const shellAssetVersion = process.env.DOCS_SITE_SHELL_ASSET_VERSION ?? defaultShellAssetVersion;
const artifactMode = process.env.DOCS_SITE_ARTIFACT_MODE ?? "full";
const shellOnly = artifactMode === "shell";
const previewPagesPerGroup = parseOptionalPositiveInt(
  process.env.DOCS_SITE_PREVIEW_PAGES_PER_GROUP,
  "DOCS_SITE_PREVIEW_PAGES_PER_GROUP",
);
const previewMaxPages = parseOptionalPositiveInt(
  process.env.DOCS_SITE_PREVIEW_MAX_PAGES,
  "DOCS_SITE_PREVIEW_MAX_PAGES",
);
const previewLocale = process.env.DOCS_SITE_PREVIEW_LOCALE;
const previewMode = Boolean(previewPagesPerGroup || previewMaxPages || previewLocale);
const includeElementsFixture =
  !previewMode || process.env.DOCS_SITE_PREVIEW_INCLUDE_FIXTURE === "1";
if (!["full", "shell"].includes(artifactMode)) {
  throw new Error(`DOCS_SITE_ARTIFACT_MODE must be full or shell, got ${artifactMode}`);
}
fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
fs.mkdirSync(outDir, { recursive: true });

const locales = buildLocales(config);
const allPages = [
  ...collectPages(locales),
  ...(includeElementsFixture ? [elementsFixturePage()] : []),
];
const allPageByKey = new Map(allPages.map((page) => [pageKey(page.locale, page.slug), page]));
let pages = allPages;
let pageByKey = new Map(pages.map((page) => [pageKey(page.locale, page.slug), page]));
let navByLocale = new Map(locales.map((locale) => [locale.code, buildNav(locale)]));
if (previewMode) {
  const previewKeys = collectPreviewPageKeys(navByLocale, {
    locale: previewLocale,
    maxPages: previewMaxPages,
    pagesPerGroup: previewPagesPerGroup || 1,
  });
  pages = allPages.filter(
    (page) => page.hidden || previewKeys.has(pageKey(page.locale, page.slug)),
  );
  pageByKey = new Map(pages.map((page) => [pageKey(page.locale, page.slug), page]));
  navByLocale = new Map(locales.map((locale) => [locale.code, buildNav(locale)]));
}
const localeFlags = {
  en: "🇺🇸",
  "zh-CN": "🇨🇳",
  "zh-TW": "🇨🇳",
  "ja-JP": "🇯🇵",
  es: "🇪🇸",
  "pt-BR": "🇧🇷",
  ko: "🇰🇷",
  de: "🇩🇪",
  fr: "🇫🇷",
  ar: "🇸🇦",
  it: "🇮🇹",
  vi: "🇻🇳",
  nl: "🇳🇱",
  tr: "🇹🇷",
  uk: "🇺🇦",
  id: "🇮🇩",
  pl: "🇵🇱",
  fa: "🇮🇷",
  th: "🇹🇭",
};
const localePickerLabels = {
  "pt-BR": "Português (BR)",
};

copyPublicFiles();
if (!previewMode) await renderPageOgCards();
for (const page of pages) writePage(page);
if (!shellOnly) {
  writeLlmsIndex();
  writeRobotsTxt();
  writeSitemap();
}
if (!previewMode) writeRedirects();
writeStaticAssets();
const previewLabel = previewMode
  ? `, preview ${previewPagesPerGroup || 1}/group${previewMaxPages ? ` max ${previewMaxPages}` : ""}${previewLocale ? ` ${previewLocale}` : ""}`
  : "";
console.log(
  `built ${pages.length} pages in ${path.relative(root, outDir)} (${artifactMode}${previewLabel})`,
);

function buildLocales(docsConfig) {
  const ordered = [];
  for (const entry of docsConfig.navigation?.languages ?? []) {
    const code = mintlifyLocaleToDir[entry.language] ?? entry.language;
    ordered.push({ code, source: entry, root: code === "en" });
  }
  for (const dirent of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || ignoredDocDirs.has(dirent.name)) continue;
    if (localeLabels[dirent.name] && !ordered.some((locale) => locale.code === dirent.name)) {
      ordered.push({ code: dirent.name, source: ordered[0]?.source, root: false });
    }
  }
  return ordered.filter((locale) => locale.root || fs.existsSync(path.join(docsDir, locale.code)));
}

function parseOptionalPositiveInt(value, name) {
  if (value === undefined || value === "") return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== String(value).trim()) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function collectPages(localeList) {
  const result = [];
  for (const locale of localeList) {
    const base = locale.root ? docsDir : path.join(docsDir, locale.code);
    for (const file of walkDocs(base)) {
      const rel = path.relative(base, file).replaceAll(path.sep, "/");
      if (ignoredDocFiles.has(rel) || rel.endsWith("/AGENTS.md")) continue;
      const raw = fs.readFileSync(file, "utf8");
      const parsed = matter(raw);
      const slug = normalizeHomeSlug(fileSlug(rel));
      const title =
        parsed.data.title || firstHeading(parsed.content) || titleize(path.basename(slug));
      result.push({
        locale: locale.code,
        dir: locale.root ? "" : locale.code,
        slug,
        file,
        rel,
        sourcePath: frontmatterSourcePath(parsed.data),
        raw,
        title,
        summary: parsed.data.summary ?? "",
        readWhen: parsed.data.read_when ?? [],
        body: parsed.content,
        meta: {
          status: parsed.data.status ?? firstStatusLine(parsed.content),
          appliesTo: parsed.data.applies_to ?? parsed.data.appliesTo,
          since: parsed.data.since,
          updated: parsed.data.updated ?? parsed.data.last_updated,
          deprecated: parsed.data.deprecated,
          beta: parsed.data.beta,
        },
      });
    }
  }
  return result;
}

function elementsFixturePage() {
  const parsed = matter(elementsFixture);
  return {
    locale: "en",
    dir: "",
    slug: "__elements",
    file: path.join(siteAssetsDir, "elements-fixture.mjs"),
    rel: "__elements.md",
    raw: elementsFixture,
    title: parsed.data.title || "Docs elements",
    summary: parsed.data.summary ?? "",
    readWhen: [],
    body: parsed.content,
    meta: {
      status: parsed.data.status,
      appliesTo: parsed.data.applies_to ?? parsed.data.appliesTo,
      since: parsed.data.since,
      updated: parsed.data.updated ?? parsed.data.last_updated,
      deprecated: parsed.data.deprecated,
      beta: parsed.data.beta,
    },
    hidden: true,
  };
}

function walkDocs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ignoredDocDirs.has(entry.name) ? [] : walkDocs(full);
    return /\.(md|mdx)$/.test(entry.name) ? [full] : [];
  });
}

function buildNav(locale) {
  const source = locale.source ?? locales[0]?.source;
  const tabs = (source?.tabs ?? []).map((tab) => ({
    title: tab.tab,
    groups: (tab.groups ?? []).map((group) => navGroup(locale.code, group)).filter(Boolean),
  }));
  return tabs.filter((tab) => tab.groups.length);
}

function navGroup(locale, group) {
  const pages = flattenPages(locale, group.pages ?? []);
  return pages.length ? { title: group.group ?? "Docs", pages } : null;
}

function collectPreviewPageKeys(navByLocale, { locale, maxPages, pagesPerGroup }) {
  const keys = new Set();
  for (const [navLocale, nav] of navByLocale) {
    if (locale && navLocale !== locale) continue;
    for (const tab of nav) {
      for (const group of tab.groups) {
        for (const page of flattenNavEntries(group.pages).slice(0, pagesPerGroup)) {
          keys.add(pageKey(page.locale, page.slug));
          if (maxPages && keys.size >= maxPages) return keys;
        }
      }
    }
  }
  return keys;
}

function flattenPages(locale, entries) {
  const output = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      const page = pageByKey.get(pageKey(locale, navEntrySlug(locale, entry)));
      if (page) output.push(page);
    } else if (entry?.pages) {
      const nested = flattenPages(locale, entry.pages);
      if (nested.length) output.push({ group: entry.group ?? "More", pages: nested });
    }
  }
  return output;
}

function navEntrySlug(locale, entry) {
  const slug = normalizeSlug(entry);
  const localized = slug.startsWith(`${locale}/`)
    ? normalizeSlug(slug.slice(locale.length + 1))
    : slug;
  return normalizeHomeSlug(localized);
}

function writePage(page) {
  const nav = navByLocale.get(page.locale) ?? [];
  const flat = flattenNav(nav);
  const activeIndex = flat.findIndex((item) => item.slug === page.slug);
  const activeTab = activeTabTitle(nav, page.slug);
  const prev = activeIndex > 0 ? flat[activeIndex - 1] : null;
  const next = activeIndex >= 0 && activeIndex < flat.length - 1 ? flat[activeIndex + 1] : null;
  const html = rewriteInternalUrls(renderMdxish(expandSnippets(page.body, page.file), md), page);
  const toc = tableOfContents(html);
  const outPath = path.join(outDir, pageRoute(page).replace(/^\//, ""), "index.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, layout({ page, nav, activeTab, html, toc, prev, next }), "utf8");
  const mdPath = path.join(outDir, pageMarkdownRoute(page).replace(/^\//, ""));
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, page.raw, "utf8");
}

function layout({ page, nav, activeTab, html, toc, prev, next }) {
  const lang = htmlLang(page.locale);
  const dir = rtlLocales.has(page.locale) ? "rtl" : "ltr";
  const title = `${page.title} - ${config.name}`;
  const description = page.summary || config.description || "";
  const ogTitle = page.slug === "index" ? config.name : `${page.title} · ${config.name}`;
  const canonicalUrl = canonicalOrigin ? `${canonicalOrigin}${pageRoute(page)}` : "";
  const pageOgPath =
    page.locale === "en" && renderedPageOgCards.has(page.slug)
      ? `/og/${page.slug}.png`
      : ogImagePath;
  const ogImageUrl = canonicalOrigin ? `${canonicalOrigin}${pageOgPath}` : publicPath(pageOgPath);
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${escapeAttr(description)}">
<title>${escapeHtml(title)}</title>
${canonicalUrl ? `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">` : ""}
${hreflangLinks(page)}${page.hidden ? '<meta name="robots" content="noindex,nofollow">' : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeAttr(config.name)}">
<meta property="og:title" content="${escapeAttr(ogTitle)}">
<meta property="og:description" content="${escapeAttr(description)}">
${canonicalUrl ? `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">` : ""}
<meta property="og:image" content="${escapeAttr(ogImageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeAttr(`${config.name} — ${description}`)}">
<meta property="og:locale" content="${escapeAttr(htmlLang(page.locale).replace("-", "_"))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(ogTitle)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(ogImageUrl)}">
<meta name="twitter:image:alt" content="${escapeAttr(`${config.name} — ${description}`)}">
<meta name="theme-color" content="${escapeAttr(siteThemeColor)}">
<link rel="icon" href="${publicPath(siteFavicon)}">
<link rel="stylesheet" href="${assetUrl("/assets/docs-site.css")}">
<script>window.OPENCLAW_DOCS_BASE=${JSON.stringify(basePath)};window.OPENCLAW_DOCS_CHAT_API=${JSON.stringify(chatApiUrl)};document.documentElement.dataset.theme=localStorage.getItem("theme")||"dark"</script>
</head>
<body>
${siteHeader(page, nav, activeTab)}
<div class="doc-shell">
${sidebar(page, nav, activeTab)}
<main class="main" id="main">
<article class="article">
<header class="article-header">
${articleMeta(page, nav)}
${page.hidden ? "" : pageMarkdownScript(page)}
<p class="article-kicker">${escapeHtml(groupForPage(nav, page.slug) ?? activeTab)}</p>
<h1>${escapeHtml(page.title)}</h1>
${pageStatus(page)}
</header>
${pageSearchMetadata(page, nav)}
<div class="doc"${page.hidden ? " data-pagefind-ignore" : " data-pagefind-body"}>${html}</div>
${page.hidden ? "" : pageFeedback(page)}
${pager(prev, next)}
</article>
${tocHtml(toc)}
</main>
</div>
${searchModal()}
${page.hidden ? "" : chatWidget()}
<script type="module" src="${assetUrl("/assets/docs-site.js")}"></script>
</body>
</html>`;
}

function assetUrl(file) {
  return `${publicPath(file)}?v=${encodeURIComponent(shellAssetVersion)}`;
}

function siteHeader(page, nav, activeTab) {
  const tabs = nav
    .map((tab) => {
      const href = pageUrl(firstPage(tab));
      const active = tab.title === activeTab ? " active" : "";
      return `<a class="tab-link${active}" href="${href}">${escapeHtml(tab.title)}</a>`;
    })
    .join("");
  return `<header class="site-header">
<div class="header-row">
<div class="header-left"><a class="brand" href="${pageUrl(pageByKey.get(pageKey(page.locale, "index")) ?? page)}"><img src="${publicPath(siteLogo)}" alt=""></a>${languagePicker(page)}</div>
<button class="search-button" type="button" data-search-open>${icon("search")}<span class="search-label">Search...</span><span class="search-shortcut" aria-hidden="true">${icon("command")}<span>K</span></span></button>
<nav class="header-links">${siteHeaderLinks.map((link, index) => topLink(link.label, link.href, link.icon ?? "external-link", index === 0 ? " data-primary-site-link" : "")).join("")}<button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle theme"><span class="theme-toggle-icon theme-toggle-icon-dark">${icon("moon")}</span><span class="theme-toggle-icon theme-toggle-icon-light">${icon("sun")}</span></button></nav>
<button class="nav-toggle" type="button" data-nav-toggle>Menu</button>
</div>
<nav class="tabs">${tabs}<span class="tab-underline" aria-hidden="true"></span></nav>
</header>`;
}

function sidebar(page, nav, activeTab) {
  const groups = (nav.find((tab) => tab.title === activeTab) ?? nav[0])?.groups ?? [];
  return `<aside class="sidebar">
<button class="sidebar-close" type="button" data-nav-close aria-label="Close menu">Close</button>
<nav>${groups.map((group) => navGroupHtml(page, group)).join("")}</nav>
</aside>`;
}

function languagePicker(page) {
  const current = locales.find((locale) => locale.code === page.locale) ?? locales[0];
  const currentLabel = localeDisplayName(current.code);
  const currentFlag = localeFlag(current.code);
  const pickerLocales = previewMode
    ? locales.filter(
        (locale) => locale.code === page.locale || pageByKey.has(pageKey(locale.code, page.slug)),
      )
    : locales;
  const options = pickerLocales
    .map((locale) => {
      const active = locale.code === page.locale;
      return `<a class="language-option${active ? " active" : ""}" role="option" aria-selected="${active ? "true" : "false"}" href="${escapeAttr(localeUrlForSlug(locale.code, page.slug))}" data-locale-option><span class="locale-flag" aria-hidden="true">${escapeHtml(localeFlag(locale.code))}</span><span class="language-name">${escapeHtml(localeDisplayName(locale.code))}</span><span class="language-check" aria-hidden="true">✓</span></a>`;
    })
    .join("");
  return `<div class="language-picker" data-language-picker><button class="language-trigger" type="button" data-language-trigger aria-haspopup="listbox" aria-expanded="false"><span class="locale-flag" aria-hidden="true">${escapeHtml(currentFlag)}</span><span class="language-current">${escapeHtml(currentLabel)}</span><span class="language-chevron" aria-hidden="true">${icon("chevron-down")}</span></button><div class="language-menu" role="listbox" aria-label="Language">${options}</div></div>`;
}

function localeFlag(code) {
  return localeFlags[code] ?? "🌐";
}

function localeDisplayName(code) {
  return localePickerLabels[code] ?? localeLabels[code] ?? code;
}

function topLink(label, href, iconName, attrs = "") {
  return `<a${attrs} href="${escapeAttr(href)}">${icon(iconName)}<span>${escapeHtml(label)}</span></a>`;
}

function firstStatusLine(content) {
  const match = String(content).match(/^(?:\*\*)?Status(?:\*\*)?:\s*(.+)$/im);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

function articleMeta(page, nav) {
  const crumbTrail = breadcrumbs(page, nav);
  const tools = page.hidden ? "" : pageTools(page);
  return crumbTrail || tools ? `<div class="article-meta-row">${crumbTrail}${tools}</div>` : "";
}

function pageSearchMetadata(page, nav) {
  if (page.hidden) return "";
  const category = activeTabTitle(nav, page.slug);
  const section = groupForPage(nav, page.slug);
  return [
    category ? `<span hidden data-pagefind-meta="category">${escapeHtml(category)}</span>` : "",
    section ? `<span hidden data-pagefind-meta="section">${escapeHtml(section)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
}

function breadcrumbs(page, nav) {
  if (page.hidden) return "";
  const activeTab = activeTabTitle(nav, page.slug);
  const activeTabEntry = nav.find((tab) => tab.title === activeTab);
  const activeTabPage = activeTabEntry ? firstPage(activeTabEntry) : null;
  const group = groupForPage(nav, page.slug);
  const parts = [
    activeTab && activeTabPage
      ? {
          className: "breadcrumb-tab",
          html: `<a href="${escapeAttr(pageUrl(activeTabPage))}">${escapeHtml(activeTab)}</a>`,
        }
      : activeTab
        ? { className: "breadcrumb-tab", html: `<span>${escapeHtml(activeTab)}</span>` }
        : null,
    group ? { className: "breadcrumb-group", html: `<span>${escapeHtml(group)}</span>` } : null,
    {
      className: "breadcrumb-page",
      html: `<span aria-current="page">${escapeHtml(page.title)}</span>`,
    },
  ].filter(Boolean);
  return parts.length > 1
    ? `<nav class="breadcrumbs" aria-label="Breadcrumb">${parts.map((part, index) => `<span class="breadcrumb-part ${part.className}">${index ? '<span class="breadcrumb-separator" aria-hidden="true">/</span>' : ""}${part.html}</span>`).join("")}</nav>`
    : "";
}

function pageTools(page) {
  const canonicalUrl = `${docsOrigin()}${pageRoute(page)}`;
  const markdownUrl = publicPath(pageMarkdownRoute(page));
  const markdownCanonicalUrl = `${docsOrigin()}${pageMarkdownRoute(page)}`;
  const markdownPrompt = `Read from ${markdownCanonicalUrl} so I can ask questions about it.`;
  return `<div class="page-tools" data-page-tools data-page-url="${escapeAttr(canonicalUrl)}" data-page-markdown-url="${escapeAttr(markdownUrl)}"><div class="page-actions"><button type="button" class="page-actions-primary" data-copy-page data-copy-label="Copy page">${icon("copy")}<span data-copy-feedback>Copy page</span></button><details class="page-actions-more"><summary aria-label="Open page actions"><span class="page-actions-chevron">${icon("chevron-down")}</span></summary><div class="page-actions-menu"><button type="button" class="page-action" data-copy-page data-copy-label="Copy page">${icon("copy")}<span><strong data-copy-feedback>Copy page</strong><small>Copy page as Markdown for LLMs</small></span></button>${pageActionLink("View as Markdown", "View this page as plain text", markdownUrl, "markdown")}${pageActionLink("Open in ChatGPT", "Ask questions about this page", assistantUrl("https://chatgpt.com/", "hints=search", markdownPrompt), "openai")}${pageActionLink("Open in Claude", "Ask questions about this page", assistantUrl("https://claude.ai/new", "", markdownPrompt), "anthropic")}${pageActionLink("Open in Perplexity", "Ask questions about this page", assistantUrl("https://www.perplexity.ai/search/new", "", markdownPrompt), "perplexity")}</div></details></div></div>`;
}

function pageActionLink(title, description, href, iconName) {
  return `<a class="page-action" href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${icon(iconName)}<span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span><span class="page-action-external" aria-hidden="true">↗</span></a>`;
}

function assistantUrl(baseUrl, extraQuery, prompt) {
  const query = [extraQuery, `q=${encodeURIComponent(prompt)}`].filter(Boolean).join("&");
  return `${baseUrl}?${query}`;
}

function pageMarkdownScript(page) {
  return `<script type="application/json" data-page-markdown>${jsonScript(markdownBodyForCopy(page.raw))}</script>`;
}

function markdownBodyForCopy(markdown) {
  const text = String(markdown || "");
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!frontmatter || !/(^|\n)[A-Za-z0-9_-]+:\s*/.test(frontmatter[1])) return text;
  return text.slice(frontmatter[0].length).replace(/^\s*\n/, "");
}

function pageStatus(page) {
  const meta = page.meta ?? {};
  const badges = [];
  if (truthy(meta.beta)) badges.push(["Beta", "beta"]);
  if (truthy(meta.deprecated)) badges.push(["Deprecated", "deprecated"]);
  if (meta.status) badges.push([`Status: ${meta.status}`, "status"]);
  if (meta.appliesTo) badges.push([`Applies to: ${meta.appliesTo}`, "applies"]);
  if (meta.since) badges.push([`Since ${meta.since}`, "since"]);
  if (meta.updated) badges.push([`Updated ${meta.updated}`, "updated"]);
  return badges.length
    ? `<div class="page-status">${badges.map(([label, kind]) => `<span class="page-status-badge page-status-${kind}">${escapeHtml(label)}</span>`).join("")}</div>`
    : "";
}

function truthy(value) {
  return value === true || value === "true" || value === "yes" || value === 1 || value === "1";
}

function icon(name) {
  const attrs = `class="icon icon-${escapeAttr(name)}" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"`;
  if (name === "github")
    return `<svg ${attrs} fill="currentColor"><path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.08 1.84 2.82 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z"/></svg>`;
  if (name === "discord")
    return `<svg ${attrs} fill="currentColor"><path d="M20.32 4.37A19.8 19.8 0 0 0 15.37 2.84a13.77 13.77 0 0 0-.63 1.31 18.4 18.4 0 0 0-5.48 0 13.7 13.7 0 0 0-.64-1.31 19.72 19.72 0 0 0-4.95 1.54C.55 9.07-.32 13.64.1 18.15a19.9 19.9 0 0 0 6.07 3.07 14.6 14.6 0 0 0 1.3-2.11 12.9 12.9 0 0 1-2.05-.98c.17-.13.34-.26.5-.39a14.2 14.2 0 0 0 12.16 0c.17.14.33.27.5.39-.65.38-1.33.7-2.05.98.38.74.82 1.45 1.3 2.11a19.86 19.86 0 0 0 6.08-3.07c.5-5.23-.84-9.76-3.59-13.78ZM8.02 15.38c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.18 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Z"/></svg>`;
  if (name === "markdown")
    return `<svg class="icon icon-markdown" aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.25 3.75H2.75C1.64543 3.75 0.75 4.64543 0.75 5.75V12.25C0.75 13.3546 1.64543 14.25 2.75 14.25H15.25C16.3546 14.25 17.25 13.3546 17.25 12.25V5.75C17.25 4.64543 16.3546 3.75 15.25 3.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.75 11.25V6.75H8.356L6.25 9.5L4.144 6.75H3.75V11.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 9.5L13.25 11.25L15 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.25 11.25V6.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === "openai")
    return `<svg class="icon icon-openai" aria-hidden="true" focusable="false" fill="currentColor" fill-rule="evenodd" height="18" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg"><path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z"/></svg>`;
  if (name === "anthropic")
    return `<svg class="icon icon-anthropic" aria-hidden="true" focusable="false" fill="currentColor" fill-rule="evenodd" height="18" viewBox="0 0 256 257" width="18" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid"><path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z"/></svg>`;
  if (name === "perplexity")
    return `<svg class="icon icon-perplexity" aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 34 38" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.12114 0.0400391L15.919 9.98864V9.98636V0.062995H18.0209V10.0332L28.8671 0.0400391V11.3829H33.3202V27.744H28.8808V37.8442L18.0209 28.303V37.9538H15.919V28.4604L5.13338 37.96V27.744H0.680176V11.3829H5.12114V0.0400391ZM14.3344 13.4592H2.78208V25.6677H5.13074V21.8167L14.3344 13.4592ZM7.23518 22.7379V33.3271L15.919 25.6786V14.8506L7.23518 22.7379ZM18.0814 25.5775V14.8404L26.7677 22.7282V27.744H26.7789V33.219L18.0814 25.5775ZM28.8808 25.6677H31.2183V13.4592H19.752L28.8808 21.7302V25.6677ZM26.7652 11.3829V4.81584L19.6374 11.3829H26.7652ZM14.3507 11.3829H7.22306V4.81584L14.3507 11.3829Z"/></svg>`;
  const paths = {
    search: '<path d="m21 21-4.35-4.35"/><circle cx="11" cy="11" r="7"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    "corner-down-left": '<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/>',
    globe:
      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    package:
      '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 22V13"/><path d="m3 8v8l9 6 9-6V8"/>',
    moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    "file-text":
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    "message-circle":
      '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
    bot: '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M9 13v2"/><path d="M15 13v2"/><path d="M9 18h6"/>',
    "maximize-2":
      '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/>',
    "minimize-2":
      '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
    minus: '<path d="M5 12h14"/>',
    "refresh-cw":
      '<path d="M21 12a9 9 0 0 1-15.1 6.64"/><path d="M3 12A9 9 0 0 1 18.1 5.36"/><path d="M21 3v6h-6"/><path d="M3 21v-6h6"/>',
    sparkles:
      '<path d="m12 3-1.6 4.4L6 9l4.4 1.6L12 15l1.6-4.4L18 9l-4.4-1.6L12 3Z"/><path d="m19 14-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8L19 14Z"/><path d="m5 4-.7 1.8L2.5 6.5l1.8.7L5 9l.7-1.8 1.8-.7-1.8-.7L5 4Z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    paperclip:
      '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    trash:
      '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  };
  return `<svg ${attrs} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ""}</svg>`;
}

function navGroupHtml(activePage, group) {
  return `<section class="nav-section"><h2>${escapeHtml(group.title)}</h2>${group.pages
    .map((entry) => {
      if (entry.group)
        return `<div class="nav-nested"><h2>${escapeHtml(entry.group)}</h2>${entry.pages.map((page) => navLink(activePage, page)).join("")}</div>`;
      return navLink(activePage, entry);
    })
    .join("")}</section>`;
}

function navLink(activePage, page) {
  const active =
    activePage.locale === page.locale && activePage.slug === page.slug ? " active" : "";
  return `<a class="nav-link${active}" href="${pageUrl(page)}">${escapeHtml(page.title)}</a>`;
}

function tableOfContents(html) {
  return [...html.matchAll(/<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)]
    .map((m) => ({
      level: Number(m[1]),
      id: m[2],
      title: decodeHtmlEntities(stripTags(m[3]).replace(/^#\s*/, "")),
    }))
    .slice(0, 24);
}

function tocHtml(items) {
  if (!items.length) return "";
  return `<details class="toc" aria-label="On this page" open><summary><span>On this page</span></summary><h2>On this page</h2><nav>${items.map((item) => `<a class="toc-l${item.level}" href="#${escapeAttr(item.id)}">${escapeHtml(item.title)}</a>`).join("")}</nav></details>`;
}

function pager(prev, next) {
  if (!prev && !next) return "";
  return `<nav class="page-nav">${prev ? `<a href="${pageUrl(prev)}"><small>Previous</small>${escapeHtml(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${pageUrl(next)}"><small>Next</small>${escapeHtml(next.title)}</a>` : ""}</nav>`;
}

function pageFeedback(page) {
  const editUrl = editSourceUrlForPage(page, sourceMetadata);
  const editLink = editUrl ? `<a href="${escapeAttr(editUrl)}">Edit source</a>` : "";
  const pagePath = pageRoute(page);
  const canonicalUrl = `${docsOrigin()}${pagePath}`;
  return `<section class="page-feedback" aria-label="Page feedback" data-feedback-path="${escapeAttr(pagePath)}" data-feedback-url="${escapeAttr(canonicalUrl)}" data-feedback-repo="${escapeAttr(feedbackIssueRepository)}"><div class="page-feedback-prompt"><span>Was this useful?</span><button type="button" data-feedback-value="yes" aria-pressed="false">Yes</button><button type="button" data-feedback-value="no" aria-pressed="false">No</button><output data-feedback-result></output></div><nav class="page-feedback-links" aria-label="Page source and issue">${editLink}<a href="${escapeAttr(raiseIssueUrl(page))}">Raise issue</a></nav><div class="page-feedback-composer" data-feedback-composer hidden><textarea data-feedback-detail rows="3" placeholder="What were you looking for?" aria-label="What was missing?"></textarea><a class="page-feedback-submit" data-feedback-issue-link target="_blank" rel="noopener noreferrer">${icon("github")}<span>Open issue</span></a></div></section>`;
}

function raiseIssueUrl(page) {
  const title = encodeURIComponent("Issue on docs");
  const body = encodeURIComponent(`Path: ${pageRoute(page)}`);
  return `https://github.com/${feedbackIssueRepository}/issues/new?title=${title}&body=${body}`;
}

function searchModal() {
  const avatar = chatAvatarAssets();
  const molty = chatApiUrl
    ? `<button class="search-molty" type="button" data-search-molty><img src="${avatar.staticPath}" alt=""><span><span data-search-molty-prefix>Ask Molty</span> <strong data-search-molty-term hidden></strong></span><span class="search-molty-shortcut" aria-hidden="true">${icon("command")}${icon("corner-down-left")}</span></button>`
    : "";
  return `<div class="search-modal"><div class="search-panel" role="dialog" aria-modal="true" aria-label="Search documentation"><div class="search-head"><input data-search-input placeholder="${escapeAttr(config.search?.placeholder ?? "Search docs...")}" aria-label="Search documentation"><button class="search-close" type="button" data-search-clear aria-label="Clear search">${icon("x")}</button></div><div class="search-hints" aria-label="Search suggestions">${siteSearchSuggestions.map((label) => `<button type="button" data-search-suggestion="${escapeAttr(label)}">${escapeHtml(label)}</button>`).join("")}</div><div class="search-results" data-search-results role="listbox" aria-label="Search results"></div>${molty}</div></div>`;
}

function writeLlmsIndex() {
  const origin = docsOrigin();
  const lines = [
    `# ${config.name}`,
    "",
    config.description ?? `${config.name} documentation.`,
    "",
    `> Use this file as a lightweight map of the ${config.name} documentation. Fetch individual pages as Markdown with \`.md\` URLs or \`Accept: text/markdown\`.`,
    "",
    "## Agent Resources",
    "",
    `- [Markdown page export](${origin}/index.md): Append \`.md\` to any docs page URL for clean Markdown.`,
    `- [Sitemap](${origin}/sitemap.xml): Search crawler URL index.`,
    `- [Robots policy](${origin}/robots.txt): Bot and crawler policy.`,
    "",
    "## Documentation Index",
    "",
  ];
  if (llmsFullAvailable) {
    lines.splice(
      8,
      0,
      `- [Full documentation corpus](${origin}/llms-full.txt): Nightly full-site Markdown corpus for LLM context.`,
    );
  }
  for (const page of englishDocsPages()) {
    const summary = page.summary
      ? `: ${stripMdxForLlms(page.summary).replace(/\s+/g, " ").trim()}`
      : "";
    lines.push(`- [${page.title}](${origin}${pageRoute(page)})${summary}`);
  }
  const content = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(outDir, "llms.txt"), content, "utf8");
  fs.writeFileSync(path.join(outDir, "llm.txt"), content, "utf8");
  const wellKnownDir = path.join(outDir, ".well-known");
  fs.mkdirSync(wellKnownDir, { recursive: true });
  fs.writeFileSync(path.join(wellKnownDir, "llms.txt"), content, "utf8");
}

function writeRobotsTxt() {
  const origin = docsOrigin();
  const botAgents = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "Google-Extended",
  ];
  const lines = [
    `# ${config.name} documentation crawler policy`,
    "# Human docs are HTML. Agent-optimized docs are available as Markdown via .md URLs or Accept: text/markdown.",
    llmsFullAvailable
      ? "# Agent-optimized docs are available through /llms.txt, page-level Markdown, and the nightly /llms-full.txt corpus."
      : "# Agent-optimized docs are available through /llms.txt and page-level Markdown.",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /__elements",
    "Disallow: /ask-molty/api/",
    "",
  ];
  for (const agent of botAgents) {
    lines.push(`User-agent: ${agent}`);
    lines.push("Allow: /");
    lines.push("Disallow: /__elements");
    lines.push("Disallow: /ask-molty/api/");
    lines.push("");
  }
  lines.push(`Sitemap: ${origin}/sitemap.xml`);
  lines.push(`LLMS: ${origin}/llms.txt`);
  if (llmsFullAvailable) lines.push(`LLMS-Full: ${origin}/llms-full.txt`);
  lines.push("");
  fs.writeFileSync(path.join(outDir, "robots.txt"), lines.join("\n"), "utf8");
}

function writeSitemap() {
  const origin = docsOrigin();
  const urls = [
    ...new Set(pages.filter((page) => !page.hidden).map((page) => `${origin}${pageRoute(page)}`)),
  ].sort((a, b) => a.localeCompare(b));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), xml, "utf8");
}

function englishDocsPages() {
  return pages
    .filter((page) => !page.hidden && page.locale === "en" && !localeLabels[page.rel.split("/")[0]])
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function docsOrigin() {
  return (canonicalOrigin || "https://docs.openclaw.ai").replace(/\/$/, "");
}

function chatAvatarAssets() {
  const staticPath = fs.existsSync(path.join(shellPublicAssetsDir, "molty-avatar.png"))
    ? "/assets/molty-avatar.png"
    : fs.existsSync(path.join(docsDir, "assets", "molty-avatar.png"))
      ? "/assets/molty-avatar.png"
      : "/assets/pixel-lobster.svg";
  const hoverPath = fs.existsSync(path.join(shellPublicAssetsDir, "molty-avatar-hover.gif"))
    ? "/assets/molty-avatar-hover.gif"
    : fs.existsSync(path.join(docsDir, "assets", "molty-avatar-hover.gif"))
      ? "/assets/molty-avatar-hover.gif"
      : staticPath;
  return { staticPath: publicPath(staticPath), hoverPath: publicPath(hoverPath) };
}

function chatWidget() {
  if (!chatApiUrl) return "";
  const avatar = chatAvatarAssets();
  return `<section class="docs-chat" data-docs-chat aria-label="${escapeAttr(siteChatLabel)}">
<button class="docs-chat-launcher" type="button" data-chat-toggle aria-expanded="false" aria-controls="docs-chat-panel"><img class="docs-chat-avatar" src="${avatar.staticPath}" data-static-src="${avatar.staticPath}" data-hover-src="${avatar.hoverPath}" alt=""><span>Ask Molty</span></button>
<div class="docs-chat-panel" id="docs-chat-panel" data-chat-panel role="dialog" aria-modal="false" aria-labelledby="docs-chat-title" aria-hidden="true" inert>
<header class="docs-chat-head"><div class="docs-chat-title"><img class="docs-chat-avatar" src="${avatar.staticPath}" data-static-src="${avatar.staticPath}" data-hover-src="${avatar.hoverPath}" alt=""><h2 id="docs-chat-title">${escapeHtml(siteChatName)}</h2></div><div class="docs-chat-actions"><button class="docs-chat-icon docs-chat-maximize" type="button" data-chat-maximize aria-label="Maximize docs assistant" aria-pressed="false">${icon("maximize-2")}</button><button class="docs-chat-icon docs-chat-copy" type="button" data-chat-copy aria-label="Copy conversation" hidden>${icon("copy")}</button><button class="docs-chat-icon docs-chat-retry" type="button" data-chat-retry aria-label="Reload last answer" hidden disabled>${icon("refresh-cw")}</button><button class="docs-chat-icon docs-chat-clear" type="button" data-chat-clear aria-label="Clear conversation" hidden>${icon("trash")}</button><button class="docs-chat-icon docs-chat-minimize" type="button" data-chat-minimize aria-label="Minimize docs assistant">${icon("minus")}</button></div></header>
<div class="docs-chat-auth" data-chat-auth hidden></div>
<div class="docs-chat-log" data-chat-log aria-live="polite">
<div class="docs-chat-empty">Responses are generated using AI and may contain mistakes.</div>
</div>
<form class="docs-chat-form" data-chat-form><textarea data-chat-input rows="2" maxlength="2000" placeholder="Ask a question..."></textarea><span class="docs-chat-attach" aria-hidden="true">${icon("paperclip")}</span><button type="submit" data-chat-submit aria-label="Send">${icon("send")}</button></form>
</div>
</section>`;
}

function writeRedirects() {
  for (const redirect of config.redirects ?? []) {
    const source = cleanPath(redirect.source);
    const dest = cleanPath(redirect.destination);
    writeRedirectFile(source, publicPath(dest));
    for (const prefix of new Set([basePath, legacyBasePath].filter(Boolean))) {
      writeRedirectFile(`${prefix}${source}`, publicPath(dest));
    }
  }
}

function writeRedirectFile(source, dest) {
  const target = path.join(outDir, source.replace(/^\//, ""), "index.html");
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, redirectHtml(dest), "utf8");
}

function redirectHtml(dest) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${escapeAttr(dest)}"><link rel="canonical" href="${escapeAttr(dest)}"><title>Redirecting - ${escapeHtml(config.name)}</title><script>location.replace(${JSON.stringify(dest)})</script></head><body><a href="${escapeAttr(dest)}">Redirecting</a></body></html>`;
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

function expandSnippets(input, sourceFile, seen = new Set()) {
  return input.replace(/<Snippet\b([^>]*)\/>/g, (_, rawAttrs) => {
    const attrs = parseSimpleAttrs(rawAttrs);
    const ref = attrs.file ?? attrs.src;
    if (!ref) return "";
    const target = path.resolve(path.dirname(sourceFile), ref);
    if (!target.startsWith(root) || seen.has(target) || !fs.existsSync(target)) return "";
    const nextSeen = new Set(seen);
    nextSeen.add(target);
    const parsed = matter(fs.readFileSync(target, "utf8"));
    return `\n${expandSnippets(parsed.content, target, nextSeen).trim()}\n`;
  });
}

function parseSimpleAttrs(rawAttrs) {
  return Object.fromEntries(
    [
      ...String(rawAttrs).matchAll(
        /([A-Za-z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s>]+))/g,
      ),
    ].map((match) => [match[1], match[2] ?? match[3] ?? match[4] ?? match[5] ?? ""]),
  );
}

async function renderPageOgCards() {
  const enNav = navByLocale.get("en") ?? [];
  const navSlugs = collectNavSlugs(enNav);
  const ogDir = path.join(outDir, "og");
  const targets = pages.filter(
    (page) => page.locale === "en" && page.slug !== "index" && navSlugs.has(page.slug),
  );
  const start = Date.now();
  const concurrency = Math.max(2, Math.min(8, Number(process.env.DOCS_SITE_OG_CONCURRENCY) || 6));
  let cursor = 0;
  let count = 0;
  const failures = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < targets.length) {
        const page = targets[cursor++];
        const kicker =
          groupForPage(enNav, page.slug) ?? activeTabTitle(enNav, page.slug) ?? config.name;
        const svg = renderPageOgSvg({ title: page.title, kicker, summary: page.summary });
        const outFile = path.join(ogDir, `${page.slug}.png`);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        try {
          fs.writeFileSync(outFile, await renderOgPng(svg));
          renderedPageOgCards.add(page.slug);
          count++;
        } catch (err) {
          failures.push(`${page.slug}: ${err.message}`);
        }
      }
    }),
  );
  if (failures.length) {
    const details = failures.slice(0, 5).join("; ");
    throw new Error(
      `failed to render ${failures.length}/${targets.length} per-page og cards: ${details}`,
    );
  }
  console.log(`rendered ${count}/${targets.length} per-page og cards in ${Date.now() - start}ms`);
}

function renderOgPng(svg) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./og-render-worker.mjs", import.meta.url), {
      workerData: { svg },
    });
    let settled = false;
    worker.on("message", (message) => {
      if (settled) return;
      settled = true;
      if (message?.error) reject(new Error(message.error));
      else resolve(Buffer.from(message.png));
    });
    worker.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    worker.on("exit", (code) => {
      if (settled || code === 0) return;
      settled = true;
      reject(new Error(`og render worker exit ${code}`));
    });
  });
}

function collectNavSlugs(nav) {
  const slugs = new Set();
  for (const tab of nav) {
    for (const group of tab.groups ?? []) {
      for (const entry of group.pages ?? []) {
        if (entry.group) for (const sub of entry.pages ?? []) slugs.add(sub.slug);
        else if (entry.slug) slugs.add(entry.slug);
      }
    }
  }
  return slugs;
}

function writeStaticAssets() {
  const assetsDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  copyDir(shellPublicAssetsDir, assetsDir);
  fs.writeFileSync(path.join(assetsDir, "docs-site.css"), shellCss, "utf8");
  fs.writeFileSync(path.join(assetsDir, "docs-site.js"), shellJs, "utf8");
  const mermaidDist = path.join(root, "node_modules", "mermaid", "dist");
  const mermaidEntry = path.join(mermaidDist, "mermaid.esm.min.mjs");
  if (fs.existsSync(mermaidEntry)) {
    fs.copyFileSync(mermaidEntry, path.join(assetsDir, "mermaid.esm.min.mjs"));
    copyDir(
      path.join(mermaidDist, "chunks", "mermaid.esm.min"),
      path.join(assetsDir, "chunks", "mermaid.esm.min"),
      {
        filter: (source) => !source.endsWith(".map"),
      },
    );
  }
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
  for (const file of ["og-card.png", "og-card.svg"]) {
    const source = path.join(siteAssetsDir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(outDir, file));
  }
  if (process.env.DOCS_SITE_CNAME) {
    fs.writeFileSync(path.join(outDir, "CNAME"), `${process.env.DOCS_SITE_CNAME}\n`, "utf8");
  }
}

function copyPublicFiles() {
  copyDir(path.join(docsDir, "assets"), path.join(outDir, "assets"));
  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      !ignoredDocFiles.has(entry.name) &&
      !/\.(md|mdx|json)$/.test(entry.name)
    ) {
      fs.copyFileSync(path.join(docsDir, entry.name), path.join(outDir, entry.name));
    }
  }
}

function copyDir(source, dest, options = {}) {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, dest, { recursive: true, filter: options.filter });
}

function activeTabTitle(nav, slug) {
  return (
    nav.find((tab) => flattenNav([tab]).some((page) => page.slug === slug))?.title ??
    nav[0]?.title ??
    ""
  );
}

function groupForPage(nav, slug) {
  for (const tab of nav) {
    for (const group of tab.groups) {
      if (
        group.pages.some((entry) =>
          entry.group ? entry.pages.some((page) => page.slug === slug) : entry.slug === slug,
        )
      ) {
        return group.title;
      }
    }
  }
}

function flattenNavEntries(entries) {
  return entries.flatMap((entry) => (entry.group ? flattenNavEntries(entry.pages) : [entry]));
}

function flattenNav(nav) {
  return nav.flatMap((tab) => tab.groups.flatMap((group) => flattenNavEntries(group.pages)));
}

function firstPage(tab) {
  for (const group of tab.groups) {
    for (const entry of group.pages) return entry.group ? entry.pages[0] : entry;
  }
  return pages[0];
}

function localeUrlForSlug(locale, slug) {
  return pageByKey.has(pageKey(locale, slug))
    ? pageUrl(pageByKey.get(pageKey(locale, slug)))
    : publicPath(locale === "en" ? "/" : `/${locale}/`);
}

function internalPageUrl(page) {
  return pageByKey.has(pageKey(page.locale, page.slug))
    ? pageUrl(page)
    : `${docsOrigin()}${pageRoute(page)}`;
}

function pageUrl(page) {
  return publicPath(pageRoute(page));
}

function pageRoute(page) {
  const prefix = page.locale === "en" ? "" : `/${page.locale}`;
  return page.slug === "index" ? prefix || "/" : `${prefix}/${page.slug}`;
}

function hreflangLinks(page) {
  // hreflang alternates require absolute URLs; skip when no canonical origin is set
  // or when the page is excluded from indexing.
  if (!canonicalOrigin || page.hidden) return "";
  // Collect every locale that publishes this same slug, using the current page for
  // its own locale and skipping any locale variant that is itself hidden.
  const variants = [];
  for (const locale of locales) {
    const variant =
      locale.code === page.locale ? page : allPageByKey.get(pageKey(locale.code, page.slug));
    if (variant && !variant.hidden) variants.push(variant);
  }
  // Nothing to cross-link if the page exists in only one locale.
  if (variants.length < 2) return "";
  const links = variants.map(
    (variant) =>
      `<link rel="alternate" hreflang="${escapeAttr(htmlLang(variant.locale))}" href="${escapeAttr(`${canonicalOrigin}${pageRoute(variant)}`)}">`,
  );
  // x-default points at the English variant when available, otherwise the current page.
  const defaultPage = variants.find((variant) => variant.locale === "en") ?? page;
  links.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeAttr(`${canonicalOrigin}${pageRoute(defaultPage)}`)}">`,
  );
  return `${links.join("\n")}\n`;
}

function pageMarkdownRoute(page) {
  const prefix = page.locale === "en" ? "" : `/${page.locale}`;
  return page.slug === "index" ? `${prefix || ""}/index.md` : `${prefix}/${page.slug}.md`;
}

function rewriteInternalUrls(html, page) {
  return html.replace(/\b(href|src)="([^"]*)"/g, (match, attr, value) => {
    const rewritten = rewriteUrl(attr, value, page);
    return rewritten === value ? match : `${attr}="${escapeAttr(rewritten)}"`;
  });
}

function rewriteUrl(attr, value, page) {
  if (shouldSkipUrl(value)) return value;
  const { pathname, suffix } = splitUrl(value);
  if (!pathname) return value;

  if (attr === "src") {
    if (pathname.startsWith("/")) return `${publicPath(pathname)}${suffix}`;
    return `${publicPath(`/${resolveDocsRelativePath(page.rel, pathname)}`)}${suffix}`;
  }

  if (pathname.startsWith("/")) return rewriteRootHref(pathname, suffix, page.locale);
  return rewriteRelativeHref(pathname, suffix, page);
}

function shouldSkipUrl(value) {
  return (
    !value || value.startsWith("#") || value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(value)
  );
}

function splitUrl(value) {
  const match = String(value).match(/^([^?#]*)([?#].*)?$/u);
  return { pathname: match?.[1] ?? value, suffix: match?.[2] ?? "" };
}

function rewriteRootHref(pathname, suffix, locale) {
  const target = pathname.replace(/^\/+/, "");
  if (!target || target.startsWith("assets/") || target.startsWith("pagefind/")) {
    return `${publicPath(pathname)}${suffix}`;
  }
  const targetPage = pageForDocPath(target, locale);
  return targetPage ? `${internalPageUrl(targetPage)}${suffix}` : `${pathname}${suffix}`;
}

function rewriteRelativeHref(pathname, suffix, page) {
  const resolved = resolveDocsRelativePath(page.rel, pathname);
  const targetPage = pageForDocPath(resolved, page.locale);
  if (targetPage) return `${internalPageUrl(targetPage)}${suffix}`;
  if (resolved.startsWith("../")) {
    return `${sourceFileUrl(resolveRepositoryRelativePath(page.rel, pathname))}${suffix}`;
  }
  return `${publicPath(`/${resolved}`)}${suffix}`;
}

function pageForDocPath(target, locale) {
  const clean = target.replace(/\/$/, "").replace(/\.(md|mdx)$/iu, "");
  const segments = clean.split("/");
  const maybeLocale = segments[0];
  const localizedSlug = normalizeHomeSlug(normalizeSlug(segments.slice(1).join("/") || "index"));
  const localizedPage = allPageByKey.get(pageKey(maybeLocale, localizedSlug));
  if (localizedPage) return localizedPage;
  const slug = normalizeHomeSlug(normalizeSlug(clean));
  return allPageByKey.get(pageKey(locale, slug)) ?? allPageByKey.get(pageKey("en", slug));
}

function resolveDocsRelativePath(sourceRel, target) {
  const sourceDir = path.posix.dirname(sourceRel);
  const base = sourceDir === "." ? "" : sourceDir;
  return path.posix.normalize(path.posix.join(base, target));
}

function resolveRepositoryRelativePath(sourceRel, target) {
  const sourceDir = path.posix.dirname(`docs/${sourceRel}`);
  return path.posix.normalize(path.posix.join(sourceDir, target)).replace(/^(\.\.\/)+/u, "");
}

function sourceFileUrl(sourcePath) {
  return `${sourceRepositoryUrl}/blob/main/${encodePath(sourcePath)}`;
}

function pageKey(locale, slug) {
  return `${locale}:${slug}`;
}

function fileSlug(rel) {
  return normalizeSlug(rel.replace(/\.(md|mdx)$/, ""));
}

function normalizeHomeSlug(slug) {
  return slug === siteHomeSlug ? "index" : slug;
}

function normalizeSlug(value) {
  return value.replace(/\/index$/, "") || "index";
}

function normalizeAssetPath(value) {
  const assetPath = String(value || "").trim() || "/assets/pixel-lobster.svg";
  return assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
}

function cleanPath(value) {
  const [pathname, hash = ""] = String(value).split("#");
  const cleaned = pathname.replace(/\/$/, "") || "/";
  return hash ? `${cleaned}#${hash}` : cleaned;
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

function normalizeRepository(value) {
  const repo = String(value).trim();
  return /^[^/\s]+\/[^/\s]+$/.test(repo) ? repo : "openclaw/openclaw";
}

function normalizeGithubRepositoryUrl(value) {
  try {
    const url = new URL(value);
    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (owner && repo) return `${url.origin}/${owner}/${repo.replace(/\.git$/u, "")}`;
  } catch {}
  return `https://github.com/${normalizeRepository(value)}`;
}

function encodePath(value) {
  return String(value).split("/").map(encodeURIComponent).join("/");
}

function htmlLang(locale) {
  return locale === "zh-CN" ? "zh-CN" : locale === "zh-TW" ? "zh-TW" : locale;
}

function firstHeading(markdown) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
  return heading === undefined ? undefined : textFromHtml(heading).trim();
}

function titleize(value) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function stripTags(value) {
  return textFromHtml(value).replace(/\s+/g, " ").trim();
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

function decodeHtmlEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function jsonScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}
