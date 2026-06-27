/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dashboard } from "./dashboard";

vi.mock("../components/dashboard/DashboardPublisherSelect", () => ({
  DashboardPublisherSelect: ({
    value,
    onValueChange,
    publishers,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    publishers: Array<{ publisher?: { _id: string; handle: string } | null }>;
  }) => (
    <select
      aria-label="Dashboard publisher"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {publishers
        .filter((entry) => entry.publisher)
        .map((entry) => (
          <option key={entry.publisher!._id} value={entry.publisher!._id}>
            @{entry.publisher!.handle}
          </option>
        ))}
    </select>
  ),
}));

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  usePaginatedQuery: vi.fn(),
  useAuthStatus: vi.fn(),
  dashboardSearch: {} as Record<string, unknown>,
  rerenderDashboard: null as null | (() => void),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  usePaginatedQuery: (...args: unknown[]) => mocks.usePaginatedQuery(...args),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => mocks.useAuthStatus(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => mocks.dashboardSearch,
    useNavigate: () => (options: { search?: Record<string, unknown> }) => {
      mocks.dashboardSearch = options.search ?? {};
      mocks.rerenderDashboard?.();
    },
  }),
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
    installs: number;
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
  topInspectorFinding?: {
    message: string;
    remediation?: string;
  };
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
    stats: { downloads: 1_234, installs: 56, stars: 7, versions: 3 },
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

function createCatalogSkill(overrides?: Partial<TestSkill>): TestSkill {
  return createSkill({
    moderationVerdict: undefined,
    isSuspicious: false,
    moderationFlags: [],
    latestVersion: {
      version: "1.0.0",
      createdAt: 1,
      vtStatus: "clean",
      llmStatus: "clean",
      staticScanStatus: "clean",
    },
    ...overrides,
  });
}

function createCatalogPackage(overrides?: Partial<TestPackage>): TestPackage {
  return createPackage({
    scanStatus: "clean",
    stats: { downloads: 42, installs: 9, stars: 0, versions: 1 },
    latestRelease: {
      version: "1.0.0",
      createdAt: 1,
      vtStatus: "clean",
      llmStatus: "clean",
      staticScanStatus: "clean",
    },
    ...overrides,
  });
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

function renderDashboard(search: Record<string, unknown> = {}) {
  mocks.dashboardSearch = search;
  const view = render(
    <TooltipProvider>
      <Dashboard />
    </TooltipProvider>,
  );
  mocks.rerenderDashboard = () => {
    view.rerender(
      <TooltipProvider>
        <Dashboard />
      </TooltipProvider>,
    );
  };
  return view;
}

describe("Dashboard rows", () => {
  beforeEach(() => {
    mocks.useQuery.mockReset();
    mocks.usePaginatedQuery.mockReset();
    mocks.useAuthStatus.mockReset();
    mocks.dashboardSearch = {};
    mocks.rerenderDashboard = null;
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

  it("filters catalog items by kind", () => {
    arrangeDashboard({
      skills: [
        createSkill({
          moderationVerdict: undefined,
          isSuspicious: false,
          moderationFlags: [],
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "clean",
            llmStatus: "clean",
            staticScanStatus: "clean",
          },
        }),
      ],
      packages: [
        createPackage({
          scanStatus: "clean",
          stats: { downloads: 42, installs: 9, stars: 0, versions: 1 },
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

    fireEvent.click(screen.getByRole("radio", { name: /Skills 1/i }));

    expect(screen.getAllByText("Local Flagged Skill").length).toBeGreaterThan(0);
    expect(screen.queryByText("Local Flagged Runtime Plugin")).toBeNull();
  });

  it("reorders catalog items when sort changes", () => {
    arrangeDashboard({
      skills: [
        createSkill({
          moderationVerdict: undefined,
          isSuspicious: false,
          moderationFlags: [],
          stats: { downloads: 5, installsCurrent: 1, installsAllTime: 5, stars: 0, versions: 1 },
          updatedAt: 500,
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "clean",
            llmStatus: "clean",
            staticScanStatus: "clean",
          },
        }),
      ],
      packages: [
        createPackage({
          scanStatus: "clean",
          stats: { downloads: 99, installs: 99, stars: 0, versions: 1 },
          updatedAt: 100,
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

    const inventory = screen.getByRole("region", { name: "My packages" });
    fireEvent.click(within(inventory).getByRole("combobox", { name: "Sort" }));
    fireEvent.click(screen.getByRole("option", { name: "Most downloaded" }));

    expect(screen.getAllByText(/Local Flagged/)[0]?.textContent).toContain("Plugin");
  });

  it("filters the catalog with the search box", () => {
    arrangeDashboard({
      skills: [
        createSkill({
          moderationVerdict: undefined,
          isSuspicious: false,
          moderationFlags: [],
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "clean",
            llmStatus: "clean",
            staticScanStatus: "clean",
          },
        }),
      ],
      packages: [
        createPackage({
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

    fireEvent.change(screen.getAllByLabelText("Search catalog")[1]!, {
      target: { value: "runtime" },
    });

    expect(screen.getByText("Local Flagged Runtime Plugin")).toBeTruthy();
    expect(screen.queryByText("Local Flagged Skill")).toBeNull();

    fireEvent.change(screen.getAllByLabelText("Search catalog")[1]!, {
      target: { value: "nothing-matches" },
    });

    expect(screen.getByText(/No matches for/i)).toBeTruthy();
  });

  it("renders catalog rows in list view by default and toggles to grid", () => {
    arrangeDashboard({
      skills: [createCatalogSkill()],
      packages: [createCatalogPackage()],
    });

    renderDashboard();

    expect(document.querySelector(".browse-list-stack")).toBeTruthy();
    expect(document.querySelectorAll(".dashboard-catalog-row").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    expect(document.querySelector(".dashboard-catalog-grid")).toBeTruthy();
  });

  it("does not pad small catalogs with synthetic packages", () => {
    arrangeDashboard({ skills: [createCatalogSkill()] });

    renderDashboard();

    expect(document.querySelectorAll(".dashboard-catalog-row")).toHaveLength(1);
    expect(screen.getByText("Local Flagged Skill")).toBeTruthy();
    expect(screen.queryByText("Workflow Guard")).toBeNull();
    expect(screen.queryByText("GitHub Importer")).toBeNull();
  });

  it("shows dashboard header identity without inventory count", () => {
    arrangeDashboard({
      skills: [createCatalogSkill()],
      packages: [createCatalogPackage()],
    });

    renderDashboard();

    const heading = screen.getByRole("heading", { name: "Dashboard" });
    expect(heading.classList.contains("browse-title")).toBe(true);
    expect(heading.closest(".dashboard-scope-bar")).toBeNull();
    expect(document.querySelector(".dashboard-scope-bar")).toBeNull();
    expect(document.querySelector(".dashboard-header-count")).toBeNull();
    expect(screen.getByRole("heading", { name: "My packages" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add to ClawHub" })).toBeTruthy();
    expect(screen.getByText("Bring in skills from a repo you control.")).toBeTruthy();
  });

  it("renders scannable list rows with status, downloads, summaries, and row menus", () => {
    arrangeDashboard({
      skills: [createSkill()],
      packages: [createPackage({ stats: { downloads: 42, installs: 9, stars: 0, versions: 1 } })],
    });

    renderDashboard();

    expect(screen.getByLabelText("Needs attention")).toBeTruthy();
    expect(document.querySelectorAll(".dashboard-attention-row").length).toBe(2);
    expect(screen.getAllByText("Security").length).toBeGreaterThan(0);
    expect(screen.getByText("Local Flagged Skill")).toBeTruthy();
    expect(screen.getByText("Local Flagged Runtime Plugin")).toBeTruthy();
    const attention = screen.getByLabelText("Needs attention");
    const skillAttention = within(attention).getByRole("link", { name: /Local Flagged Skill/ });
    const pluginAttention = within(attention).getByRole("link", {
      name: /Local Flagged Runtime Plugin/,
    });
    expect(pluginAttention.textContent).toContain("Blocked");
    expect(skillAttention.getAttribute("aria-label")).toContain("Security: Needs review");
    expect(pluginAttention.getAttribute("aria-label")).toContain("Security: Blocked");
    expect(document.querySelectorAll(".dashboard-catalog-row").length).toBe(0);

    expect(screen.queryByText("VT")).toBeNull();
    expect(screen.queryByText("LLM")).toBeNull();
    expect(screen.queryByText("Static")).toBeNull();
    expect(screen.queryByText(/rescans/i)).toBeNull();
    expect(screen.queryByText("Limit reached (3/3)")).toBeNull();
    const downloads = screen.getByRole("region", { name: "Download metrics" });
    expect(downloads.textContent).toContain("Total downloads");
    expect(downloads.textContent).toContain("Skills");
  });

  it("groups issues by artifact without merging distinct Convex ids", () => {
    arrangeDashboard({
      packages: [
        createPackage({
          _id: "packages:first" as Id<"packages">,
          inspectorWarningCount: 1,
          topInspectorFinding: {
            message: "deprecated hook",
            remediation: "Replace the deprecated hook",
          },
          scanStatus: "suspicious",
          latestRelease: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "suspicious",
            llmStatus: "suspicious",
            staticScanStatus: "suspicious",
          },
        }),
        createPackage({
          _id: "packages:second" as Id<"packages">,
          name: "second-runtime-plugin",
          displayName: "Second Runtime Plugin",
          scanStatus: "suspicious",
          latestRelease: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "suspicious",
            llmStatus: "suspicious",
            staticScanStatus: "suspicious",
          },
        }),
      ],
    });

    renderDashboard();

    expect(document.querySelectorAll(".dashboard-attention-row")).toHaveLength(2);
    const groupedRow = screen.getByRole("link", {
      name: /Local Flagged Runtime Plugin\. 2 issues/i,
    });
    expect(groupedRow.textContent).toContain("Validation");
    expect(groupedRow.textContent).toContain("Security");
    expect(groupedRow.getAttribute("href")).toBe(
      "/local/plugins/local-flagged-runtime-plugin/security-audit",
    );
    expect(screen.getByRole("link", { name: /Second Runtime Plugin\. 1 issue/i })).toBeTruthy();
  });

  it("links public plugin finding counts to the plugin validation tab", () => {
    // flagged plugin stays in needs-attention queue; use attention filter for inventory drill-down

    arrangeDashboard({
      packages: [
        createPackage({
          inspectorWarningCount: 2,
          scanStatus: "clean",
          stats: { downloads: 42, installs: 9, stars: 0, versions: 1 },
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

    renderDashboard({ kind: "attention" });

    const validationLink = screen.getByRole("link", {
      name: "View 2 validation findings for Local Flagged Runtime Plugin",
    });
    expect(validationLink.getAttribute("href")).toBe(
      "/plugins/local-flagged-runtime-plugin#validation",
    );
    expect(validationLink.parentElement?.closest("a")).toBeNull();
    expect(validationLink.textContent).toBe("2 warnings");
    expect(screen.getByRole("link", { name: "Open Local Flagged Runtime Plugin" })).toBeTruthy();
    expect(screen.getByText("42 downloads", { selector: ".sr-only" })).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
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
      results: [
        createSkill({
          moderationVerdict: undefined,
          isSuspicious: false,
          moderationFlags: [],
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "clean",
            llmStatus: "clean",
            staticScanStatus: "clean",
          },
        }),
      ],
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
    expect(screen.getByText(/@clawkit/)).toBeTruthy();

    fireEvent.change(selector, { target: { value: "publishers:clawkit" } });

    await waitFor(() =>
      expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), {
        ownerPublisherId: "publishers:clawkit",
        limit: 100,
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByText("ClawKit for Lovable").length).toBeGreaterThan(0),
    );
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
      results: [
        createSkill({
          moderationVerdict: undefined,
          isSuspicious: false,
          moderationFlags: [],
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "clean",
            llmStatus: "clean",
            staticScanStatus: "clean",
          },
        }),
      ],
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

    expect((await screen.findByRole("link", { name: "Add to ClawHub" })).getAttribute("href")).toBe(
      "/add?kind=skill&ownerHandle=clawkit",
    );
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
      skills: [createCatalogSkill()],
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

    expect(
      screen.getAllByRole("link", { name: /Local Flagged Skill/i })[0]?.getAttribute("href"),
    ).toBe("/local/local-flagged-skill");
  });

  it("exposes row actions inside the overflow menu", () => {
    arrangeDashboard({ packages: [createCatalogPackage()] });

    renderDashboard();

    expect(
      screen.getByRole("button", { name: "Open actions for Local Flagged Runtime Plugin" }),
    ).toBeTruthy();
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
