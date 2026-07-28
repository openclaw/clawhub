/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PackageListItem } from "../lib/packageApi";
import { PluginListItem } from "./PluginListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("PluginListItem", () => {
  it("renders official list plugins with the compact official mark", () => {
    render(<PluginListItem item={makePlugin()} />);

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("renders official plugin cards with the compact official mark", () => {
    render(<PluginListItem item={makePlugin()} variant="card" />);

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("renders author topics", () => {
    render(
      <PluginListItem
        item={makePlugin({
          categories: ["models"],
          topics: ["local-models", "inference", "routing"],
        })}
      />,
    );

    expect(screen.getByText("#local-models")).toBeTruthy();
    expect(screen.getByText("#inference")).toBeTruthy();
    expect(screen.queryByText("#routing")).toBeNull();
    expect(screen.getByText("Models")).toBeTruthy();
    expect(screen.getByLabelText("Topics")).toBeTruthy();
    expect(screen.getByLabelText("Category")).toBeTruthy();
  });

  it("renders category labels when topics are unavailable", () => {
    render(<PluginListItem item={makePlugin({ categories: ["memory", "tools"] })} />);

    expect(screen.getByText("#memory")).toBeTruthy();
    expect(screen.getByText("#tools")).toBeTruthy();
    expect(screen.getByLabelText("Categories")).toBeTruthy();
  });

  it("renders a plugin manifest icon URL with safe image attributes", () => {
    render(
      <PluginListItem
        item={makePlugin({ icon: "https://cdn.example.test/icons/demo.svg" })}
        variant="card"
      />,
    );

    const image = document.querySelector<HTMLImageElement>(".marketplace-icon-image");
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toBe("https://cdn.example.test/icons/demo.svg");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("decoding")).toBe("async");
  });

  it("falls back to the default plugin glyph when a manifest icon fails to load", () => {
    render(
      <PluginListItem
        item={makePlugin({
          categories: ["models"],
          icon: "https://cdn.example.test/broken.svg",
        })}
      />,
    );

    const image = document.querySelector<HTMLImageElement>(".marketplace-icon-image");
    expect(image).toBeTruthy();

    fireEvent.error(image!);

    expect(document.querySelector(".marketplace-icon-image")).toBeNull();
    expect(
      document.querySelector(".marketplace-icon-glyph")?.classList.contains("lucide-brain"),
    ).toBe(true);
  });

  it.each(["list", "card"] as const)(
    "previews long plugin names in the %s variant while retaining the full label",
    (variant) => {
      const displayName = "P".repeat(71);
      const { container } = render(
        <PluginListItem
          item={makePlugin({ displayName })}
          variant={variant === "list" ? undefined : variant}
        />,
      );

      const name = container.querySelector(
        variant === "list" ? ".skill-list-item-name" : ".skill-card-title",
      );
      expect(name?.textContent).toBe(`${"P".repeat(69)}…`);
      expect(name?.getAttribute("title")).toBe(displayName);
    },
  );
});

function makePlugin(overrides: Partial<PackageListItem> = {}): PackageListItem {
  return {
    name: "demo-plugin",
    displayName: "Demo Plugin",
    family: "code-plugin",
    channel: "official",
    isOfficial: true,
    summary: "Demo summary",
    ownerHandle: "local",
    createdAt: 1,
    updatedAt: 1,
    latestVersion: "1.0.0",
    ...overrides,
  };
}
