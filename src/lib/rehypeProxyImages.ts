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

function resolveRelativeSrc(src: string, assetBaseUrl: string | undefined): string | null {
  if (!assetBaseUrl) return null;
  if (!src) return null;
  if (ABSOLUTE_HTTP.test(src)) return null;
  if (PROTOCOL_RELATIVE.test(src)) return null;
  if (DATA_OR_FRAGMENT.test(src)) return null;
  if (EXPLICIT_SCHEME.test(src)) return null;
  // Absolute site paths (e.g. "/foo.png") are NOT package-relative — leaving
  // them alone matches how npmjs.com treats them and avoids accidentally
  // pulling random repo-root files.
  if (src.startsWith("/")) return null;
  try {
    return new URL(src, assetBaseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Routes external http(s) <img> sources through Vercel's image optimizer at
 * /_vercel/image, which enforces the allow-list, SVG rejection, and caching
 * declared in vercel.json. Local paths, relative paths, and data: URIs pass
 * through unchanged — only external schemes are treated as untrusted.
 *
 * If `assetBaseUrl` is provided, relative sources are first resolved against
 * that base (typically a `raw.githubusercontent.com/<repo>/<commit>/<dir>/`
 * URL derived from the package release source metadata) and then routed
 * through the same proxy. This fixes README images authored with relative
 * paths like `./images/foo.png`, which would otherwise 404 under the
 * ClawHub route.
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
      if (element.tagName !== "img") return;
      const src = element.properties?.src;
      if (typeof src !== "string") return;

      let absoluteSrc: string | null = null;
      if (ABSOLUTE_HTTP.test(src)) {
        absoluteSrc = src;
      } else {
        absoluteSrc = resolveRelativeSrc(src, assetBaseUrl);
      }
      if (!absoluteSrc) return;

      element.properties = {
        ...element.properties,
        src: `/_vercel/image?url=${encodeURIComponent(absoluteSrc)}&w=1024&q=75`,
      };
    });
  };
}
