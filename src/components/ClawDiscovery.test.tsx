/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CLAW_CATEGORY_DEFINITIONS } from "clawhub-schema";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fetchDiscovery = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock("../lib/clawDiscovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/clawDiscovery")>()),
  fetchClawDiscovery: fetchDiscovery,
}));
vi.mock("../convex/client", () => ({ convexHttp: { query: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: { name?: string };
    search?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={`${to.replace("$name", encodeURIComponent(params?.name ?? ""))}${search ? `?${new URLSearchParams(search)}` : ""}`}
      {...props}
    >
      {children}
    </a>
  ),
}));
import type { ClawListing } from "../lib/clawDiscovery";
import { ClawAvatar } from "./ClawAvatar";
import { ClawDiscovery, ClawSearch } from "./ClawDiscovery";
const claw: ClawListing = {
  name: "@maker/sift",
  displayName: "Sift",
  family: "claw",
  channel: "community",
  isOfficial: false,
  ownerOfficial: false,
  ownerImage: null,
  ownerHandle: "maker",
  summary: "Find the important facts",
  icon: null,
  runtimeId: null,
  createdAt: 1,
  updatedAt: 1,
  latestVersion: "1.0.0",
  verificationTier: null,
  categories: ["research"],
  stats: { downloads: 12, installs: 0, stars: 0, versions: 1 },
};

describe("Claw discovery surface", () => {
  beforeEach(() => {
    fetchDiscovery.mockReset();
  });
  it("keeps discovery useful when the catalog or featured collection is empty", () => {
    const { rerender } = render(<ClawDiscovery initialData={{ items: [], featured: [] }} />);
    expect(screen.getByText("The Claw collection is on its way.")).toBeTruthy();
    rerender(<ClawDiscovery initialData={{ items: [claw], featured: [] }} />);
    expect(screen.getByText(/featured collection is coming soon/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Sift/ }).getAttribute("href")).toBe(
      "/claws/%40maker%2Fsift",
    );
    expect(screen.getByRole("link", { name: /See all Research/ }).getAttribute("href")).toBe(
      "/claws?category=research",
    );
  });
  it("shows loading, offers retry after failure, and recovers", async () => {
    fetchDiscovery
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [claw], featured: [] });
    render(<ClawDiscovery initialData={null} />);
    expect(screen.getByRole("status").textContent).toContain("Finding");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("link", { name: /Sift/ });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("recovers when a route reload supplies data after the client fallback failed", async () => {
    fetchDiscovery.mockRejectedValueOnce(new Error("offline"));
    const { rerender } = render(<ClawDiscovery initialData={null} />);
    await screen.findByRole("alert");
    rerender(<ClawDiscovery initialData={{ items: [claw], featured: [] }} />);
    await screen.findByRole("link", { name: /Sift/ });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("limits the homepage to six categories and four entries per category without manufacturing sparse entries", () => {
    const items = Array.from({ length: 35 }, (_, index) => ({
      ...claw,
      name: `claw-${index}`,
      displayName: `Claw ${index}`,
      categories: [CLAW_CATEGORY_DEFINITIONS[Math.floor(index / 5)]!.slug],
    }));
    const { container } = render(<ClawDiscovery initialData={{ items, featured: [items[0]] }} />);
    expect(container.querySelectorAll(".claw-category")).toHaveLength(6);
    expect(container.querySelectorAll(".claw-row")).toHaveLength(24);
  });
  it("filters the browse route and offers a reset for no results", () => {
    render(<ClawDiscovery initialData={{ items: [claw], featured: [] }} browse query="missing" />);
    expect(screen.getByRole("heading", { name: "No Claws found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all Claws" }).getAttribute("href")).toBe("/claws");
  });
  it("submits search terms and preserves category context", () => {
    const { container } = render(<ClawSearch query="Sift" category="research" />);
    const form = container.querySelector("form")!;
    expect(form.action).toMatch(/\/claws$/);
    expect(new FormData(form).get("q")).toBe("Sift");
    expect(new FormData(form).get("category")).toBe("research");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "365" } });
    fireEvent.submit(form);
    expect(navigate).toHaveBeenCalledWith({
      to: "/claws",
      search: { q: "365", category: "research" },
    });
  });
  it("uses artwork, falls back on broken images, and recovers when artwork changes", async () => {
    const { container, rerender } = render(
      <ClawAvatar name="sift" label="Sift" imageUrl="https://example.com/sift.png" />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("S")).toBeTruthy();
    rerender(<ClawAvatar name="sift" label="Sift" imageUrl="https://example.com/new.png" />);
    await waitFor(() =>
      expect(container.querySelector("img")?.src).toBe("https://example.com/new.png"),
    );
  });
});
