import { createRequire } from "node:module";
import { fireEvent, render } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceIcon } from "./MarketplaceIcon";

describe("MarketplaceIcon", () => {
  const openclawIcon =
    "/api/v1/skill-icons/79e24bf179e94e005912591a67ecdf30f04df50204ff5fa5fed06a8e8eb88532";

  describe("verified raster storage artwork", () => {
    const storageUrl =
      "https://catalog.convex.cloud/api/storage/f92f78e3-1994-49e3-91ca-e49a896a4186";
    beforeEach(() => vi.stubEnv("VITE_CONVEX_URL", "https://catalog.convex.cloud"));
    afterEach(() => vi.unstubAllEnvs());

    it("uses the configured storage origin for bundled artwork", () => {
      const { container } = render(
        <MarketplaceIcon
          kind="plugin"
          label="Lobster"
          imageUrl={openclawIcon}
          rasterAssetUrl={storageUrl}
        />,
      );
      expect(
        container.querySelector(".marketplace-icon-image-backed img")?.getAttribute("src"),
      ).toBe(storageUrl);
    });

    it("falls back to the original icon once, then a glyph without retrying failed sources", () => {
      const { container, rerender } = render(
        <MarketplaceIcon
          kind="plugin"
          label="Lobster"
          imageUrl={openclawIcon}
          rasterAssetUrl={storageUrl}
        />,
      );
      fireEvent.error(container.querySelector("img")!);
      expect(container.querySelector("img")?.getAttribute("src")).toBe(openclawIcon);
      fireEvent.error(container.querySelector("img")!);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".marketplace-icon-glyph.lucide-plug")).toBeTruthy();
      rerender(
        <MarketplaceIcon
          kind="plugin"
          label="New artwork"
          imageUrl={"/api/v1/skill-icons/" + "b".repeat(64)}
          rasterAssetUrl={storageUrl.replace("f92f78e3", "a92f78e3")}
        />,
      );
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        storageUrl.replace("f92f78e3", "a92f78e3"),
      );
    });

    it("recovers a raster that failed before hydration attached the error handler", async () => {
      const { renderToString } = createRequire(`${process.cwd()}/package.json`)(
        "react-dom/server",
      ) as { renderToString: (node: ReactNode) => string };
      const element = (
        <MarketplaceIcon
          kind="plugin"
          label="Lobster"
          imageUrl={openclawIcon}
          rasterAssetUrl={storageUrl}
        />
      );
      const container = document.createElement("div");
      container.innerHTML = renderToString(element);
      document.body.append(container);
      // The browser has already emitted this error; hydration cannot replay it.
      const complete = vi
        .spyOn(HTMLImageElement.prototype, "complete", "get")
        .mockImplementation(function (this: HTMLImageElement) {
          return this.getAttribute("src") === storageUrl;
        });
      let root: Root | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(container, element);
        });
        expect(container.querySelector("img")?.getAttribute("src")).toBe(openclawIcon);
      } finally {
        await act(async () => root?.unmount());
        container.remove();
        complete.mockRestore();
      }
    });

    it.each([
      storageUrl.replace("catalog.convex.cloud", "untrusted.example"),
      storageUrl.replace("catalog.convex.cloud", "catalog.convex.cloud.untrusted.example"),
      storageUrl.replace("https://", "http://"),
      storageUrl.replace("https://", "https://user:password@"),
      storageUrl.replace("/api/storage/", "/other/"),
      storageUrl + "#fragment",
      "not a URL",
    ])("rejects a noncanonical storage source: %s", (rasterAssetUrl) => {
      const { container } = render(
        <MarketplaceIcon
          kind="plugin"
          label="Lobster"
          imageUrl={openclawIcon}
          rasterAssetUrl={rasterAssetUrl}
        />,
      );
      expect(container.querySelector("img")?.getAttribute("src")).toBe(openclawIcon);
    });

    it("does not promote remote manifest artwork or skill icons to the direct raster path", () => {
      const { container, rerender } = render(
        <MarketplaceIcon
          kind="plugin"
          label="Remote manifest"
          imageUrl="https://untrusted.example/icon.png"
          rasterAssetUrl={storageUrl}
        />,
      );
      expect(container.querySelector("img")).toBeNull();
      rerender(
        <MarketplaceIcon
          kind="skill"
          label="Skill"
          imageUrl={openclawIcon}
          rasterAssetUrl={storageUrl}
        />,
      );
      expect(container.querySelector("img")?.getAttribute("src")).toBe(openclawIcon);
    });
  });

  it("keeps a placeholder for just the active Template artwork until load or fallback", () => {
    const url = "/api/v1/skill-icons/" + "b".repeat(64);
    const other = "/api/v1/skill-icons/" + "c".repeat(64);
    const icon = (src?: string) => (
      <MarketplaceIcon kind="template" label="Template" imageUrl={src} />
    );
    const { container, rerender } = render(icon(url));
    const placeholder = () => container.querySelector(".template-artwork-skeleton");
    expect(placeholder()).not.toBeNull();
    fireEvent.load(container.querySelector("img")!);
    expect(placeholder()).toBeNull();
    rerender(icon(other));
    expect(placeholder()).not.toBeNull();
    fireEvent.error(container.querySelector("img")!);
    expect(placeholder()).toBeNull();
    expect(container.querySelector(".marketplace-icon-glyph")).not.toBeNull();
    rerender(icon());
    expect(placeholder()).toBeNull();
    expect(container.querySelector(".marketplace-icon-glyph")).not.toBeNull();
  });

  it.each([0, 32])(
    "settles Template artwork completed before hydration (width %i)",
    async (width) => {
      const { renderToString } = createRequire(`${process.cwd()}/package.json`)(
        "react-dom/server",
      ) as { renderToString: (node: ReactNode) => string };
      const element = <MarketplaceIcon kind="template" label="Template" imageUrl={openclawIcon} />;
      const container = document.createElement("div");
      container.innerHTML = renderToString(element);
      expect(container.querySelector(".template-artwork-skeleton")).not.toBeNull();
      const complete = vi
        .spyOn(HTMLImageElement.prototype, "complete", "get")
        .mockReturnValue(true);
      const naturalWidth = vi
        .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
        .mockReturnValue(width);
      let root: Root | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(container, element);
        });
        expect(container.querySelector(".template-artwork-skeleton")).toBeNull();
        expect(!!container.querySelector(".marketplace-icon-glyph")).toBe(!width);
        expect(!!container.querySelector("img")).toBe(!!width);
      } finally {
        await act(async () => root?.unmount());
        complete.mockRestore();
        naturalWidth.mockRestore();
      }
    },
  );

  it("removes the image-backed treatment when plugin artwork fails", () => {
    const { container } = render(
      <MarketplaceIcon kind="plugin" label="Lobster" imageUrl={openclawIcon} />,
    );
    expect(container.querySelector(".marketplace-icon-image-backed img")).toBeTruthy();
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector(".marketplace-icon-image-backed")).toBeNull();
    expect(container.querySelector(".marketplace-icon-glyph.lucide-plug")).toBeTruthy();
  });

  it("renders hosted skill icons before the category fallback", () => {
    const imageUrl = `/api/v1/skill-icons/${"a".repeat(64)}`;
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Custom Icon Skill"
        imageUrl={imageUrl}
        skill={{
          slug: "custom-icon-skill",
          displayName: "Custom Icon Skill",
          summary: "Debug and test codebases.",
          categories: ["development"],
        }}
      />,
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(imageUrl);
    expect(container.querySelector("svg.marketplace-icon-glyph")).toBeNull();
    expect(
      container
        .querySelector(".marketplace-icon")
        ?.classList.contains("marketplace-icon-image-backed"),
    ).toBe(true);
  });

  it("renders only hosted bundled plugin icons, falling back for remote URLs", () => {
    const hostedIcon = `/api/v1/skill-icons/${"c".repeat(64)}`;
    const { container, rerender } = render(
      <MarketplaceIcon kind="plugin" label="WhatsApp" imageUrl={hostedIcon} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(hostedIcon);
    rerender(
      <MarketplaceIcon kind="plugin" label="WhatsApp" imageUrl="https://example.com/icon.png" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.marketplace-icon-glyph.lucide-plug")).toBeTruthy();
  });

  it("ignores legacy skill custom-icon values", () => {
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Legacy Icon Skill"
        imageUrl="lucide:Plug"
        skill={{
          slug: "legacy-icon-skill",
          displayName: "Legacy Icon Skill",
          categories: ["developer-tools"],
        }}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.marketplace-icon-glyph")).toBeTruthy();
    expect(
      container
        .querySelector(".marketplace-icon")
        ?.classList.contains("marketplace-icon-image-backed"),
    ).toBe(false);
  });

  it("keeps hosted skill icons image-backed in muted contexts", () => {
    const imageUrl = `/api/v1/skill-icons/${"b".repeat(64)}`;
    const { container } = render(
      <MarketplaceIcon kind="skill" label="Muted Icon Skill" imageUrl={imageUrl} tone="muted" />,
    );
    const icon = container.querySelector(".marketplace-icon");

    expect(icon?.classList.contains("marketplace-icon-muted")).toBe(true);
    expect(icon?.classList.contains("marketplace-icon-image-backed")).toBe(true);
  });

  it("renders Slash for skills whose stored category cannot resolve", () => {
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Retired Category Skill"
        skill={{
          slug: "retired-category-skill",
          displayName: "Retired Category Skill",
          summary: "No usable category.",
          categories: ["retired-category"],
        }}
      />,
    );

    const glyph = container.querySelector("svg.marketplace-icon-glyph");
    expect(glyph?.classList.contains("lucide-slash")).toBe(true);
    expect(glyph?.classList.contains("lucide-package")).toBe(false);
  });

  it("renders skill glyphs from current inferred category metadata", () => {
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Inferred Category Skill"
        skill={{
          slug: "inferred-category-skill",
          displayName: "Inferred Category Skill",
          summary: "No author category, but classifier selected automation.",
          categories: undefined,
          inferredCategories: ["automation"],
          latestVersionId: "version-current",
          inferredFromVersionId: "version-current",
        }}
      />,
    );

    const glyph = container.querySelector("svg.marketplace-icon-glyph");
    expect(glyph?.classList.contains("lucide-zap")).toBe(true);
    expect(glyph?.classList.contains("lucide-slash")).toBe(false);
  });

  it("keeps the generic skill glyph when the caller has no category-capable skill data", () => {
    const { container } = render(<MarketplaceIcon kind="skill" label="Typeahead Skill" />);

    const glyph = container.querySelector("svg.marketplace-icon-glyph");
    expect(glyph?.classList.contains("lucide-package")).toBe(true);
    expect(glyph?.classList.contains("lucide-slash")).toBe(false);
  });

  it("exposes a muted treatment for neutral marketplace contexts", () => {
    const { container } = render(
      <MarketplaceIcon kind="plugin" label="Muted Plugin" tone="muted" />,
    );

    expect(
      container.querySelector(".marketplace-icon")?.classList.contains("marketplace-icon-muted"),
    ).toBe(true);
  });
});
