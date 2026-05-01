/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dashboard } from "./dashboard";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
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
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode }) => (
    <a href="/test" {...props}>
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
  ownerUserId: Id<"users">;
  ownerPublisherId: Id<"publishers">;
  tags: {};
  badges: {};
  stats: {
    downloads: number;
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
  rescanState: {
    maxRequests: number;
    requestCount: number;
    remainingRequests: number;
    canRequest: boolean;
    inProgressRequest: null | { _id: string; status: "in_progress"; targetVersion: string };
    latestRequest: null | { _id: string; status: "completed" | "failed"; targetVersion: string };
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
    storepackAvailable: boolean;
    storepackSha256: string | null;
    hostTargets: null;
    environment: null;
  };
  rescanState: TestSkill["rescanState"];
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
    ownerUserId: me._id,
    ownerPublisherId: publishers[0].publisher._id,
    tags: {},
    badges: {},
    stats: { downloads: 0, stars: 0, versions: 1 },
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
    rescanState: {
      maxRequests: 3,
      requestCount: 1,
      remainingRequests: 2,
      canRequest: true,
      inProgressRequest: null,
      latestRequest: null,
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
    stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
    verification: null,
    scanStatus: "malicious",
    latestRelease: {
      version: "1.0.0",
      createdAt: 1,
      vtStatus: "malicious",
      llmStatus: "malicious",
      staticScanStatus: "malicious",
      storepackAvailable: true,
      storepackSha256: "a".repeat(64),
      hostTargets: null,
      environment: null,
    },
    rescanState: {
      maxRequests: 3,
      requestCount: 3,
      remainingRequests: 0,
      canRequest: false,
      inProgressRequest: null,
      latestRequest: null,
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
  let scopedQueryCount = 0;
  mocks.useQuery.mockImplementation((_fn: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    if (args === undefined) {
      unscopedQueryCount += 1;
      return unscopedQueryCount % 2 === 1 ? me : publishers;
    }
    scopedQueryCount += 1;
    return scopedQueryCount % 2 === 1 ? skills : packages;
  });
}

function renderDashboard() {
  return render(
    <TooltipProvider>
      <Dashboard />
    </TooltipProvider>,
  );
}

describe("Dashboard minimal rows", () => {
  beforeEach(() => {
    mocks.useQuery.mockReset();
    mocks.useMutation.mockReset();
    mocks.useMutation.mockReturnValue(vi.fn().mockResolvedValue({}));
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  it("renders entry links, summaries, and aggregate statuses only", () => {
    arrangeDashboard({ skills: [createSkill()], packages: [createPackage()] });

    renderDashboard();

    expect(screen.getByRole("link", { name: "Local Flagged Skill" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Local Flagged Runtime Plugin" })).toBeTruthy();
    expect(screen.getByText("Flagged skill fixture.")).toBeTruthy();
    expect(screen.getByText("Flagged plugin fixture.")).toBeTruthy();
    expect(screen.getByText("Suspicious")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Suspicious status reason" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Blocked status reason" })).toBeTruthy();
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

  it("links new publishers to plugin publishing from the empty state", () => {
    arrangeDashboard({ skills: [], packages: [] });

    renderDashboard();

    expect(screen.getByRole("link", { name: "Publish a Plugin" })).toBeTruthy();
  });

  it("does not render row-level actions", () => {
    arrangeDashboard({ skills: [createSkill()], packages: [createPackage()] });

    renderDashboard();

    expect(screen.queryByRole("button", { name: /request rescan/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /new version/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /new release/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^view$/i })).toBeNull();
  });

  it("surfaces missing StorePack artifacts in plugin dashboard status", () => {
    arrangeDashboard({
      packages: [
        createPackage({
          scanStatus: "clean",
          latestRelease: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "clean",
            llmStatus: "clean",
            staticScanStatus: "clean",
            storepackAvailable: false,
            storepackSha256: null,
            hostTargets: null,
            environment: null,
          },
        }),
      ],
    });

    renderDashboard();

    expect(screen.getByText("StorePack missing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "StorePack missing status reason" })).toBeTruthy();
  });

  it("does not render column titles, scanner details, or plugin metadata chips", () => {
    arrangeDashboard({ skills: [createSkill()], packages: [createPackage()] });

    renderDashboard();

    expect(screen.queryByText("Skill")).toBeNull();
    expect(screen.queryByText("Plugin")).toBeNull();
    expect(screen.queryByText("Summary")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText(/^VT:/)).toBeNull();
    expect(screen.queryByText(/^LLM:/)).toBeNull();
    expect(screen.queryByText(/^ClawScan:/)).toBeNull();
    expect(screen.queryByText(/^Static/)).toBeNull();
    expect(screen.queryByText(/public surfaces warn or suppress it/i)).toBeNull();
    expect(screen.queryByText(/automated security checks found malicious content/i)).toBeNull();
    expect(screen.queryByText("Code Plugin")).toBeNull();
    expect(screen.queryByText("community")).toBeNull();
    expect(screen.queryByText("2/3 rescans left")).toBeNull();
    expect(screen.queryByText("Limit reached (3/3)")).toBeNull();
  });
});
