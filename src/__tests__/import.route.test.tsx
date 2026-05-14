import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { ImportGitHub } from "../routes/import";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
  useNavigate: () => vi.fn(),
}));

const previewImport = vi.fn();
const previewCandidate = vi.fn();
const importSkill = vi.fn();
const useQueryMock = vi.fn();
const useAuthStatusMock = vi.fn();
let useActionCallCount = 0;

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => {
    const action = [previewImport, previewCandidate, importSkill][useActionCallCount % 3];
    useActionCallCount += 1;
    return action;
  },
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

describe("Import route", () => {
  beforeEach(() => {
    previewImport.mockReset();
    previewCandidate.mockReset();
    importSkill.mockReset();
    useQueryMock.mockReset();
    useAuthStatusMock.mockReset();
    useActionCallCount = 0;

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", handle: "me" },
    });

    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return null;
    });

    previewImport.mockResolvedValue({
      candidates: [
        {
          path: "skill",
          readmePath: "skill/SKILL.md",
          name: "Taken Skill",
          description: null,
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

  it("blocks import preflight when slug availability reports a collision", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "slug" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).slug === "taken-skill" &&
        "ownerHandle" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).ownerHandle === "me"
      ) {
        return {
          available: false,
          reason: "taken",
          message: "Slug is already taken. Choose a different slug.",
          url: "/alice/taken-skill",
        };
      }
      return null;
    });

    render(<ImportGitHub />);
    fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo"), {
      target: { value: "https://github.com/octo/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /detect/i }));

    await waitFor(() => {
      expect(previewImport).toHaveBeenCalled();
      expect(previewCandidate).toHaveBeenCalled();
    });

    expect(
      await screen.findByText(/Slug is already taken\. Choose a different slug\./i),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "/alice/taken-skill" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /import \+ publish/i }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("allows import when slug exists under a different owner", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "slug" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).slug === "taken-skill" &&
        "ownerHandle" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).ownerHandle === "me"
      ) {
        return {
          available: true,
          reason: "available",
          message: null,
          url: null,
        };
      }
      return null;
    });

    render(<ImportGitHub />);
    fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo"), {
      target: { value: "https://github.com/octo/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /detect/i }));

    await waitFor(() => {
      expect(previewImport).toHaveBeenCalled();
      expect(previewCandidate).toHaveBeenCalled();
    });

    expect(screen.queryByText(/Slug is already taken/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /import \+ publish/i }).getAttribute("disabled"),
    ).toBeNull();
  });

  it("blocks import when slug exists under the same owner", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "slug" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).slug === "taken-skill" &&
        "ownerHandle" in (args as Record<string, unknown>) &&
        (args as Record<string, unknown>).ownerHandle === "me"
      ) {
        return {
          available: false,
          reason: "taken",
          message:
            "Slug is already taken. Choose a different slug. Existing skill: /me/taken-skill",
          url: "/me/taken-skill",
        };
      }
      return null;
    });

    render(<ImportGitHub />);
    fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo"), {
      target: { value: "https://github.com/octo/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /detect/i }));

    await waitFor(() => {
      expect(previewImport).toHaveBeenCalled();
      expect(previewCandidate).toHaveBeenCalled();
    });

    expect(
      await screen.findByText(/Slug is already taken\. Choose a different slug\./i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /import \+ publish/i }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("skips slug availability query when owner handle is not resolved", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", handle: undefined },
    });

    render(<ImportGitHub />);
    fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo"), {
      target: { value: "https://github.com/octo/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /detect/i }));

    await waitFor(() => {
      expect(previewImport).toHaveBeenCalled();
      expect(previewCandidate).toHaveBeenCalled();
    });

    // The query should have been called with "skip" because ownerHandle is missing
    const slugCheckCalls = useQueryMock.mock.calls.filter(
      (call) => call[1] === "skip" || (call[1] && typeof call[1] === "object" && "slug" in call[1]),
    );
    expect(slugCheckCalls.length).toBeGreaterThanOrEqual(1);
    expect(slugCheckCalls[0]?.[1]).toBe("skip");
  });
});
