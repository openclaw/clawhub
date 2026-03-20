import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { SkillDetailPage } from "../components/SkillDetailPage";

const navigateMock = vi.fn();
const useAuthStatusMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
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
    expect(screen.getByText(/Loading skill/i)).toBeTruthy();
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
              _id: ownerId,
              _creationTime: 0,
              handle: "steipete",
              name: "Peter",
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
    expect(await screen.findByRole("heading", { name: "Weather" })).toBeTruthy();
    expect(screen.getByText(/Get current weather\./i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
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
              _id: ownerId,
              _creationTime: 0,
              handle: "steipete",
              name: "Peter",
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
          tags: {},
          stats: { stars: 0, downloads: 0 },
        },
        owner: { handle: "steipete", name: "Peter" },
        latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {} },
      };
    });

    render(<SkillDetailPage slug="weather" redirectToCanonical />);
    expect(screen.getByText(/Loading skill/i)).toBeTruthy();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/$owner/$slug",
      params: { owner: "steipete", slug: "weather" },
      replace: true,
    });
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
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: { handle: "steipete", name: "Peter" },
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
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: { _id: "users:1", handle: "steipete", name: "Peter" },
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
            tags: {},
            stats: { stars: 0, downloads: 0 },
          },
          owner: { handle: "steipete", name: "Peter" },
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
