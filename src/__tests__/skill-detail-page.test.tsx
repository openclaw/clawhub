import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { SkillDetailPage } from "../components/SkillDetailPage";

const navigateMock = vi.fn();
const routerInvalidateMock = vi.fn();
const useAuthStatusMock = vi.fn();

process.env.VITE_CONVEX_URL = process.env.VITE_CONVEX_URL ?? "https://example.convex.cloud";

vi.mock("../components/UserBadge", () => ({
  UserBadge: () => null,
}));

vi.mock("../convex/client", () => ({
  convex: {},
  convexHttp: { query: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: routerInvalidateMock }),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { searchStr: string } }) => string;
  }) => select({ location: { searchStr: "" } }),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const convexQueryMock = vi.fn();
const convexClientMock = { query: convexQueryMock };
const getReadmeMock = vi.fn();

function getDesktopSkillTabs() {
  return within(screen.getByRole("tablist", { name: "Skill detail tabs", hidden: true }));
}

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useConvex: () => convexClientMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useAction: () => getReadmeMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

describe("SkillDetailPage", () => {
  const skillId = "skills:1" as Id<"skills">;
  const ownerId = "users:1" as Id<"users">;
  const ownerPublisherId = "publishers:steipete" as Id<"publishers">;
  const versionId = "skillVersions:1" as Id<"skillVersions">;
  const storageId = "storage:1" as Id<"_storage">;

  beforeEach(() => {
    window.location.hash = "";
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    convexQueryMock.mockReset();
    getReadmeMock.mockReset();
    navigateMock.mockReset();
    routerInvalidateMock.mockReset();
    useAuthStatusMock.mockReset();
    getReadmeMock.mockResolvedValue({ text: "" });
    useMutationMock.mockReturnValue(vi.fn());
    vi.mocked(toast.success).mockReset();
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });
    convexQueryMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while loading", () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);
    expect(screen.getByRole("status", { name: /Loading skill details/i })).toBeTruthy();
    expect(screen.queryByText(/Skill not found/i)).toBeNull();
  });

  it("renders loader-backed skill content before live queries resolve", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [
                {
                  path: "SKILL.md",
                  size: 10,
                  storageId,
                  sha256: "abc",
                  contentType: "text/markdown",
                },
              ],
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect(screen.queryByText(/Loading skill/i)).toBeNull();
    expect((await screen.findAllByRole("heading", { name: "Weather" })).length).toBeGreaterThan(0);
    expect(screen.getByText(/Get current weather\./i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Diff" })).toBeNull();
  });

  it("loads skill activity graphs through a deferred one-shot query", async () => {
    const activityTrend = {
      installs: {
        range: "daily" as const,
        days: 30,
        total: 5,
        points: [
          { day: 20_451, value: 1 },
          { day: 20_452, value: 0 },
          { day: 20_453, value: 2 },
          { day: 20_454, value: 1 },
          { day: 20_455, value: 1 },
        ],
      },
      downloads: {
        range: "daily" as const,
        days: 30,
        total: 12,
        points: [
          { day: 20_451, value: 1 },
          { day: 20_452, value: 0 },
          { day: 20_453, value: 4 },
          { day: 20_454, value: 3 },
          { day: 20_455, value: 4 },
        ],
      },
    };
    const initialData = {
      result: {
        skill: {
          _id: skillId,
          _creationTime: 0,
          slug: "weather",
          displayName: "Weather",
          summary: "Get current weather.",
          ownerUserId: ownerId,
          ownerPublisherId,
          tags: {},
          badges: {},
          stats: {
            stars: 12,
            downloads: 34,
            installsCurrent: 5,
            installsAllTime: 8,
            versions: 1,
            comments: 0,
          },
          createdAt: 0,
          updatedAt: 0,
        },
        owner: {
          _id: ownerPublisherId,
          _creationTime: 0,
          kind: "user" as const,
          handle: "steipete",
          displayName: "Peter",
          linkedUserId: ownerId,
        },
        latestVersion: {
          _id: versionId,
          _creationTime: 0,
          skillId,
          version: "1.0.0",
          fingerprint: "abc",
          changelog: "Initial release",
          parsed: { license: "MIT-0" as const, frontmatter: {} },
          files: [
            {
              path: "SKILL.md",
              size: 10,
              storageId,
              sha256: "abc",
              contentType: "text/markdown",
            },
          ],
          createdBy: ownerId,
          createdAt: 0,
        },
        forkOf: null,
        canonical: null,
      },
      readme: "# Weather",
      readmeError: null,
    };
    convexQueryMock.mockResolvedValueOnce(activityTrend);

    const { container, rerender } = render(
      <SkillDetailPage slug="weather" initialData={initialData} />,
    );

    expect(screen.getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.getAllByText("Downloads").length).toBeGreaterThan(0);
    expect(screen.queryByText("30-day Installs")).toBeNull();
    expect(
      container.querySelectorAll(".detail-sidebar-stats .metric-trend-card-skeleton"),
    ).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
    expect(
      useQueryMock.mock.calls.some(
        ([query]) => getFunctionName(query as never) === "skills:getActivityTrendForSlug",
      ),
    ).toBe(false);

    await waitFor(() => expect(convexQueryMock).toHaveBeenCalled());
    rerender(<SkillDetailPage slug="weather" initialData={initialData} />);

    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
    expect(screen.getByRole("img", { name: "Daily downloads over the last 30 days" })).toBeTruthy();
    expect(container.querySelectorAll(".metric-trend-card-skeleton")).toHaveLength(0);
    expect(
      convexQueryMock.mock.calls.some((call) => {
        const query = call[0];
        const args = call[1];
        return (
          getFunctionName(query as never) === "skills:getActivityTrendForSlug" &&
          typeof args === "object" &&
          args !== null &&
          "slug" in args &&
          args.slug === "weather" &&
          "endDay" in args &&
          typeof args.endDay === "number" &&
          "ownerHandle" in args &&
          args.ownerHandle === "steipete"
        );
      }),
    ).toBe(true);
  });

  it("passes the loader owner id to deferred activity trends when no public owner handle is available", async () => {
    const initialData = {
      result: {
        skill: {
          _id: skillId,
          _creationTime: 0,
          slug: "weather",
          displayName: "Weather",
          summary: "Get current weather.",
          ownerUserId: ownerId,
          ownerPublisherId,
          tags: {},
          badges: {},
          stats: {
            stars: 12,
            downloads: 34,
            installsCurrent: 5,
            installsAllTime: 8,
            versions: 1,
            comments: 0,
          },
          createdAt: 0,
          updatedAt: 0,
        },
        owner: null,
        latestVersion: {
          _id: versionId,
          _creationTime: 0,
          skillId,
          version: "1.0.0",
          fingerprint: "abc",
          changelog: "Initial release",
          parsed: { license: "MIT-0" as const, frontmatter: {} },
          files: [
            {
              path: "SKILL.md",
              size: 10,
              storageId,
              sha256: "abc",
              contentType: "text/markdown",
            },
          ],
          createdBy: ownerId,
          createdAt: 0,
        },
        forkOf: null,
        canonical: null,
      },
      readme: "# Weather",
      readmeError: null,
      lookupOwnerHandle: "users:1",
    };

    render(<SkillDetailPage slug="weather" canonicalOwner="users:1" initialData={initialData} />);

    await waitFor(() => expect(convexQueryMock).toHaveBeenCalled());

    expect(
      convexQueryMock.mock.calls.some((call) => {
        const query = call[0];
        const args = call[1];
        return (
          getFunctionName(query as never) === "skills:getActivityTrendForSlug" &&
          typeof args === "object" &&
          args !== null &&
          "slug" in args &&
          args.slug === "weather" &&
          "endDay" in args &&
          typeof args.endDay === "number" &&
          "ownerHandle" in args &&
          args.ownerHandle === "users:1"
        );
      }),
    ).toBe(true);
  });

  it("does not spin forever when a source-backed skill has no stored version", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "kind" in args) return null;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="aiq-deploy"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "aiq-deploy",
              displayName: "AIQ Deploy",
              summary: "Deploy AgentIQ workflows.",
              ownerUserId: ownerId,
              ownerPublisherId,
              installKind: "github",
              githubScanStatus: "pending",
              tags: {},
              badges: {},
              stats: {
                stars: 0,
                downloads: 0,
                installsCurrent: 0,
                installsAllTime: 0,
                versions: 0,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "org",
              handle: "local",
              displayName: "Local Dev",
            },
            latestVersion: null,
            moderationInfo: null,
            forkOf: null,
            canonical: null,
          },
          readme: null,
          readmeError: null,
        }}
      />,
    );

    expect((await screen.findAllByText("Pending")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Security audit").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading README...")).toBeNull();
  });

  it("clears stale README content when navigating to a skill with no stored version", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    const { rerender } = render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [
                {
                  path: "SKILL.md",
                  size: 10,
                  storageId,
                  sha256: "abc",
                  contentType: "text/markdown",
                },
              ],
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather\n\nOnly old body.",
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByText("Only old body.")).toBeTruthy();

    rerender(
      <SkillDetailPage
        slug="aiq-deploy"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "aiq-deploy",
              displayName: "AIQ Deploy",
              summary: "Deploy AgentIQ workflows.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 0,
                downloads: 0,
                installsCurrent: 0,
                installsAllTime: 0,
                versions: 0,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "org",
              handle: "local",
              displayName: "Local Dev",
            },
            latestVersion: null,
            moderationInfo: null,
            forkOf: null,
            canonical: null,
          },
          readme: null,
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByText("No README available")).toBeTruthy();
    expect(screen.queryByText("Only old body.")).toBeNull();
  });

  it("renders GitHub-backed SKILL.md and skill-card.md from cached source content", async () => {
    getReadmeMock.mockResolvedValue({ text: "unexpected archive read" });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "kind" in args &&
        (args as { kind?: unknown }).kind === "readme"
      ) {
        return { path: "skills/aiq-deploy/SKILL.md", text: "# AIQ Deploy\n\nDeploy it." };
      }
      if (
        args &&
        typeof args === "object" &&
        "kind" in args &&
        (args as { kind?: unknown }).kind === "skill-card"
      ) {
        return { path: "skills/aiq-deploy/skill-card.md", text: "# AIQ Card\n\nRisk details." };
      }
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="aiq-deploy"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "aiq-deploy",
              displayName: "AIQ Deploy",
              summary: "Deploy AgentIQ workflows.",
              ownerUserId: ownerId,
              ownerPublisherId,
              installKind: "github",
              githubHasSkillCard: true,
              tags: {},
              badges: {},
              stats: {
                stars: 0,
                downloads: 0,
                installsCurrent: 0,
                installsAllTime: 0,
                versions: 0,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "org",
              handle: "local",
              displayName: "Local Dev",
            },
            latestVersion: null,
            moderationInfo: null,
            forkOf: null,
            canonical: null,
          },
          readme: null,
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByText("Deploy it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Skill Card" }));
    expect(await screen.findByText("Risk details.")).toBeTruthy();
    expect(getReadmeMock).not.toHaveBeenCalled();
  });

  it("does not show a Skill Card tab for publisher-supplied card files", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [
                {
                  path: "SKILL.md",
                  size: 10,
                  storageId,
                  sha256: "abc",
                  contentType: "text/markdown",
                },
                {
                  path: "skill-card.md",
                  size: 10,
                  storageId,
                  sha256: "def",
                  contentType: "text/markdown",
                },
              ],
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Skill Card" })).toBeNull();
  });

  it("restores the hash-selected Skill Card tab once the generated card is available", async () => {
    window.history.replaceState(null, "", "/steipete/weather#skill-card");
    getReadmeMock.mockResolvedValue({ text: "# Skill Card\n\nGenerated from worker." });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    const baseInitialData = {
      result: {
        skill: {
          _id: skillId,
          _creationTime: 0,
          slug: "weather",
          displayName: "Weather",
          summary: "Get current weather.",
          ownerUserId: ownerId,
          ownerPublisherId,
          tags: {},
          badges: {},
          stats: {
            stars: 12,
            downloads: 34,
            installsCurrent: 5,
            installsAllTime: 8,
            versions: 1,
            comments: 0,
          },
          createdAt: 0,
          updatedAt: 0,
        },
        owner: {
          _id: ownerPublisherId,
          _creationTime: 0,
          kind: "user" as const,
          handle: "steipete",
          displayName: "Peter",
          linkedUserId: ownerId,
        },
        latestVersion: {
          _id: versionId,
          _creationTime: 0,
          skillId,
          version: "1.0.0",
          fingerprint: "abc",
          changelog: "Initial release",
          parsed: { license: "MIT-0" as const, frontmatter: {} },
          files: [
            {
              path: "SKILL.md",
              size: 10,
              storageId,
              sha256: "abc",
              contentType: "text/markdown",
            },
          ],
          createdBy: ownerId,
          createdAt: 0,
        },
        forkOf: null,
        canonical: null,
      },
      readme: "# Weather",
      readmeError: null,
    };

    const { rerender } = render(<SkillDetailPage slug="weather" initialData={baseInitialData} />);

    expect(await screen.findByRole("tab", { name: "Files" })).toBeTruthy();
    expect(
      getDesktopSkillTabs().getByRole("tab", { name: "SKILL.md" }).getAttribute("aria-selected"),
    ).toBe("true");

    rerender(
      <SkillDetailPage
        slug="weather"
        initialData={{
          ...baseInitialData,
          result: {
            ...baseInitialData.result,
            latestVersion: {
              ...baseInitialData.result.latestVersion,
              files: [
                ...baseInitialData.result.latestVersion.files,
                {
                  path: "skill-card.md",
                  size: 32,
                  storageId,
                  sha256: "def",
                  contentType: "text/markdown",
                },
              ],
              generatedSkillCard: {
                path: "skill-card.md",
                size: 32,
                sha256: "def",
                contentType: "text/markdown",
              },
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Skill Card" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });
    expect(await screen.findByText("Generated from worker.")).toBeTruthy();
  });

  it("renders related skills from the stored category with a browse link", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "keywords" in args &&
        Array.isArray((args as { keywords?: unknown }).keywords)
      ) {
        return {
          items: [
            {
              skill: {
                _id: "skills:2" as Id<"skills">,
                _creationTime: 0,
                slug: "pipeline-builder",
                displayName: "Pipeline Builder",
                summary: "Compose agent workflow pipelines.",
                ownerUserId: ownerId,
                ownerPublisherId,
                tags: {},
                badges: {},
                stats: {
                  stars: 4,
                  downloads: 12,
                  installsCurrent: 1,
                  installsAllTime: 3,
                  versions: 1,
                  comments: 0,
                },
                createdAt: 0,
                updatedAt: 0,
              },
              latestVersion: null,
              ownerHandle: "steipete",
              owner: null,
            },
          ],
        };
      }
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="workflow-runner"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "workflow-runner",
              displayName: "Workflow Runner",
              summary: "Build repeatable agent workflow pipelines.",
              categories: ["automation"],
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [],
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Workflow Runner",
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Related skills" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Automation skills" }).getAttribute("href")).toBe(
      "/skills?category=automation",
    );
    expect(screen.getByRole("link", { name: "More in Automation" }).getAttribute("href")).toBe(
      "/skills?category=automation",
    );
    expect(screen.getByRole("link", { name: /Pipeline Builder/i })).toBeTruthy();
    expect(screen.getByText(/Compose agent workflow pipelines\./i)).toBeTruthy();
  });

  it("renders the install surface above the security scan with visible prompts and commands", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: {
                license: "MIT-0",
                frontmatter: {},
                clawdis: {
                  requires: {
                    env: ["WEATHER_API_KEY"],
                    bins: ["curl"],
                  },
                },
              },
              files: [],
              sha256hash: "abc123",
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    await screen.findByRole("heading", { name: "Install" });
    const sidebarMetadata = document.querySelector(
      '.detail-sidebar-stats dl[aria-label="Skill metadata"]',
    );
    expect(sidebarMetadata).toBeTruthy();

    expect(screen.getAllByRole("heading", { name: "Install" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("openclaw skills install @steipete/weather").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("npx clawhub@latest install @steipete/weather")).toBeNull();
    expect(screen.queryByRole("tab", { name: "ClawHub" })).toBeNull();
    expect(screen.getByRole("tab", { name: "CLI" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Prompt" })).toBeTruthy();
    expect(screen.queryByText(/After install, inspect the skill metadata/i)).toBeNull();
    expect(screen.getAllByText("Security audit").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View Security Audit" }).getAttribute("href")).toBe(
      "/steipete/weather/security-audit",
    );
    const sidebarLabels = Array.from(
      sidebarMetadata?.querySelectorAll(".sidebar-metadata-label") ?? [],
      (label) => label.textContent?.trim(),
    );
    const securityAuditLabelIndex = sidebarLabels.findIndex((label) =>
      label?.startsWith("Security audit"),
    );
    expect(securityAuditLabelIndex).toBe(sidebarLabels.indexOf("Creator") + 1);
    expect(
      screen.getByRole("button", {
        name: "Security checks across malware telemetry and agentic risk",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("No risk analysis has been recorded yet.")).toBeNull();
    expect(screen.queryByText(/Like a lobster shell, security has layers/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();

    const installHeading = screen.getAllByRole("heading", { name: "Install" })[0];
    const filesTab = screen.getByRole("tab", { name: "Files" });
    expect(
      installHeading.compareDocumentPosition(filesTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("applies staff-cleared moderation overrides to the public security summary", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="kmind-markdown-to-mindmap"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "kmind-markdown-to-mindmap",
              displayName: "KMind Markdown to Mindmap",
              summary: "Convert markdown to mindmaps.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "suka233",
              displayName: "suka233",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "0.1.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [],
              sha256hash: "abc123",
              vtAnalysis: { status: "suspicious", verdict: "suspicious", checkedAt: 1 },
              llmAnalysis: { status: "suspicious", verdict: "suspicious", checkedAt: 1 },
              staticScan: {
                status: "suspicious",
                reasonCodes: ["suspicious.dynamic_code_execution"],
                findings: [
                  {
                    code: "suspicious.dynamic_code_execution",
                    severity: "critical",
                    file: "SKILL.md",
                    line: 1,
                    message: "dynamic execution",
                    evidence: "exec",
                  },
                ],
                summary: "Suspicious dynamic execution.",
                engineVersion: "v2.4.5",
                checkedAt: 1,
              },
              createdBy: ownerId,
              createdAt: 0,
            },
            moderationInfo: {
              isPendingScan: false,
              isMalwareBlocked: false,
              isSuspicious: false,
              isHiddenByMod: false,
              isRemoved: false,
              overrideActive: true,
              verdict: "clean",
              reasonCodes: ["suspicious.dynamic_code_execution"],
              summary: "Security findings were reviewed by staff and cleared for public use.",
              engineVersion: "v2.4.5",
              updatedAt: 1,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# KMind",
          readmeError: null,
        }}
      />,
    );

    expect((await screen.findAllByText("Security audit")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cleared").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View Security Audit" })).toBeTruthy();
    expect(screen.queryByText(/reviewed by staff and cleared/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /Suspicious/i })).toBeNull();
  });

  it("does not show a scanner rerun action on the settings page for owned skills", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: ownerId, role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "limit" in args) return [];
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        mode="settings"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [],
              sha256hash: "abc123",
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    await screen.findByText("Short summary");
    expect(screen.getByRole("link", { name: "New Version" }).getAttribute("href")).toBe(
      "/publish-skill?updateSlug=weather&ownerHandle=steipete",
    );
    expect(screen.queryByText(/request security/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();
    expect(screen.queryByText(/rescans/i)).toBeNull();
  });

  it("does not refetch readme when SSR data already matches the latest version", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [
                {
                  path: "SKILL.md",
                  size: 10,
                  storageId,
                  sha256: "abc",
                  contentType: "text/markdown",
                },
              ],
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect((await screen.findAllByRole("heading", { name: "Weather" })).length).toBeGreaterThan(0);
    expect(screen.getByText(/Get current weather\./i)).toBeTruthy();
    expect(getReadmeMock).not.toHaveBeenCalled();
  });

  it("shows not found when skill query resolves to null", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return null;
    });

    render(<SkillDetailPage slug="missing-skill" />);
    expect(
      await screen.findByRole("heading", { name: /We couldn't find that page/i }),
    ).toBeTruthy();
  });

  it("redirects legacy routes to canonical owner/slug", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      return {
        skill: {
          _id: "skills:1",
          slug: "weather",
          displayName: "Weather",
          summary: "Get current weather.",
          ownerUserId: "users:1",
          ownerPublisherId: "publishers:steipete",
          tags: {},
          stats: { stars: 0, downloads: 0 },
        },
        owner: {
          _id: "publishers:steipete",
          _creationTime: 0,
          kind: "user",
          handle: "steipete",
          displayName: "Peter",
          linkedUserId: "users:1",
        },
        latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {} },
      };
    });

    render(<SkillDetailPage slug="weather" redirectToCanonical />);
    expect(screen.getByRole("status", { name: /Loading skill details/i })).toBeTruthy();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/$owner/$slug",
      params: { owner: "steipete", slug: "weather" },
      replace: true,
    });
  });

  it("redirects merged source slugs to the resolved canonical slug", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          requestedSlug: "old-weather",
          resolvedSlug: "weather",
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            badges: {},
            stats: {
              stars: 0,
              downloads: 0,
              installsCurrent: 0,
              installsAllTime: 0,
              versions: 1,
              comments: 0,
            },
            createdAt: 0,
            updatedAt: 0,
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="old-weather" canonicalOwner="steipete" />);
    expect(screen.getByRole("status", { name: /Loading skill details/i })).toBeTruthy();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/$owner/$slug",
      params: { owner: "steipete", slug: "weather" },
      replace: true,
    });
  });

  it("does not redirect when a staff owner handle only differs by case", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:staff", role: "moderator" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "SteiPete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        canonicalOwner="steipete"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installsCurrent: 5,
                installsAllTime: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: ownerId,
            },
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [],
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect(screen.queryByText(/Loading skill/i)).toBeNull();
    expect(screen.getAllByText("Weather").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /settings/i }).getAttribute("href")).toBe(
      "/SteiPete/weather/settings",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("invalidates route data and updates the star button while the live skill query is stale", async () => {
    const toggleStarMock = vi
      .fn()
      .mockResolvedValueOnce({ starred: true })
      .mockResolvedValueOnce({ starred: false });
    useMutationMock.mockReturnValue(toggleStarMock);
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:viewer", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args && "limit" in args) return [];
      if (args && typeof args === "object" && "skillId" in args) return false;
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: skillId,
            _creationTime: 0,
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: ownerId,
            ownerPublisherId,
            tags: {},
            badges: {},
            stats: {
              stars: 8,
              downloads: 34,
              installsCurrent: 5,
              installsAllTime: 8,
              versions: 1,
              comments: 0,
            },
            createdAt: 0,
            updatedAt: 0,
          },
          owner: {
            _id: ownerPublisherId,
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: ownerId,
          },
          latestVersion: {
            _id: versionId,
            _creationTime: 0,
            skillId,
            version: "1.0.0",
            fingerprint: "abc",
            changelog: "Initial release",
            parsed: { license: "MIT-0", frontmatter: {} },
            files: [],
            createdBy: ownerId,
            createdAt: 0,
          },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);

    const starButton = await screen.findByRole("button", { name: "Star skill" });
    expect(starButton.textContent).toContain("8");

    fireEvent.click(starButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unstar skill" }).textContent).toContain("9");
    });
    expect(toggleStarMock).toHaveBeenCalledWith({ skillId });

    fireEvent.click(screen.getByRole("button", { name: "Unstar skill" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Star skill" }).textContent).toContain("8");
    });
    expect(toggleStarMock).toHaveBeenCalledTimes(2);
    expect(routerInvalidateMock).toHaveBeenCalledTimes(2);
  });

  it("renders refreshed starred server state with the synchronized star count", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:viewer", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args && "limit" in args) return [];
      if (args && typeof args === "object" && "skillId" in args) return true;
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: skillId,
            _creationTime: 0,
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: ownerId,
            ownerPublisherId,
            tags: {},
            badges: {},
            stats: {
              stars: 1,
              downloads: 34,
              installsCurrent: 5,
              installsAllTime: 8,
              versions: 1,
              comments: 0,
            },
            createdAt: 0,
            updatedAt: 0,
          },
          owner: {
            _id: ownerPublisherId,
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: ownerId,
          },
          latestVersion: {
            _id: versionId,
            _creationTime: 0,
            skillId,
            version: "1.0.0",
            fingerprint: "abc",
            changelog: "Initial release",
            parsed: { license: "MIT-0", frontmatter: {} },
            files: [],
            createdBy: ownerId,
            createdAt: 0,
          },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);

    expect((await screen.findByRole("button", { name: "Unstar skill" })).textContent).toContain(
      "1",
    );
  });

  it("opens report dialog for authenticated users", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:reporter", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);

    expect(
      screen.queryByText(/Reports require a reason\. Abuse may result in a ban\./i),
    ).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /report/i }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Report skill/i)).toBeTruthy();
  });

  it("links owner tools from the detail page and renders them on settings", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        ("ownerUserId" in args || "ownerPublisherId" in args)
      ) {
        return [
          { _id: "skills:1", slug: "weather", displayName: "Weather" },
          { _id: "skills:2", slug: "weather-pro", displayName: "Weather Pro" },
        ];
      }
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    const { unmount } = render(<SkillDetailPage slug="weather" />);

    const settingsLink = await screen.findByRole("link", { name: /settings/i });
    expect(settingsLink.getAttribute("href")).toBe("/steipete/weather/settings");
    expect(screen.queryByText(/Owner tools/i)).toBeNull();
    unmount();

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    const newVersionLink = screen.getByRole("link", { name: /Update skill files/i });
    expect(newVersionLink.getAttribute("href")).toBe(
      "/skills/publish?updateSlug=weather&ownerHandle=steipete",
    );
    expect(screen.getByText("Rename slug")).toBeTruthy();
    expect(screen.getByText("Merge listing")).toBeTruthy();
  });

  it("lets owners confirm skill deletion from settings", async () => {
    const deleteSkill = vi.fn().mockResolvedValue({
      ok: true,
      slugReservedUntil: Date.UTC(2026, 6, 7),
    });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "skills:setOwnedSkillSoftDeleted" ? deleteSkill : vi.fn(),
    );
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        ("ownerUserId" in args || "ownerPublisherId" in args)
      ) {
        return [{ _id: "skills:1", slug: "weather", displayName: "Weather" }];
      }
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete skill" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));

    expect(deleteSkill).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete skill" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));

    await waitFor(() => {
      expect(deleteSkill).toHaveBeenCalledWith({ skillId });
    });
    expect(toast.success).toHaveBeenCalledWith("Deleted weather.");
    expect(navigateMock).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("does not show the owner delete action to staff-only settings viewers", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:moderator", role: "moderator" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    expect(screen.getByText("Rename slug")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete skill" })).toBeNull();
  });

  it.each([
    {
      label: "active",
      availability: {},
      moderationInfo: null,
      shouldShowDelete: true,
    },
    {
      label: "soft-deleted",
      availability: { softDeletedAt: 123 },
      moderationInfo: null,
      shouldShowDelete: false,
    },
    {
      label: "hidden by moderation",
      availability: { moderationStatus: "hidden" as const },
      moderationInfo: null,
      shouldShowDelete: false,
    },
    {
      label: "removed by moderation",
      availability: { moderationStatus: "removed" as const },
      moderationInfo: null,
      shouldShowDelete: false,
    },
    {
      label: "legacy hiddenAt-only",
      availability: { hiddenAt: 123 },
      moderationInfo: null,
      shouldShowDelete: true,
    },
    {
      label: "owner-visible hidden public result",
      availability: {},
      moderationInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isSuspicious: false,
        isHiddenByMod: true,
        isRemoved: false,
      },
      shouldShowDelete: false,
    },
  ])(
    "$label skill aligns version Delete visibility with mutation availability",
    async ({ availability, moderationInfo, shouldShowDelete }) => {
      useAuthStatusMock.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        me: { _id: "users:1", role: "user" },
      });
      useQueryMock.mockImplementation((query: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        const name = getFunctionName(query as never);
        if (name === "skills:getBySlug") {
          return {
            skill: {
              _id: "skills:1",
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: "users:1",
              ownerPublisherId: "publishers:steipete",
              tags: {},
              stats: { stars: 0, downloads: 0 },
              ...availability,
            },
            owner: {
              _id: "publishers:steipete",
              _creationTime: 0,
              kind: "user",
              handle: "steipete",
              displayName: "Peter",
              linkedUserId: "users:1",
            },
            latestVersion: {
              _id: "skillVersions:latest",
              version: "2.0.0",
              parsed: {},
              files: [],
            },
            moderationInfo,
          };
        }
        if (
          name === "skills:listVersions" &&
          args &&
          typeof args === "object" &&
          "limit" in args &&
          args.limit === 50
        ) {
          return [
            {
              _id: "skillVersions:latest",
              version: "2.0.0",
              createdAt: 2,
              changelog: "Current skill release",
              parsed: {},
              files: [],
            },
            {
              _id: "skillVersions:older",
              version: "1.0.0",
              createdAt: 1,
              changelog: "Older skill release",
              parsed: {},
              files: [],
            },
          ];
        }
        if (name === "publishers:listMine") return [];
        return undefined;
      });

      render(<SkillDetailPage slug="weather" />);
      fireEvent.click(await screen.findByRole("tab", { name: "Versions" }));

      expect(screen.getByText("Latest")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Delete version 2.0.0" })).toBeNull();
      const deleteAction = screen.queryByRole("button", { name: "Delete version 1.0.0" });
      if (shouldShowDelete) {
        expect(deleteAction).toBeTruthy();
      } else {
        expect(deleteAction).toBeNull();
      }
    },
  );

  it("keeps version Delete hidden from staff-only skill viewers", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:moderator", role: "moderator" },
    });
    useQueryMock.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query as never);
      if (name === "skills:getBySlugForStaff") {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: {
            _id: "skillVersions:latest",
            version: "2.0.0",
            parsed: {},
            files: [],
          },
        };
      }
      if (
        name === "skills:listVersions" &&
        args &&
        typeof args === "object" &&
        "limit" in args &&
        args.limit === 50
      ) {
        return [
          {
            _id: "skillVersions:latest",
            version: "2.0.0",
            createdAt: 2,
            changelog: "Current skill release",
            parsed: {},
            files: [],
          },
          {
            _id: "skillVersions:older",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Older skill release",
            parsed: {},
            files: [],
          },
        ];
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);
    fireEvent.click(await screen.findByRole("tab", { name: "Versions" }));

    expect(screen.getByText("Latest")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete version/ })).toBeNull();
  });

  it("does not show the owner delete action to org skill creators without org admin access", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:creator", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:creator",
            ownerPublisherId: "publishers:org",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:org",
            _creationTime: 0,
            kind: "org",
            handle: "weather-org",
            displayName: "Weather Org",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    expect(screen.getByText("Rename slug")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete skill" })).toBeNull();
  });

  it("does not expose settings to publisher members without admin access", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:publisher-member", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args === undefined) {
        return [{ publisher: { _id: "publishers:steipete" }, role: "publisher" }];
      }
      if (args && typeof args === "object" && "skillId" in args) return false;
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "org",
            handle: "steipete",
            displayName: "Peter",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    const { unmount } = render(<SkillDetailPage slug="weather" />);
    expect(await screen.findByText("Weather")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
    unmount();

    render(<SkillDetailPage slug="weather" mode="settings" />);
    expect(await screen.findByRole("heading", { name: /Settings unavailable/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Update skill files/i })).toBeNull();
  });

  it("does not render version tag cards on the simplified public detail surface", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) {
        return [
          { _id: "skillVersions:1", version: "1.0.7", files: [] },
          { _id: "skillVersions:2", version: "1.0.8", files: [] },
        ];
      }
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:ip-publisher",
            slug: "ip-publisher",
            displayName: "IP Publisher",
            summary: "Publish knowledge-base content everywhere.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:veeicwgy",
            latestVersionId: "skillVersions:2",
            tags: {
              "ip-publisher": "skillVersions:2",
              "knowledge-base": "skillVersions:2",
              "content-rewrite": "skillVersions:1",
            },
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:veeicwgy",
            _creationTime: 0,
            kind: "user",
            handle: "veeicwgy",
            displayName: "Vee",
            linkedUserId: "users:1",
          },
          latestVersion: {
            _id: "skillVersions:2",
            version: "1.0.8",
            parsed: {},
            files: [],
          },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="ip-publisher" />);

    expect((await screen.findAllByText("IP Publisher")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Version tags")).toBeNull();
    expect(screen.queryByText("knowledge-base")).toBeNull();
    expect(screen.queryByText("content-rewrite")).toBeNull();
    expect(screen.queryByText("Historical tags")).toBeNull();
  });

  it("does not render historical tag controls for managers on the simplified detail surface", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "ownerUserId" in args) {
        return [{ _id: "skills:ip-publisher", slug: "ip-publisher", displayName: "IP Publisher" }];
      }
      if (args && typeof args === "object" && "skillId" in args) {
        return [
          { _id: "skillVersions:1", version: "1.0.7", files: [] },
          { _id: "skillVersions:2", version: "1.0.8", files: [] },
        ];
      }
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:ip-publisher",
            slug: "ip-publisher",
            displayName: "IP Publisher",
            summary: "Publish knowledge-base content everywhere.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:veeicwgy",
            latestVersionId: "skillVersions:2",
            tags: {
              "ip-publisher": "skillVersions:2",
              "knowledge-base": "skillVersions:2",
              "content-rewrite": "skillVersions:1",
            },
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:veeicwgy",
            _creationTime: 0,
            kind: "user",
            handle: "veeicwgy",
            displayName: "Vee",
            linkedUserId: "users:1",
          },
          latestVersion: {
            _id: "skillVersions:2",
            version: "1.0.8",
            parsed: {},
            files: [],
          },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="ip-publisher" />);

    expect((await screen.findAllByText("IP Publisher")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Version tags")).toBeNull();
    expect(screen.queryByText("Historical tags")).toBeNull();
    expect(screen.queryByText("content-rewrite")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete tag content-rewrite" })).toBeNull();
  });

  it("does not request compare versions for the simplified detail tabs", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "skillId" in args &&
        "limit" in args &&
        (args as { limit: number }).limit === 50
      ) {
        return [
          { _id: "skillVersions:1", version: "1.0.0", files: [] },
          { _id: "skillVersions:2", version: "1.1.0", files: [] },
        ];
      }
      if (args && typeof args === "object" && "skillId" in args && "limit" in args) {
        if ((args as { limit: number }).limit === 200) return [];
      }
      if (args && typeof args === "object" && "limit" in args) {
        return [];
      }
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "user",
            handle: "steipete",
            displayName: "Peter",
            linkedUserId: "users:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);
    expect(await screen.findByText("Weather")).toBeTruthy();
    expect(getDesktopSkillTabs().getByRole("tab", { name: "SKILL.md" })).toBeTruthy();
    expect(getDesktopSkillTabs().getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /diff/i })).toBeNull();

    expect(
      useQueryMock.mock.calls.some((call) => {
        const args = call[1];
        return (
          typeof args === "object" &&
          args !== null &&
          "limit" in args &&
          (args as { limit: number }).limit === 200
        );
      }),
    ).toBe(false);
  });
});
