/**
 * Scans README markdown text for relative image references — both Markdown
 * `![alt](./path)` syntax and raw HTML `<img src="./path">` tags — and returns
 * the unique set of relative paths it finds (capped to keep UI warnings short).
 *
 * Why: ClawHub does not host package binary assets. When a publisher uploads
 * a zip/tgz whose README references local images via relative paths, those
 * images render fine inside the package but 404 on the plugin detail page
 * unless the release also carries Source repo + Source commit (which lets us
 * resolve them to a stable raw.githubusercontent.com URL). We use this scanner
 * to surface a non-blocking warning on the publish form so authors can either
 * fill in source metadata or rewrite their README to absolute URLs before
 * shipping.
 *
 * Two flavors of "broken on the detail page" exist and the report distinguishes
 * them, because the publish form needs to behave differently:
 *
 *   - **Resolvable**: package-relative paths like `./images/foo.png` or
 *     `images/foo.png`. These can be rewritten at render time to
 *     `raw.githubusercontent.com/<repo>/<commit>/<sourcePath>/...` once the
 *     publisher fills in Source repo + Commit SHA, so the warning may be
 *     dismissed by completing those fields.
 *   - **Unresolvable**: root-absolute paths like `/static/logo.png`. The
 *     renderer (rehypeProxyImages) intentionally never rewrites these — there
 *     is no safe base URL that wouldn't accidentally pull random repo-root
 *     files — so they will 404 on the plugin detail page even if source
 *     metadata is provided. The only fixes are to rewrite them in the README
 *     to a real absolute URL, or to make them package-relative.
 */

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*?>/gi;

const ABSOLUTE_URL = /^[a-z][a-z0-9+\-.]*:/i;
const PROTOCOL_RELATIVE = /^\/\//;

const MAX_REPORTED = 5;

function classifyRelativeAsset(rawSrc: string): "package-relative" | "root-absolute" | null {
  const src = rawSrc.trim();
  if (!src) return null;
  if (src.startsWith("#")) return null;
  if (PROTOCOL_RELATIVE.test(src)) return null;
  if (ABSOLUTE_URL.test(src)) return null;
  // Single leading slash (we already excluded `//...` above) means the browser
  // resolves against the page origin, not the package — and the markdown
  // renderer deliberately never rewrites these. Mark them out so the publish
  // form can warn even when source repo + commit are both filled in.
  if (src.startsWith("/")) return "root-absolute";
  return "package-relative";
}

export interface RelativeReadmeAssetReport {
  /** Up to MAX_REPORTED unique paths, in the order encountered. */
  samples: string[];
  /** Total number of relative references detected (may exceed samples.length). */
  total: number;
  /**
   * Subset of `samples` that are root-absolute (e.g. `/static/logo.png`).
   * These cannot be salvaged by Source repo + Commit SHA because the README
   * renderer never rewrites root-absolute paths.
   */
  unresolvableSamples: string[];
  /** Total number of root-absolute references detected. */
  unresolvableTotal: number;
}

export function detectRelativeReadmeAssets(readmeText: string): RelativeReadmeAssetReport {
  if (!readmeText) {
    return { samples: [], total: 0, unresolvableSamples: [], unresolvableTotal: 0 };
  }

  const seen = new Set<string>();
  const samples: string[] = [];
  const unresolvableSeen = new Set<string>();
  const unresolvableSamples: string[] = [];
  let total = 0;
  let unresolvableTotal = 0;

  const record = (src: string | undefined) => {
    if (!src) return;
    const normalizedSrc = src.trim();
    const kind = classifyRelativeAsset(normalizedSrc);
    if (!kind) return;
    total += 1;
    if (kind === "root-absolute") unresolvableTotal += 1;
    if (!seen.has(normalizedSrc)) {
      seen.add(normalizedSrc);
      if (samples.length < MAX_REPORTED) samples.push(normalizedSrc);
    }
    if (kind === "root-absolute" && !unresolvableSeen.has(normalizedSrc)) {
      unresolvableSeen.add(normalizedSrc);
      if (unresolvableSamples.length < MAX_REPORTED) unresolvableSamples.push(normalizedSrc);
    }
  };

  MARKDOWN_IMAGE.lastIndex = 0;
  for (
    let match = MARKDOWN_IMAGE.exec(readmeText);
    match;
    match = MARKDOWN_IMAGE.exec(readmeText)
  ) {
    record(match[1]);
  }

  HTML_IMG_SRC.lastIndex = 0;
  for (let match = HTML_IMG_SRC.exec(readmeText); match; match = HTML_IMG_SRC.exec(readmeText)) {
    record(match[1] ?? match[2]);
  }

  return { samples, total, unresolvableSamples, unresolvableTotal };
}
