import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import http from "highlight.js/lib/languages/http";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";

const markerPrefix = "OPENCLAW_DOCS_MARKER";
const inlineMarkerPrefix = "OPENCLAW_DOCS_INLINE";
const languages = {
  bash,
  css,
  diff,
  dockerfile,
  go,
  http,
  ini,
  java,
  javascript,
  json,
  markdown,
  powershell,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language);
const languageAliases = new Map([
  ["sh", "bash"],
  ["zsh", "bash"],
  ["console", "bash"],
  ["terminal", "bash"],
  ["ps1", "powershell"],
  ["pwsh", "powershell"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["jsonc", "json"],
  ["json5", "javascript"],
  ["yml", "yaml"],
  ["html", "xml"],
  ["md", "markdown"],
  ["text", "plaintext"],
  ["txt", "plaintext"],
]);
const knownBlocks = new Map([
  ["AccordionGroup", ["accordion-group", ""]],
  ["Steps", ["steps", ""]],
  ["Tabs", ["tabs", ""]],
  ["CodeGroup", ["code-group", ""]],
  ["TileGroup", ["tile-group", ""]],
  ["CTAGroup", ["cta-grid", ""]],
  ["StatGrid", ["stat-grid", ""]],
]);
const callouts = new Map([
  ["Note", "Note"],
  ["Warning", "Warning"],
  ["Tip", "Tip"],
  ["Info", "Info"],
  ["Check", "Check"],
  ["Say", "Say"],
  ["Banner", "Banner"],
  ["Update", "Update"],
]);

export function createMarkdownRenderer() {
  const md = new MarkdownIt({
    html: true,
    linkify: false,
    typographer: false,
    highlight: highlightCode,
  }).use(anchor);
  const renderHeadingClose = md.renderer.rules.heading_close ?? renderToken;
  md.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
    const headingOpen = tokens[idx - 2];
    const id = headingOpen?.type === "heading_open" ? headingOpen.attrGet("id") : "";
    const copyAnchor = id ? headingAnchorButton(id) : "";
    return `${copyAnchor}${renderHeadingClose(tokens, idx, options, env, self)}`;
  };
  md.renderer.rules.fence = renderFence;
  return md;
}

function renderToken(tokens, idx, options, _env, self) {
  return self.renderToken(tokens, idx, options);
}

function headingAnchorButton(id) {
  return `<button type="button" class="heading-anchor" data-heading-anchor="${escapeAttr(id)}" data-copy-label="Copy link to section" aria-label="Copy link to section">${headingLinkIcon()}${headingCheckIcon()}</button>`;
}

function headingLinkIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="heading-anchor-icon heading-anchor-link lucide lucide-link-icon lucide-link" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
}

function headingCheckIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="heading-anchor-icon heading-anchor-check lucide lucide-check-icon lucide-check" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>`;
}

function renderFence(tokens, idx) {
  const token = tokens[idx];
  const { lang, label, lines, highlight, focus, wrap, expandable } = parseCodeInfo(token.info);
  if (lang === "mermaid") return mermaidHtml(token.content);
  const highlighted = renderCodeLines(token.content, lang, { highlight, focus });
  const className = lang ? ` class="language-${escapeAttr(lang)}"` : "";
  const dataLabel = label || lang || "Code";
  const classes = [
    "oc-code",
    lines ? "has-line-numbers" : "",
    wrap ? "is-wrapped" : "",
    expandable ? "is-expandable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const expandControl = expandable
    ? `<button type="button" class="oc-code-expand" data-code-expand aria-expanded="false">Show more</button>`
    : "";
  return `<figure class="${classes}" data-code-label="${escapeAttr(dataLabel)}"><figcaption><span class="oc-code-label">${escapeHtml(dataLabel)}</span><button type="button" data-code-copy data-copy-label="Copy code" aria-label="Copy code"><span class="oc-visually-hidden">Copy code</span></button></figcaption><pre><code${className}>${highlighted}</code></pre>${expandControl}</figure>`;
}

function parseCodeInfo(rawInfo = "") {
  const info = String(rawInfo).trim();
  const base = {
    lang: "",
    label: "",
    lines: false,
    highlight: new Set(),
    focus: new Set(),
    wrap: false,
    expandable: false,
  };
  if (!info) return base;
  const parts = info.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  base.lang = normalizeLang(parts.shift() ?? "");
  const labelParts = [];
  for (const rawPart of parts) {
    const part = rawPart.replace(/^["']|["']$/g, "");
    if (["lines", "lineNumbers", "numbers"].includes(part)) {
      base.lines = true;
    } else if (part === "wrap") {
      base.wrap = true;
    } else if (part === "expand" || part === "expandable") {
      base.expandable = true;
    } else if (/^\{[^}]+\}$/.test(part)) {
      base.highlight = parseLineSet(part.slice(1, -1));
    } else if (part.startsWith("highlight=")) {
      base.highlight = parseLineSet(part.slice("highlight=".length));
    } else if (part.startsWith("focus=")) {
      base.focus = parseLineSet(part.slice("focus=".length));
    } else if (
      part.startsWith("title=") ||
      part.startsWith("filename=") ||
      part.startsWith("label=")
    ) {
      labelParts.push(part.replace(/^[^=]+=/, ""));
    } else {
      labelParts.push(part);
    }
  }
  base.label = labelParts.join(" ").trim();
  return base;
}

function parseLineSet(raw) {
  const set = new Set();
  for (const piece of String(raw)
    .replace(/[[\]"]/g, "")
    .split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let i = Math.min(start, end); i <= Math.max(start, end); i++) set.add(i);
    } else {
      const line = Number(trimmed);
      if (Number.isFinite(line) && line > 0) set.add(line);
    }
  }
  return set;
}

function renderCodeLines(code, lang, options) {
  const rawLines = String(code).replace(/\n$/, "").split("\n");
  const focusActive = options.focus.size > 0;
  return rawLines
    .map((line, index) => {
      const number = index + 1;
      const classes = [
        "code-line",
        line.startsWith("+") ? "is-added" : "",
        line.startsWith("-") ? "is-removed" : "",
        options.highlight.has(number) ? "is-highlighted" : "",
        focusActive && !options.focus.has(number) ? "is-dimmed" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const content = line ? highlightCode(line, lang) : " ";
      return `<span class="${classes}" data-line="${number}">${content}</span>`;
    })
    .join("");
}

function highlightCode(code, rawLang = "") {
  const lang = normalizeLang(rawLang);
  const language = languageAliases.get(lang) ?? lang;
  if (!language || language === "plaintext") return escapeHtml(code);
  if (hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

function normalizeLang(rawLang) {
  return (
    String(rawLang)
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/^language-/, "") ?? ""
  );
}

function mermaidHtml(source) {
  const diagram = String(source).trim();
  return `<figure class="oc-mermaid" data-mermaid="${escapeAttr(diagram)}"><pre><code>${escapeHtml(diagram)}</code></pre></figure>`;
}

export function renderMdxish(markdown, md) {
  const prepared = preprocess(markdown);
  return postprocess(md.render(prepared));
}

function preprocess(input) {
  let out = input.replace(/\r\n/g, "\n");
  out = out.replace(/^import\s+.+?;?\s*$/gm, "");
  out = out.replace(
    /<Mermaid\b[^>]*>([\s\S]*?)<\/Mermaid>/g,
    (_, body) => `\n${marker("mermaidBlock", body)}\n`,
  );
  out = out.replace(
    /<Chart\b([^>]*)\/>/g,
    (_, attrs) => `\n${marker("chart", JSON.stringify({ attrs, body: "" }))}\n`,
  );
  out = out.replace(
    /<Chart\b([^>]*)>([\s\S]*?)<\/Chart>/g,
    (_, attrs, body) => `\n${marker("chart", JSON.stringify({ attrs, body }))}\n`,
  );
  out = replaceBreaksOutsideFences(out);

  out = out.replace(/<Card\b([^>]*)\/>/g, (_, attrs) => `${marker("cardSelf", attrs)}\n`);
  out = out.replace(/<Card\b([^>]*)>/g, (_, attrs) => `\n${marker("cardOpen", attrs)}\n`);
  out = out.replace(/<\/Card>/g, `\n${marker("cardClose")}\n`);
  out = out.replace(/<CTA\b([^>]*)>/g, (_, attrs) => `\n${marker("ctaOpen", attrs)}\n`);
  out = out.replace(/<\/CTA>/g, `\n${marker("ctaClose")}\n`);
  out = out.replace(/<CTACard\b([^>]*)\/>/g, (_, attrs) => `${marker("ctaCardSelf", attrs)}\n`);
  out = out.replace(/<CTACard\b([^>]*)>/g, (_, attrs) => `\n${marker("ctaCardOpen", attrs)}\n`);
  out = out.replace(/<\/CTACard>/g, `\n${marker("ctaCardClose")}\n`);
  out = out.replace(
    /<CardGroup\b([^>]*)>/g,
    (_, attrs) => `\n${marker("blockOpen", cardGridClass(attrs))}\n`,
  );
  out = out.replace(/<\/CardGroup>/g, `\n${marker("blockClose", "card-grid")}\n`);
  out = out.replace(
    /<Columns\b([^>]*)>/g,
    (_, attrs) => `\n${marker("blockOpen", cardGridClass(attrs))}\n`,
  );
  out = out.replace(/<\/Columns>/g, `\n${marker("blockClose", "card-grid")}\n`);
  out = out.replace(/<Lead\b[^>]*>/g, `\n${marker("leadOpen")}\n`);
  out = out.replace(/<\/Lead>/g, `\n${marker("leadClose")}\n`);
  out = out.replace(/<PullQuote\b([^>]*)>/g, (_, attrs) => `\n${marker("pullQuoteOpen", attrs)}\n`);
  out = out.replace(/<\/PullQuote>/g, `\n${marker("pullQuoteClose")}\n`);
  out = out.replace(/<Stat\b([^>]*)\/>/g, (_, attrs) => `${marker("statSelf", attrs)}\n`);
  out = out.replace(/<Stat\b([^>]*)>/g, (_, attrs) => `\n${marker("statOpen", attrs)}\n`);
  out = out.replace(/<\/Stat>/g, `\n${marker("statClose")}\n`);

  out = out.replace(/<Step\b([^>]*)>/g, (_, attrs) => `\n${marker("stepOpen", attrs)}\n`);
  out = out.replace(/<\/Step>/g, `\n${marker("stepClose")}\n`);
  out = out.replace(/<Tab\b([^>]*)>/g, (_, attrs) => `\n${marker("tabOpen", attrs)}\n`);
  out = out.replace(/<\/Tab>/g, `\n${marker("tabClose")}\n`);
  out = out.replace(/<Accordion\b([^>]*)>/g, (_, attrs) => `\n${marker("accordionOpen", attrs)}\n`);
  out = out.replace(/<\/Accordion>/g, `\n${marker("accordionClose")}\n`);
  out = out.replace(
    /<Expandable\b([^>]*)>/g,
    (_, attrs) => `\n${marker("accordionOpen", attrs)}\n`,
  );
  out = out.replace(/<\/Expandable>/g, `\n${marker("accordionClose")}\n`);
  out = out.replace(/<Frame\b([^>]*)>/g, (_, attrs) => `\n${marker("frameOpen", attrs)}\n`);
  out = out.replace(/<\/Frame>/g, `\n${marker("frameClose")}\n`);
  out = out.replace(/<Panel\b([^>]*)>/g, (_, attrs) => `\n${marker("panelOpen", attrs)}\n`);
  out = out.replace(/<\/Panel>/g, `\n${marker("panelClose")}\n`);
  out = out.replace(/<Prompt\b([^>]*)>/g, (_, attrs) => `\n${marker("promptOpen", attrs)}\n`);
  out = out.replace(/<\/Prompt>/g, `\n${marker("promptClose")}\n`);
  out = out.replace(/<ParamField\b([^>]*)>/g, (_, attrs) => `\n${marker("paramOpen", attrs)}\n`);
  out = out.replace(/<\/ParamField>/g, `\n${marker("paramClose")}\n`);
  out = out.replace(
    /<(?:Field|Property|ResponseField)\b([^>]*)>/g,
    (_, attrs) => `\n${marker("paramOpen", attrs)}\n`,
  );
  out = out.replace(/<\/(?:Field|Property|ResponseField)>/g, `\n${marker("paramClose")}\n`);
  out = out.replace(/<Tile\b([^>]*)\/>/g, (_, attrs) => `${marker("tileSelf", attrs)}\n`);
  out = out.replace(/<Tile\b([^>]*)>/g, (_, attrs) => `\n${marker("tileOpen", attrs)}\n`);
  out = out.replace(/<\/Tile>/g, `\n${marker("tileClose")}\n`);
  out = out.replace(/<Badge\b([^>]*)\/>/g, (_, attrs) => inlineMarker("badgeSelf", attrs));
  out = out.replace(/<Badge\b([^>]*)>/g, (_, attrs) => inlineMarker("badgeOpen", attrs));
  out = out.replace(/<\/Badge>/g, inlineMarker("badgeClose"));
  out = out.replace(/<Tooltip\b([^>]*)>/g, (_, attrs) => inlineMarker("tooltipOpen", attrs));
  out = out.replace(/<\/Tooltip>/g, inlineMarker("tooltipClose"));

  for (const [name, [kind]] of knownBlocks) {
    out = out.replace(new RegExp(`<${name}\\b[^>]*>`, "g"), `\n${marker("blockOpen", kind)}\n`);
    out = out.replace(new RegExp(`</${name}>`, "g"), `\n${marker("blockClose", kind)}\n`);
  }
  for (const [name, label] of callouts) {
    out = out.replace(new RegExp(`<${name}\\b[^>]*>`, "g"), `\n${marker("calloutOpen", label)}\n`);
    out = out.replace(new RegExp(`</${name}>`, "g"), `\n${marker("calloutClose")}\n`);
  }

  out = out.replace(/<([A-Z][A-Za-z0-9_.-]*)([^>]*)>/g, (_, name, attrs) =>
    escapeHtml(`<${name}${attrs}>`),
  );
  out = out.replace(/<\/([A-Z][A-Za-z0-9_.-]*)>/g, (_, name) => escapeHtml(`</${name}>`));
  return dedentComponentChildren(out);
}

function replaceBreaksOutsideFences(input) {
  const lines = input.split("\n");
  let fence = null;
  return lines
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
      if (marker) {
        if (!fence) {
          fence = { char: marker[0], length: marker.length };
        } else if (marker[0] === fence.char && marker.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      return fence ? line : line.replace(/<br\s*\/?>/gi, "\n");
    })
    .join("\n");
}

function postprocess(html) {
  const state = {
    cta: [],
    ctaCard: [],
    pullQuote: [],
  };
  return html
    .replace(new RegExp(`<p>${markerPrefix}:([^<]+)</p>`, "g"), (_, payload) =>
      expandMarker(payload, state),
    )
    .replace(
      /<table>([\s\S]*?)<\/table>/g,
      `<div class="oc-table-wrap"><table class="oc-table">$1</table></div>`,
    )
    .replace(
      new RegExp(`${inlineMarkerPrefix}:([A-Za-z0-9]+):([A-Za-z0-9_-]*):`, "g"),
      (_, kind, encoded) => expandInlineMarker(`${kind}:${encoded}`),
    );
}

function marker(kind, payload = "") {
  return `${markerPrefix}:${kind}:${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function inlineMarker(kind, payload = "") {
  return `${inlineMarkerPrefix}:${kind}:${Buffer.from(payload, "utf8").toString("base64url")}:`;
}

function expandMarker(payload, state = {}) {
  const [kind, encoded = ""] = payload.split(":");
  const value = Buffer.from(encoded, "base64url").toString("utf8");
  if (kind === "blockOpen") return `<div class="oc-${escapeAttr(value)}">`;
  if (kind === "blockClose") return "</div>";
  if (kind === "calloutOpen")
    return `<aside class="oc-callout oc-callout-${slug(value)}"><strong>${escapeHtml(value)}</strong>`;
  if (kind === "calloutClose") return "</aside>";
  if (kind === "chart") return chartHtml(value);
  if (kind === "cardSelf") return cardHtml(value, true);
  if (kind === "cardOpen") return cardHtml(value, false);
  if (kind === "cardClose") return "</div></a>";
  if (kind === "ctaOpen") {
    const attrs = parseAttrs(value);
    state.cta?.push(attrs);
    const tone = slug(attrs.tone ?? attrs.variant ?? "default");
    const eyebrow = attrs.eyebrow ? `<span>${escapeHtml(attrs.eyebrow)}</span>` : "";
    return `<section class="oc-cta oc-cta-${tone}"><div class="oc-cta-copy">${eyebrow}<strong>${escapeHtml(attrs.title ?? "Next step")}</strong>`;
  }
  if (kind === "ctaClose") {
    const attrs = state.cta?.pop() ?? {};
    return `</div>${ctaActions(attrs)}</section>`;
  }
  if (kind === "ctaCardSelf") return ctaCardHtml(value, true);
  if (kind === "ctaCardOpen") {
    const attrs = parseAttrs(value);
    state.ctaCard?.push(attrs);
    return ctaCardHtml(value, false);
  }
  if (kind === "ctaCardClose") {
    const attrs = state.ctaCard?.pop() ?? {};
    return `${ctaActions(attrs, "card")}</div></a>`;
  }
  if (kind === "leadOpen") return `<div class="oc-lead">`;
  if (kind === "leadClose") return "</div>";
  if (kind === "pullQuoteOpen") {
    const attrs = parseAttrs(value);
    state.pullQuote?.push(attrs);
    return `<figure class="oc-pullquote"><blockquote>`;
  }
  if (kind === "pullQuoteClose") {
    const attrs = state.pullQuote?.pop() ?? {};
    return `</blockquote>${attrs.cite ? `<figcaption>${escapeHtml(attrs.cite)}</figcaption>` : ""}</figure>`;
  }
  if (kind === "statSelf") return statHtml(value, true);
  if (kind === "statOpen") return statHtml(value, false);
  if (kind === "statClose") return "</div></section>";
  if (kind === "stepOpen")
    return `<li class="oc-step"><h3>${escapeHtml(parseAttrs(value).title ?? "Step")}</h3>`;
  if (kind === "stepClose") return "</li>";
  if (kind === "tabOpen")
    return `<section class="oc-tab"><h3>${escapeHtml(parseAttrs(value).title ?? "Tab")}</h3>`;
  if (kind === "tabClose") return "</section>";
  if (kind === "accordionOpen")
    return `<details class="oc-accordion"><summary>${escapeHtml(parseAttrs(value).title ?? "Details")}</summary>`;
  if (kind === "accordionClose") return "</details>";
  if (kind === "panelOpen") {
    const attrs = parseAttrs(value);
    const title = attrs.title ? `<strong>${escapeHtml(attrs.title)}</strong>` : "";
    return `<section class="oc-panel">${title}`;
  }
  if (kind === "panelClose") return "</section>";
  if (kind === "promptOpen") {
    const attrs = parseAttrs(value);
    const title = attrs.title ?? "Prompt";
    return `<section class="oc-prompt"><header><strong>${escapeHtml(title)}</strong><button type="button" data-prompt-copy aria-label="Copy prompt">Copy</button></header>`;
  }
  if (kind === "promptClose") return "</section>";
  if (kind === "mermaidBlock") return mermaidHtml(value);
  if (kind === "frameOpen") {
    const caption = parseAttrs(value).caption;
    return `<figure class="oc-frame">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}`;
  }
  if (kind === "frameClose") return "</figure>";
  if (kind === "paramOpen") {
    const attrs = parseAttrs(value);
    const required =
      attrs.required !== undefined ? `<span class="oc-param-required">required</span>` : "";
    const type = attrs.type ? `<span class="oc-param-type">${escapeHtml(attrs.type)}</span>` : "";
    const defaultValue = attrs.default
      ? `<span class="oc-param-default">default: ${escapeHtml(attrs.default)}</span>`
      : "";
    return `<section class="oc-param"><header><code>${escapeHtml(attrs.path ?? attrs.name ?? "param")}</code>${type}${defaultValue}${required}</header>`;
  }
  if (kind === "paramClose") return "</section>";
  if (kind === "tileSelf") return tileHtml(value, true);
  if (kind === "tileOpen") return tileHtml(value, false);
  if (kind === "tileClose") return "</div></a>";
  return "";
}

function expandInlineMarker(payload) {
  const [kind, encoded = ""] = payload.split(":");
  const value = Buffer.from(encoded, "base64url").toString("utf8");
  if (kind === "tooltipOpen") {
    const attrs = parseAttrs(value);
    const tip = attrs.tip ?? attrs.title ?? "";
    return `<span class="oc-tooltip" tabindex="0"${tip ? ` data-tip="${escapeAttr(tip)}"` : ""}>`;
  }
  if (kind === "tooltipClose") return "</span>";
  if (kind === "badgeSelf") {
    const attrs = parseAttrs(value);
    return `<span class="oc-badge oc-badge-${slug(attrs.color ?? attrs.variant ?? "default")}">${escapeHtml(attrs.text ?? attrs.label ?? attrs.children ?? "Badge")}</span>`;
  }
  if (kind === "badgeOpen") {
    const attrs = parseAttrs(value);
    return `<span class="oc-badge oc-badge-${slug(attrs.color ?? attrs.variant ?? "default")}">`;
  }
  if (kind === "badgeClose") return "</span>";
  return "";
}

function cardHtml(rawAttrs, selfClosing) {
  const attrs = parseAttrs(rawAttrs);
  const href = attrs.href ?? "#";
  const title = attrs.title ?? attrs.name ?? "Open";
  const icon = attrs.icon ? iconSvg(attrs.icon) : "";
  const end = selfClosing ? "</div></a>" : "";
  return `<a class="oc-card" href="${escapeAttr(href)}">${icon}<div><strong>${escapeHtml(title)}</strong>${end}`;
}

function ctaCardHtml(rawAttrs, selfClosing) {
  const attrs = parseAttrs(rawAttrs);
  const href = attrs.href ?? "#";
  const title = attrs.title ?? attrs.name ?? "Open";
  const tone = slug(attrs.tone ?? attrs.variant ?? "default");
  const icon = attrs.icon ? iconSvg(attrs.icon) : "";
  const end = selfClosing ? `${ctaActions(attrs, "card")}</div></a>` : "";
  return `<a class="oc-cta-card oc-cta-card-${tone}" href="${escapeAttr(href)}">${icon}<div><strong>${escapeHtml(title)}</strong>${attrs.kicker ? `<span class="oc-cta-kicker">${escapeHtml(attrs.kicker)}</span>` : ""}${end}`;
}

function ctaActions(attrs, context = "block") {
  const primaryHref = attrs.href ?? attrs.primaryHref;
  const primaryLabel = attrs.label ?? attrs.primaryLabel ?? (primaryHref ? "Open" : "");
  const secondaryHref = attrs.secondaryHref;
  const secondaryLabel = attrs.secondaryLabel ?? (secondaryHref ? "Details" : "");
  const nested = context === "card";
  const links = [
    primaryHref && primaryLabel ? ctaLink(primaryHref, primaryLabel, "primary", nested) : "",
    secondaryHref && secondaryLabel
      ? ctaLink(secondaryHref, secondaryLabel, "secondary", nested)
      : "",
  ]
    .filter(Boolean)
    .join("");
  if (!links) return "";
  return `<div class="oc-cta-actions oc-cta-actions-${escapeAttr(context)}">${links}</div>`;
}

function ctaLink(href, label, variant, nested = false) {
  const className = `oc-cta-link oc-cta-link-${escapeAttr(variant)}`;
  return nested
    ? `<span class="${className}" data-href="${escapeAttr(href)}">${escapeHtml(label)}</span>`
    : `<a class="${className}" href="${escapeAttr(href)}">${escapeHtml(label)}</a>`;
}

function statHtml(rawAttrs, selfClosing) {
  const attrs = parseAttrs(rawAttrs);
  const value = attrs.value ?? attrs.number ?? "0";
  const label = attrs.label ?? attrs.title ?? "Metric";
  const delta = attrs.delta ? `<span class="oc-stat-delta">${escapeHtml(attrs.delta)}</span>` : "";
  const end = selfClosing ? "</div></section>" : "";
  return `<section class="oc-stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>${delta}<div>${end}`;
}

function chartHtml(rawPayload) {
  const payload = parseJsonPayload(rawPayload);
  const attrs = parseAttrs(payload.attrs ?? "");
  const points = chartPoints(attrs, payload.body ?? "");
  const title = attrs.title ?? "Chart";
  const type = slug(attrs.type ?? "bar");
  const unit = attrs.unit ?? "";
  const max = Math.max(...points.map((point) => point.value), 1);
  const rows = points.map((point) => chartDataRow(point, unit)).join("");
  const chartBody =
    type === "donut"
      ? donutChart(points, unit)
      : type === "line" || type === "area"
        ? lineChart(points, max, unit, { area: type === "area" })
        : barChart(points, max, unit);
  return `<figure class="oc-chart oc-chart-${escapeAttr(type)}"><figcaption><strong>${escapeHtml(title)}</strong>${attrs.subtitle ? `<span>${escapeHtml(attrs.subtitle)}</span>` : ""}</figcaption>${chartBody}<div class="oc-chart-data" role="table" aria-label="${escapeAttr(`${title} data`)}">${rows}</div></figure>`;
}

function parseJsonPayload(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { attrs: value, body: "" };
  }
}

function chartPoints(attrs, body) {
  const labels = splitList(attrs.labels ?? attrs.x ?? "");
  const values = splitList(attrs.values ?? attrs.y ?? "").map(toNumber);
  const fromAttrs = labels
    .map((label, index) => ({ label, value: values[index] }))
    .filter((point) => Number.isFinite(point.value));
  if (fromAttrs.length) return fromAttrs;
  const rows = String(body)
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = rows
    .map((line) => {
      const clean = line.replace(/^[-*]\s+/, "");
      const parts = clean.includes("|") ? clean.split("|") : clean.split(",");
      return { label: parts[0]?.trim() ?? "", value: toNumber(parts[1]) };
    })
    .filter((point) => point.label && Number.isFinite(point.value));
  return parsed.length ? parsed : [{ label: "Value", value: 1 }];
}

function splitList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value) {
  const normalized = String(value ?? "")
    .replace(/[%,$]/g, "")
    .trim();
  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : Number.NaN;
}

function barChart(points, max, unit) {
  return `<div class="oc-chart-bars">${points
    .map((point) => {
      const pct = Math.max(3, Math.round((point.value / max) * 100));
      const tip = chartTip(point, unit);
      return `<div class="oc-chart-row"><span>${escapeHtml(point.label)}</span><div class="oc-chart-track"><i class="oc-chart-mark" tabindex="0" style="--oc-chart-value:${pct}%" data-tip="${escapeAttr(tip)}" aria-label="${escapeAttr(tip)}"></i></div><strong>${escapeHtml(formatChartValue(point.value, unit))}</strong></div>`;
    })
    .join("")}</div>`;
}

function lineChart(points, max, unit, options = {}) {
  const width = 640;
  const height = 220;
  const padX = 32;
  const padY = 24;
  const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => {
    const x = padX + step * index;
    const y = height - padY - (point.value / max) * (height - padY * 2);
    return { ...point, x, y };
  });
  const polyline = coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaPoints = `${padX},${height - padY} ${polyline} ${width - padX},${height - padY}`;
  const aria = points
    .map((point) => `${point.label}: ${formatChartValue(point.value, unit)}`)
    .join(", ");
  const area = options.area
    ? `<polygon class="oc-chart-area-fill" points="${escapeAttr(areaPoints)}"/>`
    : "";
  return `<div class="oc-chart-line-wrap"><svg class="oc-chart-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(aria)}"><path class="oc-chart-gridline" d="M${padX} ${height - padY}H${width - padX}"/>${area}<polyline points="${escapeAttr(polyline)}"/><g>${coords.map((point) => `<circle tabindex="0" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" aria-label="${escapeAttr(chartTip(point, unit))}"><title>${escapeHtml(chartTip(point, unit))}</title></circle>`).join("")}</g></svg><div class="oc-chart-axis">${points.map((point) => `<span>${escapeHtml(point.label)}</span>`).join("")}</div></div>`;
}

function donutChart(points, unit) {
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  const colors = ["var(--brand)", "#48b49a", "#7aa7ff", "#c084fc", "#d97706", "#f472b6"];
  let offset = 0;
  const segments = points
    .map((point, index) => {
      const pct = Math.max(0, (point.value / total) * 100);
      const segment = `<circle class="oc-chart-donut-segment" pathLength="100" cx="110" cy="110" r="72" style="--oc-chart-offset:${offset.toFixed(3)};--oc-chart-share:${pct.toFixed(3)};--oc-chart-tone:${colors[index % colors.length]}" tabindex="0" aria-label="${escapeAttr(chartTip(point, unit))}"><title>${escapeHtml(chartTip(point, unit))}</title></circle>`;
      offset += pct;
      return segment;
    })
    .join("");
  const legend = points
    .map(
      (point, index) =>
        `<span class="oc-chart-donut-key" style="--oc-chart-tone:${colors[index % colors.length]}" tabindex="0" data-tip="${escapeAttr(chartTip(point, unit))}"><i></i><span>${escapeHtml(point.label)}</span><strong>${escapeHtml(formatChartValue(point.value, unit))}</strong></span>`,
    )
    .join("");
  return `<div class="oc-chart-donut-wrap"><svg class="oc-chart-donut-svg" viewBox="0 0 220 220" role="img" aria-label="${escapeAttr(points.map((point) => chartTip(point, unit)).join(", "))}"><circle class="oc-chart-donut-bg" cx="110" cy="110" r="72"/><g transform="rotate(-90 110 110)">${segments}</g><text x="110" y="106" text-anchor="middle">${escapeHtml(formatChartValue(total, unit))}</text><text x="110" y="126" text-anchor="middle">total</text></svg><div class="oc-chart-donut-legend">${legend}</div></div>`;
}

function chartDataRow(point, unit) {
  return `<span role="row"><span role="cell">${escapeHtml(point.label)}</span><span role="cell">${escapeHtml(formatChartValue(point.value, unit))}</span></span>`;
}

function chartTip(point, unit) {
  return `${point.label}: ${formatChartValue(point.value, unit)}`;
}

function formatChartValue(value, unit) {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${rounded}${unit}`;
}

function tileHtml(rawAttrs, selfClosing) {
  const attrs = parseAttrs(rawAttrs);
  const href = attrs.href ?? "#";
  const title = attrs.title ?? attrs.name ?? "Open";
  const icon = attrs.icon ? iconSvg(attrs.icon) : "";
  const end = selfClosing ? "</div></a>" : "";
  return `<a class="oc-tile" href="${escapeAttr(href)}">${icon}<div><strong>${escapeHtml(title)}</strong>${end}`;
}

function iconSvg(name) {
  const paths = {
    rocket: `<path d="M4.5 16.5c-1.1.9-1.7 2-1.9 3.5 1.5-.2 2.7-.8 3.5-1.9"/><path d="M9 15l-4-4 3-3c4-4 8-5 12-5-0 4-1 8-5 12l-3 3-3-3z"/><path d="M14 6l4 4"/><path d="M8 16l-2 4 4-2"/>`,
    sparkles: `<path d="M12 3l1.4 4.2L17.5 9l-4.1 1.8L12 15l-1.4-4.2L6.5 9l4.1-1.8L12 3z"/><path d="M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z"/><path d="M19 13l.7 1.8L21.5 16l-1.8.7L19 18.5l-.7-1.8-1.8-.7 1.8-.7L19 13z"/>`,
    "layout-dashboard": `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`,
    terminal: `<path d="M4 17l5-5-5-5"/><path d="M12 19h8"/>`,
    settings: `<path d="M12 8a4 4 0 100 8 4 4 0 000-8z"/><path d="M4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4m-8.6 8.6l-1.4 1.4"/>`,
    book: `<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5z"/>`,
    globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3z"/>`,
    wrench: `<path d="M14.7 6.3a4 4 0 005 5L9.5 21 4 15.5 14.7 6.3z"/><path d="M6 18l-2 2"/>`,
    gear: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21h-4v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3v-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1L7 4.2l.1.1a1.7 1.7 0 001.9.3 1.7 1.7 0 001-1.6V3h4v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1h.1v4H21a1.7 1.7 0 00-1.6 1z"/>`,
  };
  const path =
    paths[slug(name)] ??
    `<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/>`;
  return `<svg class="oc-card-icon" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

function cardGridClass(rawAttrs) {
  const attrs = parseAttrs(rawAttrs);
  const cols = Math.max(1, Math.min(4, Number.parseInt(attrs.cols ?? "", 10) || 2));
  return `card-grid oc-card-cols-${cols}`;
}

function dedentComponentChildren(markdown) {
  let depth = 0;
  return markdown
    .split("\n")
    .map((line) => {
      const markerMatch = line.match(new RegExp(`^${markerPrefix}:([^:]+):`));
      if (markerMatch) {
        if (
          markerMatch[1].endsWith("Close") ||
          markerMatch[1] === "blockClose" ||
          markerMatch[1] === "calloutClose"
        ) {
          depth = Math.max(0, depth - 1);
        }
        const markerLine = line;
        if (
          markerMatch[1].endsWith("Open") ||
          markerMatch[1] === "blockOpen" ||
          markerMatch[1] === "calloutOpen"
        ) {
          depth += 1;
        }
        return markerLine;
      }
      if (depth <= 0 || !line.startsWith(" ")) return line;
      return line.replace(new RegExp(`^ {1,${depth * 2}}`), "");
    })
    .join("\n");
}

function parseAttrs(raw) {
  const attrs = {};
  for (const match of raw.matchAll(
    /([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s>]+)))?/g,
  )) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
  }
  return attrs;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
