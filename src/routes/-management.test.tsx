/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Management } from "./management";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => ({}),
  }),
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: unknown;
  }) => <a href={to}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({
    me: {
      _id: "users:admin",
      handle: "admin",
      role: "admin",
    },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

describe("Management", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    navigateMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });
  });

  it("does not render the publisher abuse dry-run UI", () => {
    render(<Management />);

    expect(screen.getByRole("heading", { name: "Management console" })).toBeTruthy();
    expect(screen.queryByText("Publisher abuse dry run")).toBeNull();
  });
});
