import type { Root } from "hast";
import { visit } from "unist-util-visit";

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
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "img") return;
      const src = node.properties?.src;
      if (typeof src !== "string" || !/^https?:\/\//i.test(src)) return;
      node.properties = {
        ...node.properties,
        src: `/_vercel/image?url=${encodeURIComponent(src)}&w=1024&q=75`,
      };
    });
  };
}
