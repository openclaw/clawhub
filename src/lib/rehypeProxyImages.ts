import { visit } from "unist-util-visit";

type HastElementLike = {
  tagName?: string;
  properties?: Record<string, unknown>;
};

interface RehypeProxyImagesOptions {
  /**
   * Base URL used to resolve relative <img src> values (e.g. `./images/foo.png`).
   * When set, relative sources are resolved against this base into an absolute
   * URL and then proxied through the same /_vercel/image path as external
   * sources. When unset, relative paths pass through unchanged (legacy
   * behavior).
   *
   * Typical value: a `raw.githubusercontent.com/<repo>/<commit>/<dir>/` URL
   * built from a package release's `verification.sourceRepo` +
   * `verification.sourceCommit`. Must end with `/` so it resolves as a
   * directory; callers are responsible for that.
   */
  assetBaseUrl?: string;
}

const DATA_OR_FRAGMENT = /^(?:data:|#|mailto:|tel:)/i;
const ABSOLUTE_HTTP = /^https?:\/\//i;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+\-.]*:/i;
const PROTOCOL_RELATIVE = /^\/\//;
const IMAGE_PROXY_WIDTH = 1024;
// Base used only to ask the URL parser what a browser would request.
// Its host is not a real image host.
const PARSER_BASE = "https://clawhub.invalid/readme";
const PARSER_BASE_HOST = "clawhub.invalid";

type SrcsetCandidate = {
  url: string;
  descriptors: string;
};

function getRawGitHubCommitRoot(assetBaseUrl: string): URL | null {
  try {
    const baseUrl = new URL(assetBaseUrl);
    if (baseUrl.protocol !== "https:" || baseUrl.hostname !== "raw.githubusercontent.com") {
      return null;
    }
    const [owner, repo, commit] = baseUrl.pathname.split("/").filter(Boolean);
    if (!owner || !repo || !commit) return null;
    return new URL(`/${owner}/${repo}/${commit}/`, baseUrl.origin);
  } catch {
    return null;
  }
}

function isC0OrSpace(char: string): boolean {
  return char.charCodeAt(0) <= 0x1f || char === " ";
}

function preprocessUrlInput(src: string): string {
  // The URL parser drops tab and newline anywhere, then trims C0 controls
  // and spaces, before it treats `\` as `/`.
  let stripped = "";
  for (const char of src) {
    if (char === "\t" || char === "\n" || char === "\r") continue;
    stripped += char;
  }
  let start = 0;
  let end = stripped.length;
  while (start < end && isC0OrSpace(stripped[start] ?? "")) start += 1;
  while (end > start && isC0OrSpace(stripped[end - 1] ?? "")) end -= 1;
  return stripped.slice(start, end);
}

function isSchemeRelative(src: string): boolean {
  return src.length >= 2 && "/\\".includes(src[0]) && "/\\".includes(src[1]);
}

function parsedExternalHttp(src: string): string | null {
  try {
    const url = new URL(src, PARSER_BASE);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname.length === 0 || url.hostname === PARSER_BASE_HOST) return null;
    return url.href;
  } catch {
    return null;
  }
}

function resolveRelativeSrc(src: string, assetBaseUrl: string | undefined): string | null {
  if (!assetBaseUrl) return null;
  if (!src) return null;
  if (ABSOLUTE_HTTP.test(src)) return null;
  if (PROTOCOL_RELATIVE.test(src) || isSchemeRelative(src)) return null;
  if (DATA_OR_FRAGMENT.test(src)) return null;
  if (EXPLICIT_SCHEME.test(src)) return null;
  // Absolute site paths (e.g. "/foo.png") are NOT package-relative — leaving
  // them alone matches how npmjs.com treats them and avoids accidentally
  // pulling random repo-root files.
  if (src.startsWith("/")) return null;
  try {
    const resolved = new URL(src, assetBaseUrl);
    const commitRoot = getRawGitHubCommitRoot(assetBaseUrl);
    if (!commitRoot) return null;
    if (resolved.origin !== commitRoot.origin) return null;
    if (!resolved.pathname.startsWith(commitRoot.pathname)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function proxyImageSrc(src: string): string {
  return `/_vercel/image?url=${encodeURIComponent(src)}&w=${IMAGE_PROXY_WIDTH}&q=75`;
}

function isUnusableProtocolRelative(src: string): boolean {
  const normalizedSrc = preprocessUrlInput(src);
  return isSchemeRelative(normalizedSrc) && parsedExternalHttp(normalizedSrc) === null;
}

function rewriteImageSrc(src: string, assetBaseUrl: string | undefined): string | null {
  const normalizedSrc = preprocessUrlInput(src);
  if (ABSOLUTE_HTTP.test(normalizedSrc)) return proxyImageSrc(normalizedSrc);
  // `/\host` and `http:/\host` have no `//` after a trim, but the browser
  // still requests that host. `url.href` is that request.
  const externalHref = parsedExternalHttp(normalizedSrc);
  if (externalHref) return proxyImageSrc(externalHref);
  if (isSchemeRelative(normalizedSrc)) return null;
  const relativeSrc = resolveRelativeSrc(normalizedSrc, assetBaseUrl);
  if (!relativeSrc) return null;
  return proxyImageSrc(relativeSrc);
}

function isAsciiWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

function parseSrcset(srcset: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let index = 0;

  while (index < srcset.length) {
    while (index < srcset.length) {
      const char = srcset[index];
      if (isAsciiWhitespace(char) || char === ",") {
        index += 1;
        continue;
      }
      break;
    }
    if (index >= srcset.length) break;

    const urlStart = index;
    while (index < srcset.length && !isAsciiWhitespace(srcset[index])) {
      index += 1;
    }
    let url = srcset.slice(urlStart, index);
    const endedWithComma = url.endsWith(",");
    if (endedWithComma) {
      url = url.slice(0, -1);
    }

    while (index < srcset.length && isAsciiWhitespace(srcset[index])) {
      index += 1;
    }

    let descriptors = "";
    if (!endedWithComma) {
      const descriptorsStart = index;
      while (index < srcset.length && srcset[index] !== ",") {
        index += 1;
      }
      descriptors = srcset.slice(descriptorsStart, index).trim();
    }

    candidates.push({ url, descriptors });

    if (srcset[index] === ",") {
      index += 1;
    }
  }

  return candidates;
}

function formatSrcsetCandidate(url: string, descriptors: string): string {
  return descriptors ? `${url} ${descriptors}` : url;
}

function rewriteSrcset(srcset: string, assetBaseUrl: string | undefined): string | null {
  const candidates = parseSrcset(srcset);
  if (candidates.length === 0) return null;

  let didChange = false;
  const rewritten: string[] = [];
  for (const candidate of candidates) {
    const rewrittenUrl = rewriteImageSrc(candidate.url, assetBaseUrl);
    if (rewrittenUrl) {
      didChange = true;
      rewritten.push(formatSrcsetCandidate(rewrittenUrl, candidate.descriptors));
      continue;
    }
    // An unparseable `//` candidate is not a same-document path. Drop it
    // instead of leaving a URL the browser will request directly.
    if (isUnusableProtocolRelative(candidate.url)) {
      didChange = true;
      continue;
    }
    rewritten.push(formatSrcsetCandidate(candidate.url, candidate.descriptors));
  }

  return didChange ? rewritten.join(", ") : null;
}

/**
 * Routes external http(s) image sources through Vercel's image optimizer at
 * /_vercel/image, which enforces the allow-list, SVG rejection, and caching
 * declared in vercel.json. Local paths, relative paths, and data: URIs pass
 * through unchanged.
 *
 * Protocol-relative sources are parsed as https and sent through that
 * same proxy. A leading backslash counts as a slash, and tab, newline,
 * and leading C0 controls are removed first, because that is how the
 * browser parses the URL. A protocol-relative value that does not parse
 * is removed, so the original value cannot stay in the document.
 *
 * If `assetBaseUrl` is provided, relative sources are first resolved against
 * that base (typically a `raw.githubusercontent.com/<repo>/<commit>/<dir>/`
 * URL derived from the package release source metadata) and then routed
 * through the same proxy. This fixes README images authored with relative
 * paths like `./images/foo.png` or `<source srcset="./dark.png 1x">`, which
 * would otherwise 404 under the ClawHub route.
 *
 * `w` is required by the optimizer and must match a value in the `sizes`
 * array in vercel.json, so we always pass 1024. The <img width="..."> HTML
 * attribute still drives layout — this only controls served resolution.
 */
export function rehypeProxyImages(options: RehypeProxyImagesOptions = {}) {
  const { assetBaseUrl } = options;
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "element", (node) => {
      const element = node as HastElementLike;
      if (element.tagName === "img") {
        const src = element.properties?.src;
        if (typeof src === "string" && element.properties) {
          const rewrittenSrc = rewriteImageSrc(src, assetBaseUrl);
          if (rewrittenSrc) {
            element.properties = {
              ...element.properties,
              src: rewrittenSrc,
            };
          } else if (isUnusableProtocolRelative(src)) {
            const properties = { ...element.properties };
            delete properties.src;
            element.properties = properties;
          }
        }
      }

      if (element.tagName === "source") {
        const srcsetKey = typeof element.properties?.srcSet === "string" ? "srcSet" : "srcset";
        const srcset = element.properties?.[srcsetKey];
        if (typeof srcset === "string" && element.properties) {
          const rewrittenSrcset = rewriteSrcset(srcset, assetBaseUrl);
          if (rewrittenSrcset) {
            element.properties = {
              ...element.properties,
              [srcsetKey]: rewrittenSrcset,
            };
          } else if (rewrittenSrcset === "") {
            const properties = { ...element.properties };
            delete properties[srcsetKey];
            element.properties = properties;
          }
        }
      }
    });
  };
}
