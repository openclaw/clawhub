/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { Settings } from "./settings";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useAuthActionsMock = vi.fn();
const useAuthStatusMock = vi.fn();
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

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => navigateMock,
  useSearch: () => searchMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const signedInUser = {
  _id: "user_123",
  displayName: "Patrick",
  name: "Patrick",
  handle: "patrick",
  email: "patrick@example.com",
  image: null,
  bio: null,
};

const orgMembership = {
  publisher: {
    _id: "publisher_openclaw",
    handle: "openclaw",
    displayName: "OpenClaw Team",
    kind: "org",
    image: null,
    bio: "OpenClaw publisher",
  },
  role: "owner",
};

const orgMembers = {
  publisher: { _id: "publisher_openclaw", handle: "openclaw" },
  members: [
    {
      role: "owner",
      user: {
        _id: "user_123",
        handle: "patrick",
        displayName: "Patrick",
        image: null,
      },
    },
  ],
};

function mockSignedInSettings({
  search = {},
  memberships = [orgMembership],
  members = orgMembers,
}: {
  search?: Record<string, unknown>;
  memberships?: Array<typeof orgMembership>;
  members?: typeof orgMembers;
} = {}) {
  useAuthStatusMock.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    me: signedInUser,
  });
  searchMock.mockReturnValue(search);
  useQueryMock.mockImplementation((query, args) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(query);
    if (name === "tokens:listMine") return [];
    if (name === "publishers:listMine") return memberships;
    if (name === "publishers:listMembers") return members;
    return memberships;
  });
}

describe("Settings", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/settings");
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useAuthActionsMock.mockReset();
    useAuthStatusMock.mockReset();
    navigateMock.mockReset();
    searchMock.mockReset();
    searchMock.mockReturnValue({});
    useMutationMock.mockReturnValue(vi.fn());
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    useAuthActionsMock.mockReturnValue({
      signIn: vi.fn(),
    });
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: signedInUser,
    });
  });

  it("shows the settings skeleton until auth has resolved", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      me: undefined,
    });
    useQueryMock.mockImplementation(() => undefined);

    render(<Settings />);

    expect(screen.getByLabelText(/loading settings/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /sign in to access settings/i })).toBeNull();
    expect(useQueryMock.mock.calls.some(([, args]) => args === "skip")).toBe(true);
  });

  it("renders account and appearance inside signed-in account preferences", () => {
    mockSignedInSettings();

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

  it("does not load organization members on the default account view", () => {
    mockSignedInSettings();

    render(<Settings />);

    expect(useQueryMock).toHaveBeenCalledWith(api.publishers.listMembers, "skip");
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
  });

  it("navigates to a focused settings view from the section navigation", () => {
    mockSignedInSettings();

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "Organizations" }));

    expect(navigateMock).toHaveBeenCalledWith({ search: { view: "organizations" } });
  });

  it("renders organization management and loads members only on the organizations view", async () => {
    mockSignedInSettings({ search: { view: "organizations" } });

    render(<Settings />);

    expect(screen.getByRole("button", { name: "Organizations" }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(await screen.findByText("OpenClaw Team")).toBeTruthy();
    expect(screen.getByText("@openclaw · owner")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
    expect(screen.getByText("Patrick")).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(api.publishers.listMembers, {
      publisherHandle: "openclaw",
    });
  });

  it("shows create organization mutation errors to the user", async () => {
    const createOrg = vi
      .fn()
      .mockRejectedValue(
        new Error(
          '[CONVEX M(publishers:createOrg)] [Request ID: test] Server Error Called by client ConvexError: Handle "@romneyda" is already used by a user or personal publisher',
        ),
      );
    mockSignedInSettings({ search: { view: "organizations" }, memberships: [] });
    useMutationMock.mockReturnValue(createOrg);

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "Create org" }));
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "romneyda" } });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Dallin Romney @ OpenClaw" },
    });
    const createOrgButtons = screen.getAllByRole("button", { name: "Create org" });
    fireEvent.click(createOrgButtons[createOrgButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        'Handle "@romneyda" is already used by a user or personal publisher',
      );
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Handle "@romneyda" is already used by a user or personal publisher',
    );
  });

  it("migrates legacy hash settings URLs to focused query params", () => {
    window.history.replaceState(null, "", "/settings#tokens");
    mockSignedInSettings();

    render(<Settings />);

    expect(navigateMock).toHaveBeenCalledWith({ search: { view: "tokens" }, replace: true });
  });
});
