/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { rehypeProxyImages } from "./rehypeProxyImages";

type ImageTree = {
  type: "root";
  children: Array<{
    type: "element";
    tagName: "img" | "source";
    properties: Record<string, string>;
  }>;
};

function rewriteImgSrc(src: string, assetBaseUrl?: string) {
  const tree: ImageTree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "img",
        properties: { src },
      },
    ],
  };
  rehypeProxyImages({ assetBaseUrl })(tree);
  return tree.children[0].properties.src;
}

function rewriteSourceSrcset(srcset: string, assetBaseUrl?: string, property = "srcset") {
  const tree: ImageTree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "source",
        properties: { [property]: srcset },
      },
    ],
  };
  rehypeProxyImages({ assetBaseUrl })(tree);
  return tree.children[0].properties[property];
}

describe("rehypeProxyImages", () => {
  it("allows relative README assets to reference parent folders inside the same commit tree", () => {
    expect(
      rewriteImgSrc(
        "../shared/logo.png",
        "https://raw.githubusercontent.com/owner/repo/abcdef/sub/",
      ),
    ).toBe(
      "/_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fabcdef%2Fshared%2Flogo.png&w=1024&q=75",
    );
  });

  it("does not rewrite relative README assets that escape above the commit root", () => {
    expect(
      rewriteImgSrc(
        "../../../outside.png",
        "https://raw.githubusercontent.com/owner/repo/abcdef/sub/dir/",
      ),
    ).toBe("../../../outside.png");
  });

  it("does not treat explicit non-http schemes as relative README assets", () => {
    expect(
      rewriteImgSrc("javascript:alert(1)", "https://raw.githubusercontent.com/owner/repo/abcdef/"),
    ).toBe("javascript:alert(1)");
    expect(
      rewriteImgSrc("ftp://example.com/image.png", "https://raw.githubusercontent.com/x/y/z/"),
    ).toBe("ftp://example.com/image.png");
  });

  it("trims incidental whitespace before resolving relative README assets", () => {
    expect(
      rewriteImgSrc(
        " ./images/foo.png ",
        "https://raw.githubusercontent.com/owner/repo/abcdef/sub/",
      ),
    ).toBe(
      "/_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fabcdef%2Fsub%2Fimages%2Ffoo.png&w=1024&q=75",
    );
  });

  it("resolves relative <source srcset> candidates against assetBaseUrl and proxies them", () => {
    expect(
      rewriteSourceSrcset(
        "./dark.png 1x, ./dark@2x.png 2x",
        "https://raw.githubusercontent.com/owner/repo/abcdef/readme/",
      ),
    ).toBe(
      "/_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fabcdef%2Freadme%2Fdark.png&w=1024&q=75 1x, /_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fabcdef%2Freadme%2Fdark%402x.png&w=1024&q=75 2x",
    );
  });

  it("rewrites supported <source srcSet> property casing", () => {
    expect(
      rewriteSourceSrcset(
        "wide.png 800w, wide@2x.png 1600w",
        "https://raw.githubusercontent.com/owner/repo/abcdef/",
        "srcSet",
      ),
    ).toBe(
      "/_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fabcdef%2Fwide.png&w=1024&q=75 800w, /_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fabcdef%2Fwide%402x.png&w=1024&q=75 1600w",
    );
  });

  it("preserves unsupported <source srcset> entries while rewriting proxyable entries", () => {
    expect(
      rewriteSourceSrcset(
        "data:image/svg+xml,%3Csvg%3E 1x, /site.png 2x, https://img.shields.io/badge/x-y-blue.svg 3x, ./local.png 4x",
        "https://raw.githubusercontent.com/owner/repo/abcdef/",
      ),
    ).toBe(
      "data:image/svg+xml,%3Csvg%3E 1x, /site.png 2x, /_vercel/image?url=https%3A%2F%2Fimg.shields.io%2Fbadge%2Fx-y-blue.svg&w=1024&q=75 3x, /_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowner%2Frepo%2Fabcdef%2Flocal.png&w=1024&q=75 4x",
    );
  });

  it("leaves relative <source srcset> candidates alone without assetBaseUrl", () => {
    expect(rewriteSourceSrcset("./dark.png 1x, ./dark@2x.png 2x")).toBe(
      "./dark.png 1x, ./dark@2x.png 2x",
    );
  });

  it("proxies protocol-relative README images the same way as https", () => {
    const proxied = (src: string) => `/_vercel/image?url=${encodeURIComponent(src)}&w=1024&q=75`;

    expect(rewriteImgSrc("//img.shields.io/badge/x-y-blue.svg")).toBe(
      proxied("https://img.shields.io/badge/x-y-blue.svg"),
    );
    expect(rewriteImgSrc(" //attacker.example/pixel.png ")).toBe(
      proxied("https://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("//Attacker.Example/pixel.png")).toBe(
      proxied("https://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("//attacker.example:8443/pixel.png")).toBe(
      proxied("https://attacker.example:8443/pixel.png"),
    );
    expect(rewriteImgSrc("//reader@attacker.example/pixel.png")).toBe(
      proxied("https://reader@attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("//attacker.example/pixel.png?x=1&y=2#h")).toBe(
      proxied("https://attacker.example/pixel.png?x=1&y=2#h"),
    );
    expect(rewriteImgSrc("//[::1]/a.png")).toBe(proxied("https://[::1]/a.png"));
    expect(rewriteImgSrc("///pixel.png")).toBe(proxied("https://pixel.png/"));
    expect(rewriteImgSrc("//evil.com\\@allowed.com/a.png")).toBe(
      proxied("https://evil.com/@allowed.com/a.png"),
    );
    expect(rewriteImgSrc("http://attacker.example/pixel.png")).toBe(
      proxied("http://attacker.example/pixel.png"),
    );
    expect(
      rewriteImgSrc(
        "//attacker.example/pixel.png",
        "https://raw.githubusercontent.com/owner/repo/abcdef/sub/",
      ),
    ).toBe(proxied("https://attacker.example/pixel.png"));
    expect(rewriteImgSrc("/\\attacker.example/pixel.png")).toBe(
      proxied("https://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("\\\\attacker.example/pixel.png")).toBe(
      proxied("https://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("\\/attacker.example/pixel.png")).toBe(
      proxied("https://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("/\t/attacker.example/pixel.png")).toBe(
      proxied("https://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("\u0000//attacker.example/pixel.png")).toBe(
      proxied("https://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("http:/\\attacker.example/pixel.png")).toBe(
      proxied("http://attacker.example/pixel.png"),
    );
    expect(rewriteImgSrc("/site.png")).toBe("/site.png");
    expect(rewriteImgSrc("\\site.png")).toBe("\\site.png");
    expect(rewriteSourceSrcset("/\\attacker.example/pixel.png 1x, /site.png 2x")).toBe(
      `${proxied("https://attacker.example/pixel.png")} 1x, /site.png 2x`,
    );
  });

  it("removes a protocol-relative img src that is not a URL", () => {
    const tree: ImageTree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "img",
          properties: { src: "//", alt: "pixel" },
        },
      ],
    };
    rehypeProxyImages()(tree);
    expect(tree.children[0].properties).toEqual({ alt: "pixel" });
    expect(rewriteImgSrc("//:")).toBeUndefined();
    expect(rewriteImgSrc("// example.com/a.png")).toBeUndefined();
    expect(rewriteImgSrc("/\t/")).toBeUndefined();
  });

  it("proxies protocol-relative source srcset candidates and drops unparseable ones", () => {
    expect(
      rewriteSourceSrcset(
        "//img.shields.io/badge/x-y-blue.svg 1x, // 2x, data:image/svg+xml,%3Csvg%3E 3x, /site.png 4x",
      ),
    ).toBe(
      "/_vercel/image?url=https%3A%2F%2Fimg.shields.io%2Fbadge%2Fx-y-blue.svg&w=1024&q=75 1x, data:image/svg+xml,%3Csvg%3E 3x, /site.png 4x",
    );

    const tree: ImageTree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "source",
          properties: { srcset: "//", type: "image/png" },
        },
      ],
    };
    rehypeProxyImages()(tree);
    expect(tree.children[0].properties).toEqual({ type: "image/png" });
  });
});
