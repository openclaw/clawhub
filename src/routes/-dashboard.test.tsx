/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dashboard } from "./dashboard";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  usePaginatedQuery: vi.fn(),
  useMutation: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  usePaginatedQuery: (...args: unknown[]) => mocks.usePaginatedQuery(...args),
  useMutation: (...args: unknown[]) => mocks.useMutation(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({
    children,
    to,
    params,
    search: _search,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    search?: unknown;
  }) => (
    <a
      href={
        to === "/$owner/$slug" && params
          ? `/${params.owner}/${params.slug}`
          : typeof to === "string"
            ? to
            : "/test"
      }
      {...props}
    >
      {children}
    </a>
  ),
}));

type TestSkill = {
  _id: Id<"skills">;
  _creationTime: number;
  slug: string;
  displayName: string;
  summary: string;
  ownerPath: string;
  detailHref: string;
  settingsHref: string;
  ownerUserId: Id<"users">;
  ownerPublisherId: Id<"publishers">;
  tags: {};
  badges: {};
  stats: {
    downloads: number;
    installsCurrent: number;
    installsAllTime: number;
    stars: number;
    versions: number;
  };
  moderationVerdict?: "suspicious" | "malicious";
  moderationFlags?: string[];
  isSuspicious?: boolean;
  createdAt: number;
  updatedAt: number;
  latestVersion: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
  };
};

type TestPackage = {
  _id: Id<"packages">;
  name: string;
  displayName: string;
  family: "code-plugin";
  channel: "community";
  isOfficial: false;
  runtimeId: string | null;
  sourceRepo: string | null;
  summary: string;
  latestVersion: string;
  updatedAt: number;
  stats: {
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
  };
  verification: null;
  scanStatus: "clean" | "suspicious" | "malicious";
  latestRelease: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
  };
};

const me = {
  _id: "users:local" as Id<"users">,
  handle: "local",
  name: "Local Dev",
  displayName: "Local Dev",
};

const publishers = [
  {
    publisher: {
      _id: "publishers:local" as Id<"publishers">,
      handle: "local",
      displayName: "Local",
      kind: "user" as const,
    },
    role: "owner" as const,
  },
];

function createSkill(overrides?: Partial<TestSkill>): TestSkill {
  return {
    _id: "skills:below-cap" as Id<"skills">,
    _creationTime: 1,
    slug: "local-flagged-skill",
    displayName: "Local Flagged Skill",
    summary: "Flagged skill fixture.",
    ownerPath: "local",
    detailHref: "/local/local-flagged-skill",
    settingsHref: "/local/local-flagged-skill/settings",
    ownerUserId: me._id,
    ownerPublisherId: publishers[0].publisher._id,
    tags: {},
    badges: {},
    stats: { downloads: 1_234, installsCurrent: 12, installsAllTime: 56, stars: 7, versions: 3 },
    moderationVerdict: "suspicious",
    moderationFlags: ["flagged.suspicious"],
    isSuspicious: true,
    createdAt: 1,
    updatedAt: 1,
    latestVersion: {
      version: "1.0.0",
      createdAt: 1,
      vtStatus: "suspicious",
      llmStatus: "suspicious",
      staticScanStatus: "suspicious",
    },
    ...overrides,
  };
}

function createPackage(overrides?: Partial<TestPackage>): TestPackage {
  return {
    _id: "packages:at-cap" as Id<"packages">,
    name: "local-flagged-runtime-plugin",
    displayName: "Local Flagged Runtime Plugin",
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    runtimeId: null,
    sourceRepo: null,
    summary: "Flagged plugin fixture.",
    latestVersion: "1.0.0",
    updatedAt: 1,
    stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
    verification: null,
    scanStatus: "malicious",
    latestRelease: {
      version: "1.0.0",
      createdAt: 1,
      vtStatus: "malicious",
      llmStatus: "malicious",
      staticScanStatus: "malicious",
    },
    ...overrides,
  };
}

function arrangeDashboard({
  skills = [],
  packages = [],
}: {
  skills?: TestSkill[];
  packages?: TestPackage[];
}) {
  let unscopedQueryCount = 0;
  mocks.usePaginatedQuery.mockReturnValue({
    results: skills,
    status: "Exhausted",
    loadMore: vi.fn(),
  });
  mocks.useQuery.mockImplementation((_fn: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    if (args === undefined) {
      unscopedQueryCount += 1;
      return unscopedQueryCount % 2 === 1 ? me : publishers;
    }
    return packages;
  });
}

function renderDashboard() {
  return render(
    <TooltipProvider>
      <Dashboard />
    </TooltipProvider>,
  );
}

describe("Dashboard rows", () => {
  beforeEach(() => {
    mocks.useQuery.mockReset();
    mocks.usePaginatedQuery.mockReset();
    mocks.usePaginatedQuery.mockReturnValue({
      results: [],
      status: "LoadingFirstPage",
      loadMore: vi.fn(),
    });
    mocks.useMutation.mockReset();
    mocks.useMutation.mockReturnValue(vi.fn().mockResolvedValue({}));
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  it("renders rich artifact cards with status, scan, and inventory context", () => {
    arrangeDashboard({
      skills: [createSkill()],
      packages: [createPackage({ stats: { downloads: 42, installs: 9, stars: 0, versions: 1 } })],
    });

    renderDashboard();

    expect(screen.getByRole("link", { name: "Local Flagged Skill" }).getAttribute("href")).toBe(
      "/local/local-flagged-skill",
    );
    expect(
      screen.getByRole("link", { name: "Local Flagged Runtime Plugin" }).getAttribute("href"),
    ).toBe("/plugins/local-flagged-runtime-plugin");
    expect(screen.getByText("Flagged skill fixture.")).toBeTruthy();
    expect(screen.getByText("Flagged plugin fixture.")).toBeTruthy();
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Malicious").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Scan result").length).toBe(2);
    expect(screen.getAllByText("VT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LLM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Static").length).toBeGreaterThan(0);
    expect(screen.queryByText(/rescans/i)).toBeNull();
    expect(screen.queryByText("Limit reached (3/3)")).toBeNull();
    expect(screen.getAllByText("Downloads").length).toBeGreaterThan(0);
    expect(screen.queryByText("Installs")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open actions for Local Flagged Skill" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open actions for Local Flagged Runtime Plugin" }),
    ).toBeTruthy();
  });

  it("renders a skeleton while auth state is loading", () => {
    mocks.useQuery.mockReturnValue(undefined);

    renderDashboard();

    expect(screen.queryByText("Sign in to access your dashboard.")).toBeNull();
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("keeps scanner rerun actions out of the dashboard", () => {
    arrangeDashboard({ skills: [createSkill()], packages: [createPackage()] });

    renderDashboard();

    expect(screen.queryByRole("button", { name: /rescan/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /rescan/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /new version/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /new release/i })).toBeNull();
  });

  it("uses the canonical skill href when publisher selection is stale", () => {
    arrangeDashboard({
      skills: [createSkill()],
    });
    let unscopedQueryCount = 0;
    mocks.useQuery.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args === undefined) {
        unscopedQueryCount += 1;
        return unscopedQueryCount % 2 === 1
          ? { ...me, handle: "Local Owner" }
          : [
              {
                publisher: {
                  _id: "publishers:stale" as Id<"publishers">,
                  handle: "Local Owner",
                  displayName: "Local Owner",
                  kind: "user" as const,
                },
                role: "owner" as const,
              },
            ];
      }
      return [];
    });

    renderDashboard();

    expect(screen.getByRole("link", { name: "Local Flagged Skill" }).getAttribute("href")).toBe(
      "/local/local-flagged-skill",
    );
  });

  it("exposes package delete from the plugin row action menu", () => {
    arrangeDashboard({ packages: [createPackage({ scanStatus: "clean" })] });

    renderDashboard();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Open actions for Local Flagged Runtime Plugin" }),
    );

    expect(screen.getByRole("menuitem", { name: /delete plugin/i })).toBeTruthy();
  });

  it("does not render legacy table column titles or scanner prefixes", () => {
    arrangeDashboard({ skills: [createSkill()], packages: [createPackage()] });

    renderDashboard();

    expect(screen.queryByText("Summary")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText(/^VT:/)).toBeNull();
    expect(screen.queryByText(/^LLM:/)).toBeNull();
    expect(screen.queryByText(/^ClawScan:/)).toBeNull();
    expect(screen.queryByText(/^Static:/)).toBeNull();
  });
});
