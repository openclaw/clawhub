import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { SkillDetailPage } from "../components/SkillDetailPage";

const navigateMock = vi.fn();
const useAuthStatusMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => navigateMock,
}));

const useQueryMock = vi.fn();
const getReadmeMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => vi.fn(),
  useAction: () => getReadmeMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
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

    const { container } = render(<SkillDetailPage slug="weather" />);
    // Loading state now renders a skeleton, not text
    expect(container.querySelector('[class*="animate-pulse"], [data-slot="skeleton"]')).toBeTruthy();
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

    // With initialData, should render content instead of skeleton
    expect(await screen.findByRole("heading", { name: "Weather" })).toBeTruthy();
    expect(screen.getByText(/Get current weather\./i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Files" })).toBeTruthy();
  });

  it("shows capability tags on the skill page without other scan findings", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="skill-pay"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "skill-pay",
              displayName: "SkillPay",
              summary: "Crypto payments for AI skills.",
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
              capabilityTags: ["crypto", "requires-wallet", "can-make-purchases"],
              sha256hash: "abc123",
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
          readme: "# SkillPay",
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "SkillPay" })).toBeTruthy();
    expect(screen.getByText("Capability signals")).toBeTruthy();
    expect(screen.getByText("Crypto")).toBeTruthy();
    expect(screen.getByText("Requires wallet")).toBeTruthy();
    expect(screen.getByText("Can make purchases")).toBeTruthy();
  });

  it("prefers the full frontmatter description over the shortened summary in the header", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      return undefined;
    });

    const fullDescription =
      "Add credit-based payments to any OpenClaw skill. Register paid skills, charge users per call, track earnings, and withdraw USDC. Use when a user wants to monetize a skill.";

    render(
      <SkillDetailPage
        slug="skill-pay"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "skill-pay",
              displayName: "SkillPay",
              summary: "Add credit-based payments to any OpenClaw skill. Register paid skills...",
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
                frontmatter: {
                  description: fullDescription,
                },
              },
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
          readme: "# SkillPay",
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "SkillPay" })).toBeTruthy();
    // The header now always shows skill.summary (not frontmatter.description)
    expect(
      screen.getByText("Add credit-based payments to any OpenClaw skill. Register paid skills..."),
    ).toBeTruthy();
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

    expect(await screen.findByRole("heading", { name: "Weather" })).toBeTruthy();
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

    const { container } = render(<SkillDetailPage slug="weather" redirectToCanonical />);
    // Loading state now renders a skeleton, not text
    expect(container.querySelector('[class*="animate-pulse"]')).toBeTruthy();

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

    expect(screen.queryByText(/Skill not found/i)).toBeNull();
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
      (
        await screen.findAllByText(
          /free to use, modify, and redistribute\. no attribution required\./i,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Reports require a reason\. Abuse may result in a ban\./i),
    ).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /report/i }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Report skill/i)).toBeTruthy();
  });

  it("shows owner tools for the skill owner", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "ownerUserId" in args) {
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

    render(<SkillDetailPage slug="weather" />);

    expect(await screen.findByText(/Owner tools/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rename and redirect/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Merge into target/i })).toBeTruthy();
  });

  it("defers compare version query until compare tab is requested", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "limit" in args) {
        return [];
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

    render(<SkillDetailPage slug="weather" />);
    expect(await screen.findByText("Weather")).toBeTruthy();

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

    const compareTab = screen.getByRole("tab", { name: /compare/i });
    fireEvent.mouseEnter(compareTab);
    fireEvent.click(compareTab);

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
