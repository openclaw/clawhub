import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { ImportGitHub } from "../routes/import";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({ ownerHandle: undefined }),
}));

const previewCandidate = vi.fn();
const importSkill = vi.fn();
const listOwnedRepos = vi.fn();
const useQueriesMock = vi.fn();
const useAuthStatusMock = vi.fn();
let useActionCallCount = 0;

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQueries: (...args: unknown[]) => useQueriesMock(...args),
  useAction: () => {
    const action = [listOwnedRepos, previewCandidate, importSkill][useActionCallCount % 3];
    useActionCallCount += 1;
    return action;
  },
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

describe("Import route", () => {
  beforeEach(() => {
    listOwnedRepos.mockReset();
    previewCandidate.mockReset();
    importSkill.mockReset();
    useQueriesMock.mockReset();
    useAuthStatusMock.mockReset();
    useActionCallCount = 0;

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", handle: "me" },
    });

    useQueriesMock.mockReturnValue({});

    listOwnedRepos.mockResolvedValue({
      account: { login: "me", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
      page: 1,
      perPage: 50,
      hasMore: false,
      repos: [
        {
          owner: "octo",
          name: "repo",
          repoName: "repo",
          repoFullName: "octo/repo",
          fullName: "octo/repo",
          htmlUrl: "https://github.com/octo/repo",
          candidatePath: "skill",
          skillPath: "skill/SKILL.md",
          pushedAt: "2026-05-27T00:00:00Z",
          updatedAt: "2026-05-27T00:00:00Z",
          language: "TypeScript",
          fork: false,
          archived: false,
          disabled: false,
          importable: true,
          unavailableReason: null,
        },
      ],
    });

    previewCandidate.mockResolvedValue({
      resolved: {
        owner: "octo",
        repo: "repo",
        ref: "main",
        commit: "abcdef1234567890",
        path: "skill",
        repoUrl: "https://github.com/octo/repo",
        originalUrl: "https://github.com/octo/repo",
      },
      candidate: {
        path: "skill",
        readmePath: "skill/SKILL.md",
        name: "Taken Skill",
        description: null,
      },
      defaults: {
        selectedPaths: ["skill/SKILL.md"],
        slug: "taken-skill",
        displayName: "Taken Skill",
        version: "1.0.0",
        tags: ["latest"],
      },
      files: [
        {
          path: "skill/SKILL.md",
          size: 120,
          defaultSelected: true,
        },
      ],
    });
  });

  it("keeps the signed-out prompt hidden while auth is resolving", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      me: undefined,
    });

    render(<ImportGitHub />);

    expect(screen.getByLabelText(/loading github import/i)).toBeTruthy();
    expect(screen.queryByText(/sign in to import/i)).toBeNull();
  });

  it("auto-appends a slug suffix when the default slug is unavailable", async () => {
    useQueriesMock.mockImplementation((queries: Record<string, { args: { slug: string } }>) => {
      return Object.fromEntries(
        Object.entries(queries).map(([key, query]) => [
          key,
          query.args.slug === "taken-skill"
            ? {
                available: false,
                reason: "taken",
                message: "Slug is already taken. Choose a different slug.",
                url: "/alice/taken-skill",
              }
            : {
                available: true,
                reason: "available",
                message: null,
                url: null,
              },
        ]),
      );
    });

    render(<ImportGitHub />);
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: /review selected/i }));

    await waitFor(() => {
      expect(previewCandidate).toHaveBeenCalledWith({
        url: "https://github.com/octo/repo",
        candidatePath: "skill",
      });
    });

    await waitFor(() => {
      expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("taken-skill-2");
    });
  });

  it("preserves natural numeric slug endings when de-duping review drafts", async () => {
    listOwnedRepos.mockResolvedValueOnce({
      account: { login: "me", avatarUrl: null },
      page: 1,
      perPage: 100,
      hasMore: false,
      repos: [
        {
          owner: "octo",
          name: "gpt-4-a",
          repoName: "gpt-4-a",
          repoFullName: "octo/gpt-4-a",
          fullName: "octo/gpt-4-a",
          htmlUrl: "https://github.com/octo/gpt-4-a",
          candidatePath: "",
          skillPath: "SKILL.md",
          pushedAt: null,
          updatedAt: null,
          language: null,
          fork: false,
          archived: false,
          disabled: false,
          importable: true,
          unavailableReason: null,
        },
        {
          owner: "octo",
          name: "gpt-4-b",
          repoName: "gpt-4-b",
          repoFullName: "octo/gpt-4-b",
          fullName: "octo/gpt-4-b",
          htmlUrl: "https://github.com/octo/gpt-4-b",
          candidatePath: "",
          skillPath: "SKILL.md",
          pushedAt: null,
          updatedAt: null,
          language: null,
          fork: false,
          archived: false,
          disabled: false,
          importable: true,
          unavailableReason: null,
        },
      ],
    });
    previewCandidate.mockResolvedValue({
      resolved: {
        owner: "octo",
        repo: "gpt-4",
        ref: "main",
        commit: "abcdef1234567890",
        path: "",
        repoUrl: "https://github.com/octo/gpt-4",
        originalUrl: "https://github.com/octo/gpt-4",
      },
      candidate: {
        path: "",
        readmePath: "SKILL.md",
        name: "GPT-4",
        description: null,
      },
      defaults: {
        selectedPaths: ["SKILL.md"],
        slug: "gpt-4",
        displayName: "GPT-4",
        version: "1.0.0",
        tags: ["latest"],
      },
      files: [{ path: "SKILL.md", size: 120, defaultSelected: true }],
    });

    render(<ImportGitHub />);
    await waitFor(() => {
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: /review selected/i }));

    await waitFor(() => {
      const values = screen
        .getAllByLabelText("Slug")
        .map((input) => (input as HTMLInputElement).value);
      expect(values).toEqual(["gpt-4", "gpt-4-2"]);
    });
  });

  it("uses collision-free query keys for similar repo names", async () => {
    const queryKeySets: string[][] = [];
    listOwnedRepos.mockResolvedValueOnce({
      account: { login: "me", avatarUrl: null },
      page: 1,
      perPage: 100,
      hasMore: false,
      repos: [
        {
          owner: "octo",
          name: "foo-bar",
          repoName: "foo-bar",
          repoFullName: "octo/foo-bar",
          fullName: "octo/foo-bar",
          htmlUrl: "https://github.com/octo/foo-bar",
          candidatePath: "",
          skillPath: "SKILL.md",
          pushedAt: null,
          updatedAt: null,
          language: null,
          fork: false,
          archived: false,
          disabled: false,
          importable: true,
          unavailableReason: null,
        },
        {
          owner: "octo",
          name: "foo_bar",
          repoName: "foo_bar",
          repoFullName: "octo/foo_bar",
          fullName: "octo/foo_bar",
          htmlUrl: "https://github.com/octo/foo_bar",
          candidatePath: "",
          skillPath: "SKILL.md",
          pushedAt: null,
          updatedAt: null,
          language: null,
          fork: false,
          archived: false,
          disabled: false,
          importable: true,
          unavailableReason: null,
        },
      ],
    });
    previewCandidate.mockImplementation((args: { url: string }) =>
      Promise.resolve({
        resolved: {
          owner: "octo",
          repo: args.url.split("/").at(-1) ?? "repo",
          ref: "main",
          commit: "abcdef1234567890",
          path: "",
          repoUrl: args.url,
          originalUrl: args.url,
        },
        candidate: {
          path: "",
          readmePath: "SKILL.md",
          name: args.url.split("/").at(-1) ?? "Repo",
          description: null,
        },
        defaults: {
          selectedPaths: ["SKILL.md"],
          slug: args.url.includes("foo_bar") ? "foo-bar-two" : "foo-bar-one",
          displayName: args.url.split("/").at(-1) ?? "Repo",
          version: "1.0.0",
          tags: ["latest"],
        },
        files: [{ path: "SKILL.md", size: 120, defaultSelected: true }],
      }),
    );
    useQueriesMock.mockImplementation((queries: Record<string, { args: { slug: string } }>) => {
      queryKeySets.push(Object.keys(queries));
      return Object.fromEntries(
        Object.entries(queries).map(([key]) => [
          key,
          { available: true, reason: "available", message: null, url: null },
        ]),
      );
    });

    render(<ImportGitHub />);
    await waitFor(() => {
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: /review selected/i }));

    await waitFor(() => {
      const keys = queryKeySets.find((set) => set.length === 2);
      expect(keys).toBeTruthy();
      expect(new Set(keys).size).toBe(2);
    });
  });

  it("can load more GitHub discovery pages", async () => {
    listOwnedRepos
      .mockResolvedValueOnce({
        account: { login: "me", avatarUrl: null },
        page: 1,
        perPage: 100,
        hasMore: true,
        repos: [
          {
            owner: "octo",
            name: "bounded-skill",
            repoName: "bounded-skill",
            repoFullName: "octo/bounded-skill",
            fullName: "octo/bounded-skill",
            htmlUrl: "https://github.com/octo/bounded-skill",
            candidatePath: "",
            skillPath: "SKILL.md",
            pushedAt: null,
            updatedAt: null,
            language: null,
            fork: false,
            archived: false,
            disabled: false,
            importable: true,
            unavailableReason: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        account: { login: "me", avatarUrl: null },
        page: 2,
        perPage: 100,
        hasMore: false,
        repos: [
          {
            owner: "octo",
            name: "later-skill",
            repoName: "later-skill",
            repoFullName: "octo/later-skill",
            fullName: "octo/later-skill",
            htmlUrl: "https://github.com/octo/later-skill",
            candidatePath: "",
            skillPath: "SKILL.md",
            pushedAt: null,
            updatedAt: null,
            language: null,
            fork: false,
            archived: false,
            disabled: false,
            importable: true,
            unavailableReason: null,
          },
        ],
      });

    render(<ImportGitHub />);

    expect(await screen.findByText("bounded-skill")).toBeTruthy();
    expect(listOwnedRepos).toHaveBeenNthCalledWith(1, {
      page: 1,
      perPage: 100,
      query: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(await screen.findByText("later-skill")).toBeTruthy();
    expect(listOwnedRepos).toHaveBeenNthCalledWith(2, {
      page: 2,
      perPage: 100,
      query: undefined,
    });
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
  });

  it("passes search text to GitHub discovery", async () => {
    listOwnedRepos
      .mockResolvedValueOnce({
        account: { login: "me", avatarUrl: null },
        page: 1,
        perPage: 100,
        hasMore: true,
        repos: [
          {
            owner: "octo",
            name: "first-skill",
            repoName: "first-skill",
            repoFullName: "octo/first-skill",
            fullName: "octo/first-skill",
            htmlUrl: "https://github.com/octo/first-skill",
            candidatePath: "",
            skillPath: "SKILL.md",
            pushedAt: null,
            updatedAt: null,
            language: null,
            fork: false,
            archived: false,
            disabled: false,
            importable: true,
            unavailableReason: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        account: { login: "me", avatarUrl: null },
        page: 1,
        perPage: 100,
        hasMore: false,
        repos: [
          {
            owner: "octo",
            name: "later-skill",
            repoName: "later-skill",
            repoFullName: "octo/later-skill",
            fullName: "octo/later-skill",
            htmlUrl: "https://github.com/octo/later-skill",
            candidatePath: "",
            skillPath: "SKILL.md",
            pushedAt: null,
            updatedAt: null,
            language: null,
            fork: false,
            archived: false,
            disabled: false,
            importable: true,
            unavailableReason: null,
          },
        ],
      });

    render(<ImportGitHub />);

    expect(await screen.findByText("first-skill")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "later" } });

    await waitFor(() => {
      expect(listOwnedRepos).toHaveBeenNthCalledWith(2, {
        page: 1,
        perPage: 100,
        query: "later",
      });
    });
    expect(await screen.findByText("later-skill")).toBeTruthy();
  });

  it("preserves backend default file selection and omits blank catalog metadata", async () => {
    useQueriesMock.mockImplementation((queries: Record<string, { args: { slug: string } }>) => {
      return Object.fromEntries(
        Object.entries(queries).map(([key]) => [
          key,
          { available: true, reason: "available", message: null, url: null },
        ]),
      );
    });
    previewCandidate.mockResolvedValueOnce({
      resolved: {
        owner: "octo",
        repo: "repo",
        ref: "main",
        commit: "abcdef1234567890",
        path: "skill",
        repoUrl: "https://github.com/octo/repo",
        originalUrl: "https://github.com/octo/repo",
      },
      candidate: {
        path: "skill",
        readmePath: "skill/SKILL.md",
        name: "Default Skill",
        description: null,
      },
      defaults: {
        selectedPaths: ["skill/SKILL.md"],
        slug: "default-skill",
        displayName: "Default Skill",
        version: "1.0.0",
        tags: ["latest"],
      },
      files: [
        { path: "skill/SKILL.md", size: 120, defaultSelected: true },
        { path: "skill/extra.md", size: 80, defaultSelected: false },
      ],
    });
    importSkill.mockResolvedValue({ slug: "default-skill" });

    render(<ImportGitHub />);
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: /review selected/i }));
    await screen.findByDisplayValue("default-skill");
    expect(screen.queryByLabelText("Choose icon")).toBeNull();
    fireEvent.click(screen.getByLabelText(/I have the rights/i));
    fireEvent.click(screen.getByRole("button", { name: /publish selected/i }));

    await waitFor(() => {
      expect(importSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedPaths: ["skill/SKILL.md"],
        }),
      );
    });
    const args = importSkill.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(Object.hasOwn(args, "categories")).toBe(false);
    expect(Object.hasOwn(args, "topics")).toBe(false);
    expect(Object.hasOwn(args, "icon")).toBe(false);
  });

  it("surfaces preview errors instead of staying in the loading state", async () => {
    previewCandidate.mockRejectedValueOnce(new Error("GitHub tree is too large"));

    render(<ImportGitHub />);
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: /review selected/i }));

    expect(await screen.findByText(/GitHub tree is too large/i)).toBeTruthy();
    expect(screen.queryByText(/Setting up your skills/i)).toBeNull();
  });

  it("checks and publishes imported skills in the authenticated user's owner namespace", async () => {
    importSkill.mockResolvedValueOnce({ slug: "taken-skill" });
    useQueriesMock.mockImplementation(
      (queries: Record<string, { args: { slug: string; ownerHandle: string } }>) => {
        return Object.fromEntries(
          Object.entries(queries).map(([key, query]) => [
            key,
            query.args.slug === "taken-skill" && query.args.ownerHandle === "me"
              ? {
                  available: true,
                  reason: "available",
                  message: null,
                  url: null,
                }
              : null,
          ]),
        );
      },
    );

    render(<ImportGitHub />);
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: /review selected/i }));

    await screen.findByDisplayValue("taken-skill");
    await waitFor(() => {
      const scopedCall = useQueriesMock.mock.calls.find(([queries]) =>
        Object.values(
          queries as Record<string, { args: { slug: string; ownerHandle: string } }>,
        ).some((query) => query.args.slug === "taken-skill" && query.args.ownerHandle === "me"),
      );
      expect(scopedCall).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/I have the rights/i));
    fireEvent.click(screen.getByRole("button", { name: /publish selected/i }));

    await waitFor(() => {
      expect(importSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: "taken-skill",
          ownerHandle: "me",
        }),
      );
    });
  });
});
