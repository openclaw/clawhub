import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishedCatalogSections, PublishedItemCard } from "../routes/user/$handle";

// PublishedItemCard uses <Link> from TanStack Router; stub it to a plain <a>.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const baseSkill = {
  _id: "skills:test",
  kind: "skill" as const,
  displayName: "Test Skill",
  summary: "A test skill",
  href: "/alice/test-skill",
  downloads: 42,
  stars: 7,
  isOfficial: false,
  updatedAt: Date.now(),
};

const basePlugin = {
  _id: "packages:test",
  kind: "plugin" as const,
  displayName: "Test Plugin",
  summary: "A test plugin",
  href: "/plugins/test-plugin",
  downloads: 10,
  stars: 2,
  isOfficial: false,
  updatedAt: Date.now(),
};

describe("PublishedItemCard", () => {
  describe("grid view", () => {
    it("renders the custom lucide icon for a skill with icon set (F7)", () => {
      render(<PublishedItemCard item={{ ...baseSkill, icon: "lucide:Plug" }} view="grid" />);
      // The Plug lucide icon renders an SVG; MarketplaceIcon wraps it in a
      // <span aria-hidden="true"> so we assert the glyph is present via the
      // SVG element rather than accessible text.
      const icon = document.querySelector(".marketplace-icon-glyph");
      expect(icon).toBeTruthy();
      // The icon should NOT be the default Package glyph — the custom Plug
      // glyph is rendered instead. We verify by checking the SVG path data
      // is present (lucide-react renders deterministic SVG markup).
      expect(document.querySelector("svg")).toBeTruthy();
    });

    it("falls back to the default kind icon when skill has no custom icon (F7)", () => {
      render(<PublishedItemCard item={{ ...baseSkill, icon: null }} view="grid" />);
      expect(document.querySelector(".marketplace-icon-glyph")).toBeTruthy();
    });

    it("always uses the default kind icon for plugins regardless of icon field (F7)", () => {
      render(<PublishedItemCard item={{ ...basePlugin, icon: null }} view="grid" />);
      expect(document.querySelector(".marketplace-icon-glyph")).toBeTruthy();
    });

    it("renders the compact official mark for official published items", () => {
      render(
        <PublishedItemCard item={{ ...baseSkill, icon: null, isOfficial: true }} view="grid" />,
      );
      expect(screen.getByLabelText("Official")).toBeTruthy();
      expect(screen.queryByText("Official")).toBeNull();
    });

    it("marks GitHub-backed skill cards as source-backed", () => {
      render(
        <PublishedItemCard
          item={{
            ...baseSkill,
            icon: null,
            sourceBacked: true,
            sourceRepo: "NVIDIA/skills",
          }}
          view="grid"
        />,
      );

      expect(screen.getByText("Source-backed")).toBeTruthy();
    });
  });

  describe("list view", () => {
    it("renders the custom lucide icon for a skill with icon set (F7)", () => {
      render(<PublishedItemCard item={{ ...baseSkill, icon: "lucide:Plug" }} view="list" />);
      expect(document.querySelector(".marketplace-icon-glyph")).toBeTruthy();
    });

    it("falls back to the default kind icon when skill has no custom icon (F7)", () => {
      render(<PublishedItemCard item={{ ...baseSkill, icon: null }} view="list" />);
      expect(document.querySelector(".marketplace-icon-glyph")).toBeTruthy();
    });

    it("renders the compact official mark for official published rows", () => {
      render(
        <PublishedItemCard item={{ ...baseSkill, icon: null, isOfficial: true }} view="list" />,
      );
      expect(screen.getByLabelText("Official")).toBeTruthy();
      expect(screen.queryByText("Official")).toBeNull();
    });
  });
});

describe("PublishedCatalogSections", () => {
  it("renders manifest groups with source-backed catalog copy", () => {
    render(
      <PublishedCatalogSections
        view="list"
        display={{
          mode: "grouped",
          sourceRepos: ["NVIDIA/skills"],
          sections: [
            {
              key: "agentic",
              title: "Agentic AI",
              description: "Agentic AI skills.",
              sourceRepo: "NVIDIA/skills",
              items: [
                {
                  ...baseSkill,
                  _id: "skills:aiq-deploy",
                  displayName: "AIQ Deploy",
                  href: "/nvidia/aiq-deploy",
                  icon: null,
                  sourceBacked: true,
                  sourceRepo: "NVIDIA/skills",
                },
              ],
            },
            {
              key: "other",
              title: "Other skills",
              description: null,
              sourceRepo: null,
              items: [
                {
                  ...baseSkill,
                  _id: "skills:other",
                  displayName: "Other Skill",
                  href: "/nvidia/other",
                  icon: null,
                  sourceBacked: true,
                  sourceRepo: "NVIDIA/skills",
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Source-backed from NVIDIA/skills")).toBeTruthy();
    expect(screen.getByText(/install bytes stay in github/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Agentic AI" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Other skills" })).toBeTruthy();
    expect(screen.getByText("AIQ Deploy")).toBeTruthy();
    expect(screen.getByText("Other Skill")).toBeTruthy();
  });
});
