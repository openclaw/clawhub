/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { rehypeProxyImages } from "./rehypeProxyImages";

type ImageTree = {
  type: "root";
  children: Array<{
    type: "element";
    tagName: "img";
    properties: {
      src: string;
    };
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
});
