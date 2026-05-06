import { visit } from "unist-util-visit";

type HastElementLike = {
  tagName?: string;
  properties?: Record<string, unknown>;
};

/**
 * Routes external http(s) <img> sources through Vercel's image optimizer at
 * /_vercel/image, which enforces the allow-list, SVG rejection, and caching
 * declared in vercel.json. Local paths, relative paths, and data: URIs pass
 * through unchanged — only external schemes are treated as untrusted.
 *
 * `w` is required by the optimizer and must match a value in the `sizes`
 * array in vercel.json, so we always pass 1024. The <img width="..."> HTML
 * attribute still drives layout — this only controls served resolution.
 */
export function rehypeProxyImages() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "element", (node) => {
      const element = node as HastElementLike;
      if (element.tagName !== "img") return;
      const src = element.properties?.src;
      if (typeof src !== "string" || !/^https?:\/\//i.test(src)) return;
      element.properties = {
        ...element.properties,
        src: `/_vercel/image?url=${encodeURIComponent(src)}&w=1024&q=75`,
      };
    });
  };
}
