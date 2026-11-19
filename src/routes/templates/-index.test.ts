import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "./index";

afterEach(() => vi.unstubAllEnvs());

it("shares the same bundled directory card without catalog data, including for filtered results", async () => {
  const site = "https://preview.clawhub.test";
  vi.stubEnv("VITE_SITE_URL", site);
  const head = Route.options.head!;
  for (const search of [{}, { category: "engineering", q: "pair" }]) {
    const result = await head({ match: { search } } as Parameters<typeof head>[0]);
    const title = "OpenClaw Templates";
    const description = "Browse ready-to-use agents you can add to OpenClaw.";
    const image = site + "/og/templates-v2.png";
    expect(result?.meta).toEqual(
      expect.arrayContaining([
        { property: "og:title", content: title },
        { name: "twitter:title", content: title },
        { property: "og:description", content: description },
        { name: "twitter:description", content: description },
        { property: "og:image", content: image },
        { name: "twitter:image", content: image },
        { property: "og:image:alt", content: title },
        { name: "twitter:image:alt", content: title },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:url", content: site + "/templates" },
      ]),
    );
    expect(result?.links).toContainEqual({ rel: "canonical", href: site + "/templates" });
  }
  const bytes = await readFile("public/og/templates-v2.png");
  expect(await sharp(bytes).metadata()).toMatchObject({ format: "png", width: 1200, height: 630 });
});
