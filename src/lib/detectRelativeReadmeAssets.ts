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
 * Definition of "relative" here is intentionally narrow: anything that is not
 * an absolute http(s) URL, a protocol-relative URL, a data:/mailto:/tel: URI,
 * or a fragment. Root-absolute paths like `/foo.png` are also flagged because
 * on the plugin detail page the browser resolves them against clawhub.ai
 * itself, which is just as broken as `./foo.png`.
 */

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*?>/gi;

const ABSOLUTE_URL = /^[a-z][a-z0-9+\-.]*:/i;
const PROTOCOL_RELATIVE = /^\/\//;

const MAX_REPORTED = 5;

function isRelativeAsset(rawSrc: string): boolean {
  const src = rawSrc.trim();
  if (!src) return false;
  if (src.startsWith("#")) return false;
  if (PROTOCOL_RELATIVE.test(src)) return false;
  if (ABSOLUTE_URL.test(src)) return false;
  return true;
}

export interface RelativeReadmeAssetReport {
  /** Up to MAX_REPORTED unique paths, in the order encountered. */
  samples: string[];
  /** Total number of relative references detected (may exceed samples.length). */
  total: number;
}

export function detectRelativeReadmeAssets(readmeText: string): RelativeReadmeAssetReport {
  if (!readmeText) return { samples: [], total: 0 };

  const seen = new Set<string>();
  const samples: string[] = [];
  let total = 0;

  const record = (src: string | undefined) => {
    if (!src) return;
    if (!isRelativeAsset(src)) return;
    total += 1;
    if (seen.has(src)) return;
    seen.add(src);
    if (samples.length < MAX_REPORTED) samples.push(src);
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

  return { samples, total };
}
