# README image proxy

A plugin README is rendered in the visitor's browser. An image host named in that README must not learn the visitor's address.

`rehypeProxyImages` rewrites `img` `src` and `source` `srcset` to `/_vercel/image`. On the deployed site, that optimizer fetches the image. `vercel.json` `images.remotePatterns` is the host allow-list. The browser talks only to ClawHub, so the image host does not see the visitor IP, cookies, or Referer. Page CSP allows every `https:` image (`img-src 'self' data: blob: https:` from `createContentSecurityPolicy`). CSP is not the host allow-list. The rewrite is.

A protocol-relative value such as `//img.shields.io/badge/x-y-blue.svg` is the URL the browser would request on that host. The rewriter applies the same normalization the browser does before it decides: tab, newline, and carriage return are removed, leading and trailing C0 controls and spaces are trimmed, and `\` counts as `/`. `/\host`, `\\host`, and `http:/\host` are in this class. The value is parsed against `https://clawhub.invalid/readme` only to learn that request. The parser host is not an image host. When the result is `http` or `https` on any other host, the rewriter proxies `url.href`. A protocol-relative result uses `https` because that is the parser base. An absolute `http://` URL stays `http` and is still proxied.

A value that is still scheme-relative and does not parse to an external `http` or `https` URL is removed. An `img` loses `src`. One `source` `srcset` candidate is dropped, and a `srcset` that would be empty is removed. Leaving `//` or `//:` in the document would let the browser request it directly.

Package-relative paths such as `./images/foo.png` still resolve only inside the commit-pinned `raw.githubusercontent.com/<owner>/<repo>/<commit>/` tree. When `assetBaseUrl` includes the package directory, resolution stays in that directory. The resolved URL then goes through the same proxy. A scheme-relative value is not joined onto that GitHub base. Without `assetBaseUrl`, a package-relative path is left as authored.

These authored values stay as written: `data:` URLs, fragments, `mailto:`, `tel:`, other explicit non-http schemes, and a single leading slash such as `/site.png`. A single leading slash is the page origin, not the package. A lone backslash such as `\site.png` is not scheme-relative.

Publish-time warnings in `detectRelativeReadmeAssets` still ignore `//`. That check is about package files that need a source repo and commit. It is not this render-time allow-list.

The proxy query uses width `1024`, which is one of the sizes in `vercel.json`. The HTML `width` attribute still controls layout.
