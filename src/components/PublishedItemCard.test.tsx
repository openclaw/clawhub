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
  categories: ["development"],
  href: "/alice/test-skill",
  downloads: 42,
  installs: 8,
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
  installs: 6,
  stars: 2,
  isOfficial: false,
  updatedAt: Date.now(),
};

describe("PublishedItemCard", () => {
  it("renders downloads", () => {
    render(<PublishedItemCard item={{ ...baseSkill, icon: null }} view="list" />);

    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("downloads")).toBeTruthy();
    expect(screen.queryByText("installs")).toBeNull();
    expect(screen.queryByText("8")).toBeNull();
  });

  it("renders the legacy backend metric as downloads", () => {
    render(
      <PublishedItemCard
        item={{ ...baseSkill, downloads: 42, installs: undefined, icon: null } as never}
        view="list"
      />,
    );

    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("downloads")).toBeTruthy();
    expect(screen.queryByText("installs")).toBeNull();
  });

  describe("grid view", () => {
    it("renders the category icon for a skill even when a legacy custom icon is set", () => {
      render(<PublishedItemCard item={{ ...baseSkill, icon: "lucide:Plug" }} view="grid" />);
      const icon = document.querySelector(".marketplace-icon-glyph");
      expect(icon).toBeTruthy();
      expect(document.querySelector("svg")?.classList.contains("lucide-wrench")).toBe(true);
    });

    it("renders Slash when skill category data is missing", () => {
      render(
        <PublishedItemCard
          item={{ ...baseSkill, categories: undefined, icon: null }}
          view="grid"
        />,
      );
      expect(document.querySelector(".marketplace-icon-glyph")).toBeTruthy();
      expect(document.querySelector("svg")?.classList.contains("lucide-slash")).toBe(true);
    });

    it("always uses the default kind icon for plugins regardless of icon field (F7)", () => {
      render(<PublishedItemCard item={{ ...basePlugin, icon: null }} view="grid" />);
      expect(document.querySelector(".marketplace-icon-glyph")).toBeTruthy();
    });

    it("renders plugin manifest icons for publisher plugin cards", () => {
      render(
        <PublishedItemCard
          item={{ ...basePlugin, icon: "https://cdn.example.test/icons/plugin.svg" }}
          view="grid"
        />,
      );

      const image = document.querySelector<HTMLImageElement>(".marketplace-icon-image");
      expect(image).toBeTruthy();
      expect(image?.getAttribute("src")).toBe("https://cdn.example.test/icons/plugin.svg");
      expect(document.querySelector(".marketplace-icon-glyph")).toBeNull();
    });

    it("renders the compact official mark for official published items", () => {
      render(
        <PublishedItemCard item={{ ...baseSkill, icon: null, isOfficial: true }} view="grid" />,
      );
      expect(screen.getByLabelText("Official")).toBeTruthy();
      expect(screen.queryByText("Official")).toBeNull();
    });

    it("does not add source-backed chrome to GitHub-backed skill cards", () => {
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

      expect(screen.queryByText("Source-backed")).toBeNull();
    });
  });

  describe("list view", () => {
    it("renders the category icon for a skill even when a legacy custom icon is set", () => {
      render(<PublishedItemCard item={{ ...baseSkill, icon: "lucide:Plug" }} view="list" />);
      expect(document.querySelector("svg")?.classList.contains("lucide-wrench")).toBe(true);
    });

    it("renders Slash when skill category data is missing", () => {
      render(
        <PublishedItemCard
          item={{ ...baseSkill, categories: undefined, icon: null }}
          view="list"
        />,
      );
      expect(document.querySelector("svg")?.classList.contains("lucide-slash")).toBe(true);
    });

    it("renders the compact official mark for official published rows", () => {
      render(
        <PublishedItemCard item={{ ...baseSkill, icon: null, isOfficial: true }} view="list" />,
      );
      expect(screen.getByLabelText("Official")).toBeTruthy();
      expect(screen.queryByText("Official")).toBeNull();
    });

    it("does not render artifact-kind prefixes as owner handles", () => {
      render(<PublishedItemCard item={{ ...baseSkill, icon: null }} view="list" />);

      expect(screen.queryByText("@skill")).toBeNull();
      expect(screen.queryByText("/")).toBeNull();
      expect(screen.getByText("Test Skill")).toBeTruthy();
    });

    it("does not render plugin artifact-kind prefixes as owner handles", () => {
      render(<PublishedItemCard item={{ ...basePlugin, icon: null }} view="list" />);

      expect(screen.queryByText("@plugin")).toBeNull();
      expect(screen.queryByText("/")).toBeNull();
      expect(screen.getByText("Test Plugin")).toBeTruthy();
    });
  });
});

describe("PublishedCatalogSections", () => {
  it("renders manifest groups without source-backed catalog chrome", () => {
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

    expect(screen.getByRole("heading", { name: "Agentic AI" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Other skills" })).toBeTruthy();
    expect(screen.getByText("AIQ Deploy")).toBeTruthy();
    expect(screen.getByText("Other Skill")).toBeTruthy();
    expect(screen.queryByText("Source-backed from NVIDIA/skills")).toBeNull();
    expect(screen.queryByText("Source-backed")).toBeNull();
    expect(screen.queryByText("NVIDIA/skills")).toBeNull();
  });
});
