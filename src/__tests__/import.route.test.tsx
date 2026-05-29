import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { ImportGitHub } from "../routes/import";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
  useNavigate: () => vi.fn(),
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

  it("keeps scanning later GitHub repo pages before showing candidates", async () => {
    listOwnedRepos
      .mockResolvedValueOnce({
        account: { login: "me", avatarUrl: null },
        page: 1,
        perPage: 100,
        hasMore: true,
        repos: [],
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

    expect(await screen.findByText("later-skill")).toBeTruthy();
    expect(listOwnedRepos).toHaveBeenNthCalledWith(1, { page: 1, perPage: 100 });
    expect(listOwnedRepos).toHaveBeenNthCalledWith(2, { page: 2, perPage: 100 });
    const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("preserves backend default file selection when publishing", async () => {
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
    fireEvent.click(screen.getByLabelText(/I have the rights/i));
    fireEvent.click(screen.getByRole("button", { name: /publish selected/i }));

    await waitFor(() => {
      expect(importSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedPaths: ["skill/SKILL.md"],
        }),
      );
    });
  });

  it("surfaces preview errors instead of staying in the loading state", async () => {
    previewCandidate.mockRejectedValueOnce(new Error("GitHub tree is too large"));

    render(<ImportGitHub />);
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: /review selected/i }));

    expect(await screen.findByText(/GitHub tree is too large/i)).toBeTruthy();
    expect(screen.queryByText(/Setting up your skills/i)).toBeNull();
  });
});
