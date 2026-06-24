/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dashboard } from "./dashboard";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  usePaginatedQuery: vi.fn(),
  useAuthStatus: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  usePaginatedQuery: (...args: unknown[]) => mocks.usePaginatedQuery(...args),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => mocks.useAuthStatus(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({
    children,
    to,
    params,
    search,
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
            ? `${to}${formatSearch(search)}`
            : "/test"
      }
      {...props}
    >
      {children}
    </a>
  ),
}));

function formatSearch(search: unknown) {
  if (!search || typeof search !== "object") return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

vi.mock("../components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      aria-label="Dashboard publisher"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
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
  inspectorWarningCount?: number;
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
    inspectorWarningCount: 0,
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
  mocks.usePaginatedQuery.mockReturnValue({
    results: skills,
    status: "Exhausted",
    loadMore: vi.fn(),
  });
  mocks.useQuery.mockImplementation((query: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(query as never);
    if (name === "publishers:listMine") return publishers;
    if (name === "packages:list") return packages;
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
    mocks.useAuthStatus.mockReset();
    mocks.usePaginatedQuery.mockReturnValue({
      results: [],
      status: "LoadingFirstPage",
      loadMore: vi.fn(),
    });
    mocks.useAuthStatus.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me,
    });
  });

  it("renders compact clickable artifact cards with status and inventory context", () => {
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
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Malicious").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Security scan").length).toBe(2);
    expect(screen.queryByText("Flagged skill fixture.")).toBeNull();
    expect(screen.queryByText("Flagged plugin fixture.")).toBeNull();
    expect(screen.queryByText("VT")).toBeNull();
    expect(screen.queryByText("LLM")).toBeNull();
    expect(screen.queryByText("Static")).toBeNull();
    expect(screen.queryByText(/rescans/i)).toBeNull();
    expect(screen.queryByText("Limit reached (3/3)")).toBeNull();
    expect(screen.getAllByText("Downloads").length).toBe(2);
    expect(screen.queryByText("Installs")).toBeNull();
    expect(screen.getByText("1.2K")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getAllByText("Current version").length).toBe(2);
    expect(screen.getAllByText("Last updated").length).toBe(2);
    expect(
      screen.getByRole("link", { name: "Open settings for Local Flagged Skill" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Open settings for Local Flagged Runtime Plugin" }),
    ).toBeNull();
  });

  it("links public plugin finding counts to the plugin validation section", () => {
    arrangeDashboard({
      packages: [
        createPackage({
          inspectorWarningCount: 2,
          scanStatus: "clean",
          latestRelease: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "clean",
            llmStatus: "clean",
            staticScanStatus: "clean",
          },
        }),
      ],
    });

    renderDashboard();

    const validationLink = screen.getByRole("link", {
      name: "View 2 validation findings for Local Flagged Runtime Plugin",
    });
    expect(validationLink.getAttribute("href")).toBe(
      "/plugins/local-flagged-runtime-plugin#validation",
    );
  });

  it("shows a publisher selector and loads org packages when switching publishers", async () => {
    const orgPublishers = [
      publishers[0],
      {
        publisher: {
          _id: "publishers:clawkit" as Id<"publishers">,
          handle: "clawkit",
          displayName: "ClawKit",
          kind: "org" as const,
        },
        role: "admin" as const,
      },
    ];
    const orgPackage = createPackage({
      _id: "packages:clawkit" as Id<"packages">,
      name: "@clawkit/clawkit-for-lovable",
      displayName: "ClawKit for Lovable",
      scanStatus: "clean",
    });

    mocks.usePaginatedQuery.mockReturnValue({
      results: [],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    mocks.useQuery.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query as never);
      if (name === "publishers:listMine") return orgPublishers;
      if (
        typeof args === "object" &&
        args !== null &&
        "ownerPublisherId" in args &&
        (args as { ownerPublisherId?: string }).ownerPublisherId === "publishers:clawkit"
      ) {
        return [orgPackage];
      }
      return [];
    });

    renderDashboard();

    const selector = await screen.findByLabelText("Dashboard publisher");
    await waitFor(() =>
      expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), {
        ownerPublisherId: "publishers:local",
        limit: 100,
      }),
    );
    expect(screen.getByText("@clawkit · Org")).toBeTruthy();

    fireEvent.change(selector, { target: { value: "publishers:clawkit" } });

    await waitFor(() =>
      expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), {
        ownerPublisherId: "publishers:clawkit",
        limit: 100,
      }),
    );
    expect(screen.getByText("ClawKit for Lovable")).toBeTruthy();
  });

  it("passes the selected publisher into skill publishing links", async () => {
    const orgPublishers = [
      publishers[0],
      {
        publisher: {
          _id: "publishers:clawkit" as Id<"publishers">,
          handle: "clawkit",
          displayName: "ClawKit",
          kind: "org" as const,
        },
        role: "admin" as const,
      },
    ];
    mocks.usePaginatedQuery.mockReturnValue({
      results: [],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    mocks.useQuery.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query as never);
      if (name === "publishers:listMine") return orgPublishers;
      return [];
    });

    renderDashboard();

    fireEvent.change(await screen.findByLabelText("Dashboard publisher"), {
      target: { value: "publishers:clawkit" },
    });

    expect(
      (await screen.findByRole("link", { name: "Publish manually" })).getAttribute("href"),
    ).toBe("/skills/publish?ownerHandle=clawkit");
  });

  it("renders a skeleton while auth state is loading", () => {
    mocks.useAuthStatus.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      me: undefined,
    });
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
    mocks.useAuthStatus.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { ...me, handle: "Local Owner" },
    });
    mocks.useQuery.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query as never);
      if (name === "publishers:listMine")
        return [
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
      return [];
    });

    renderDashboard();

    expect(screen.getByRole("link", { name: "Local Flagged Skill" }).getAttribute("href")).toBe(
      "/local/local-flagged-skill",
    );
  });

  it("does not show plugin settings from the row action", () => {
    arrangeDashboard({ packages: [createPackage({ scanStatus: "clean" })] });

    renderDashboard();

    expect(
      screen.queryByRole("link", { name: "Open settings for Local Flagged Runtime Plugin" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /open actions/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /delete plugin/i })).toBeNull();
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
