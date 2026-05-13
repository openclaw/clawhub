/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PackageListItem } from "../lib/packageApi";
import { PluginListItem } from "./PluginListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("PluginListItem", () => {
  it("renders official list plugins with the shared verified badge", () => {
    const { container } = render(<PluginListItem item={makePlugin()} />);

    expect(screen.getByText("Verified")).toBeTruthy();
    expect(container.querySelector(".verified-badge")).toBeTruthy();
    expect(container.querySelector(".verified-badge-icon")).toBeTruthy();
  });

  it("renders official plugin cards with the shared verified badge", () => {
    const { container } = render(<PluginListItem item={makePlugin()} variant="card" />);

    expect(screen.getByText("Verified")).toBeTruthy();
    expect(container.querySelector(".verified-badge")).toBeTruthy();
    expect(container.querySelector(".verified-badge-icon")).toBeTruthy();
  });
});

function makePlugin(): PackageListItem {
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
  };
}
