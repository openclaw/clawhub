/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { Settings } from "./settings";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useAuthActionsMock = vi.fn();
const { navigateMock, searchMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  searchMock: vi.fn(() => ({})),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => useAuthActionsMock(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => navigateMock,
  useSearch: () => searchMock(),
}));

describe("Settings", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useAuthActionsMock.mockReset();
    navigateMock.mockReset();
    searchMock.mockReset();
    searchMock.mockReturnValue({});
    useMutationMock.mockReturnValue(vi.fn());
    useAuthActionsMock.mockReturnValue({
      signIn: vi.fn(),
    });
  });

  it("skips token loading until auth has resolved", () => {
    useQueryMock.mockImplementation(() => undefined);

    render(<Settings />);

    expect(screen.getByRole("heading", { name: /sign in to access settings/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in with github/i })).toBeTruthy();
    expect(useQueryMock.mock.calls.some(([, args]) => args === "skip")).toBe(true);
  });

  it("renders account and appearance inside signed-in account preferences", () => {
    useQueryMock.mockImplementation((query, args) => {
      if (query === api.users.me) {
        return {
          _id: "user_123",
          displayName: "Patrick",
          name: "Patrick",
          handle: "patrick",
          email: "patrick@example.com",
          image: null,
          bio: null,
        };
      }
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "publisherHandle" in args) {
        return undefined;
      }
      return [];
    });

    render(<Settings />);

    expect(screen.getByRole("button", { name: "Account & Preferences" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Stars" })).toBeNull();
    expect(screen.getByRole("radio", { name: /system/i })).toBeTruthy();
    expect(screen.queryByText(/tweakcn overlay/i)).toBeNull();
    expect(screen.queryByText(/density/i)).toBeNull();
    expect(screen.queryByText(/default view/i)).toBeNull();
    expect(screen.queryByText(/code font size/i)).toBeNull();
    expect(screen.queryByText(/high contrast/i)).toBeNull();
    expect(screen.queryByText(/experimental features/i)).toBeNull();
  });
});
