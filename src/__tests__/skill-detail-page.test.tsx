import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { SkillDetailPage } from "../components/SkillDetailPage";

const navigateMock = vi.fn();
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
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => navigateMock,
}));

const useQueryMock = vi.fn();
const getReadmeMock = vi.fn();

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => vi.fn(),
  useAction: () => getReadmeMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("../components/SkillCommentsPanel", () => ({
  SkillCommentsPanel: () => <div data-testid="skill-comments-panel" />,
}));

describe("SkillDetailPage", () => {
  const skillId = "skills:1" as Id<"skills">;
  const ownerId = "users:1" as Id<"users">;
  const ownerPublisherId = "publishers:steipete" as Id<"publishers">;
  const versionId = "skillVersions:1" as Id<"skillVersions">;
  const storageId = "storage:1" as Id<"_storage">;

  beforeEach(() => {
    useQueryMock.mockReset();
    getReadmeMock.mockReset();
    navigateMock.mockReset();
    useAuthStatusMock.mockReset();
    getReadmeMock.mockResolvedValue({ text: "" });
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });
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
    expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
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
    const securityHeading = screen.getByRole("heading", { name: "Security Scans" });

    expect(screen.getAllByRole("heading", { name: "Install" }).length).toBeGreaterThan(0);
    expect(screen.getByText("openclaw skills install weather")).toBeTruthy();
    expect(screen.queryByText("npx clawhub@latest install weather")).toBeNull();
    expect(screen.queryByRole("tab", { name: "ClawHub" })).toBeNull();
    expect(screen.getByRole("tab", { name: "CLI" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Prompt" })).toBeTruthy();
    expect(screen.queryByText(/After install, inspect the skill metadata/i)).toBeNull();
    expect(securityHeading).toBeTruthy();
    expect(screen.getByRole("link", { name: /VirusTotal.*Pending/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /ClawScan.*Pending/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Static analysis.*Pending/i })).toBeTruthy();
    expect(screen.queryByText(/Like a lobster shell, security has layers/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();

    const installHeading = screen.getAllByRole("heading", { name: "Install" })[0];
    const filesTab = screen.getByRole("button", { name: "Files" });
    expect(
      installHeading.compareDocumentPosition(filesTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      securityHeading.compareDocumentPosition(filesTab) & Node.DOCUMENT_POSITION_FOLLOWING,
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

    await screen.findByRole("heading", { name: "Security Scans" });
    expect(screen.getByText(/reviewed by staff and cleared/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /VirusTotal.*Cleared/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /ClawScan.*Cleared/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Static analysis.*Cleared/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Suspicious/i })).toBeNull();
  });

  it("shows an owner rescan action in the security summary for owned skills", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: ownerId, role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args && !("limit" in args)) {
        return {
          maxRequests: 3,
          requestCount: 1,
          remainingRequests: 2,
          canRequest: true,
          inProgressRequest: null,
          latestRequest: null,
        };
      }
      if (args && typeof args === "object" && "limit" in args) return [];
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

    expect(await screen.findByRole("button", { name: "Rescan" })).toBeTruthy();
    expect(screen.queryByText("Owner rescan")).toBeNull();
    expect(screen.queryByText("2/3 rescans left")).toBeNull();
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
    expect(await screen.findByText(/Skill not found/i)).toBeTruthy();
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
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("opens report dialog for authenticated users", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
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

    expect(await screen.findByText(/Owner tools/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rename and redirect/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Merge into target/i })).toBeTruthy();
  });

  it("shows only latest-version tags in public tag surfaces", async () => {
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

    expect((await screen.findAllByText("ip-publisher")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("knowledge-base").length).toBeGreaterThan(0);
    expect(screen.queryByText("content-rewrite")).toBeNull();
    expect(screen.queryByText("Historical tags")).toBeNull();
  });

  it("separates historical tags for managers", async () => {
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

    expect(await screen.findByText("Historical tags")).toBeTruthy();
    expect(screen.getByText("content-rewrite")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete tag content-rewrite" })).toBeTruthy();
  });

  it("defers compare version query until compare tab is requested", async () => {
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
    expect(screen.getByRole("button", { name: /compare/i })).toBeTruthy();

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

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    await waitFor(() => {
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
      ).toBe(true);
    });
  });
});
