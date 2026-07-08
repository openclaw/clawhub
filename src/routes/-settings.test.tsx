/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Settings } from "./settings";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useActionMock = vi.fn();
const useAuthActionsMock = vi.fn();
const useAuthStatusMock = vi.fn();
const { navigateMock, searchMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  searchMock: vi.fn(() => ({})),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
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
    official: true,
  },
  role: "owner",
};

const personalMembership = {
  publisher: {
    _id: "publisher_patrick",
    handle: "patrick",
    displayName: "Patrick",
    kind: "user",
    image: null,
    bio: null,
    official: false,
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
        handle: "patrick" as string | null,
        personalPublisherHandle: "patrick" as string | null,
        displayName: "Patrick",
        image: null,
      },
    },
  ],
};

type PublisherInviteFixture = FunctionReturnType<typeof api.publishers.listMyInvites>[number];

function makePublisherInviteFixture(
  overrides: Partial<PublisherInviteFixture> = {},
): PublisherInviteFixture {
  const createdAt = Date.now();
  return {
    _id: "publisherInvites:invite-1" as Id<"publisherInvites">,
    publisher: {
      _id: "publisher_openclaw" as Id<"publishers">,
      handle: "openclaw",
      displayName: "OpenClaw Team",
      image: null,
    },
    targetHandle: "dallin",
    targetUser: null,
    role: "publisher",
    status: "pending",
    createdAt,
    expiresAt: createdAt + 60 * 60 * 1000,
    inviter: {
      _id: "user_123" as Id<"users">,
      handle: "patrick",
      displayName: "Patrick",
      image: null,
    },
    ...overrides,
  };
}

function mockSignedInSettings({
  search = {},
  memberships = [orgMembership],
  members = orgMembers,
  githubSources = [],
  pendingInvites = [],
  myInvites = [],
  membersLoading = false,
}: {
  search?: Record<string, unknown>;
  memberships?: Array<typeof orgMembership | typeof personalMembership>;
  members?: typeof orgMembers;
  membersLoading?: boolean;
  pendingInvites?: PublisherInviteFixture[];
  myInvites?: PublisherInviteFixture[];
  githubSources?: Array<{
    _id: string;
    repo: string;
    ownerPublisher?: {
      _id: string;
      handle: string;
      displayName: string;
    } | null;
    defaultBranch?: string;
    lastSyncStatus?: "ok" | "failed" | "skipped";
    lastSyncError?: string;
    lastSyncErrorAt?: number;
    displayManifestStatus?: "ok" | "missing" | "invalid" | "failed";
    displayManifestFetchedAt?: number;
    displayManifestCommit?: string;
    lastSyncIssues?: Array<{
      slug: string;
      path: string;
      displayName: string;
      kind: "invalid_slug" | "slug_conflict";
      severity: "error" | "warning";
      message: string;
      existingOwnerHandle?: string;
    }>;
    lastSyncInvalidSkills?: Array<{
      slug: string;
      path: string;
      displayName: string;
      error: string;
    }>;
    skills: Array<{
      _id: string;
      slug: string;
      displayName: string;
      githubPath?: string;
      githubCurrentStatus?: "present" | "missing" | "unknown";
    }>;
    updatedAt: number;
  }>;
} = {}) {
  useAuthStatusMock.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    me: signedInUser,
  });
  searchMock.mockReturnValue(search);
  useQueryMock.mockImplementation((query, args) => {
    const queryName = query ? getFunctionName(query) : "";
    if (queryName === "users:me") return signedInUser;
    if (args === "skip") return undefined;
    if (queryName === "tokens:listMine") return [];
    if (queryName === "publishers:listMine") return memberships;
    if (queryName === "publishers:listMembers" && membersLoading) return undefined;
    if (queryName === "publishers:listMembers") return members;
    if (queryName === "publishers:listInvitesForPublisher") return pendingInvites;
    if (queryName === "publishers:listMyInvites") return myInvites;
    if (queryName === "githubSkillSources:listForManageableOfficialPublishers")
      return githubSources;
    if (args && typeof args === "object" && "publisherHandle" in args) return members;
    if (args && typeof args === "object") return [];
    return memberships;
  });
}

function getLastQueryArgs(functionName: string) {
  for (let index = useQueryMock.mock.calls.length - 1; index >= 0; index -= 1) {
    const call = useQueryMock.mock.calls[index];
    if (getFunctionName(call[0]) === functionName) return call[1];
  }
  return undefined;
}

describe("Settings", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/settings");
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useActionMock.mockReset();
    useAuthActionsMock.mockReset();
    useAuthStatusMock.mockReset();
    navigateMock.mockReset();
    searchMock.mockReset();
    searchMock.mockReturnValue({});
    useMutationMock.mockReturnValue(vi.fn());
    useActionMock.mockReturnValue(vi.fn());
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    useAuthActionsMock.mockReturnValue({
      signIn: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
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

  it("lets organization owners confirm org deletion", async () => {
    const deleteOrg = vi.fn().mockResolvedValue({ deleted: true });
    useMutationMock.mockReturnValue(deleteOrg);
    mockSignedInSettings({ search: { view: "organizations" } });

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "Delete organization" }));

    expect(await screen.findByText(/Permanently delete @openclaw/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete organization" }));

    await waitFor(() =>
      expect(deleteOrg).toHaveBeenCalledWith({ publisherId: "publisher_openclaw" }),
    );
  });

  it("stops account-scoped queries before deleting the signed-in account", async () => {
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "users:deleteAccount" ? deleteAccount : vi.fn(),
    );
    mockSignedInSettings({
      search: { view: "danger" },
      memberships: [personalMembership],
    });

    render(<Settings />);

    expect(getLastQueryArgs("tokens:listMine")).toEqual({});
    expect(getLastQueryArgs("publishers:listMine")).toEqual({});
    useQueryMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Permanently delete account" }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalled());
    await waitFor(() => {
      expect(getLastQueryArgs("tokens:listMine")).toBe("skip");
      expect(getLastQueryArgs("publishers:listMine")).toBe("skip");
    });
  });

  it("clears auth state and leaves settings after account deletion succeeds", async () => {
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn().mockResolvedValue(undefined);
    useAuthActionsMock.mockReturnValue({ signIn: vi.fn(), signOut });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "users:deleteAccount" ? deleteAccount : vi.fn(),
    );
    mockSignedInSettings({
      search: { view: "danger" },
      memberships: [personalMembership],
    });

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Permanently delete account" }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalled());
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("lets official publisher owners configure a public GitHub sync source", async () => {
    const configureSource = vi.fn().mockResolvedValue({ ok: true, stats: { discovered: 1 } });
    useActionMock.mockReturnValue(configureSource);
    mockSignedInSettings({
      search: { view: "githubSources" },
      memberships: [personalMembership, orgMembership],
    });

    render(<Settings />);

    expect(
      screen.getByRole("button", { name: "GitHub Skill Sync" }).getAttribute("aria-current"),
    ).toBe("true");
    expect(screen.getByRole("heading", { name: "Sync GitHub skills repo" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Synced repositories" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No synced repositories" })).toBeTruthy();
    expect(screen.getByLabelText("Publisher")).toBeTruthy();
    expect(screen.getByPlaceholderText("https://github.com/owner/repo")).toBeTruthy();
    expect(screen.queryByText(/Publishing as/i)).toBeNull();
    expect(screen.queryByText(/skills\.sh\.json/i)).toBeNull();

    fireEvent.change(screen.getByLabelText("GitHub repo URL"), {
      target: { value: "https://github.com/NVIDIA/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add repo/i }));

    await waitFor(() => {
      expect(configureSource).toHaveBeenCalledWith({
        ownerPublisherId: "publisher_openclaw",
        repo: "NVIDIA/skills",
      });
    });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/GitHub source synced/i));
  });

  it("shows synced repos as separate cards and lets owners delete a source", async () => {
    const deleteSource = vi.fn().mockResolvedValue({ ok: true, deletedSkills: 0 });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "githubSkillSources:deleteForPublisher"
        ? deleteSource
        : vi.fn(),
    );
    mockSignedInSettings({
      search: { view: "githubSources" },
      memberships: [orgMembership],
      githubSources: [
        {
          _id: "githubSkillSources:matt",
          repo: "mattpocock/skills",
          ownerPublisher: {
            _id: "publisher_openclaw",
            handle: "openclaw",
            displayName: "OpenClaw Team",
          },
          defaultBranch: "main",
          lastSyncStatus: "ok",
          displayManifestStatus: "ok",
          displayManifestFetchedAt: Date.now() - 4 * 60 * 1000,
          displayManifestCommit: "aaf2453",
          lastSyncIssues: [
            {
              slug: "too-long-skill-slug",
              path: "skills/too-long-skill-slug",
              displayName: "Too Long Skill Slug",
              kind: "invalid_slug",
              severity: "error",
              message: "Slug must be at most 96 characters.",
            },
            {
              slug: "rag-eval",
              path: "skills/rag-eval",
              displayName: "RAG Eval",
              kind: "slug_conflict",
              severity: "error",
              message: "Slug already exists on ClawHub under @jonathanjing.",
              existingOwnerHandle: "jonathanjing",
            },
          ],
          skills: [
            {
              _id: "skills:agent-browser",
              slug: "agent-browser",
              displayName: "Agent Browser",
              githubPath: "skills/agent-browser",
              githubCurrentStatus: "present",
            },
          ],
          updatedAt: new Date("2026-06-04T19:01:00Z").getTime(),
        },
      ],
    });

    render(<Settings />);

    expect(screen.getByRole("heading", { name: "Synced repositories" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "mattpocock/skills" })).toBeTruthy();
    expect(
      screen.getByText(
        "Add a public repo URL. ClawHub syncs metadata and scan results every 15 minutes. Users install your skills directly from your GitHub repo.",
      ),
    ).toBeTruthy();
    const repoLink = screen.getByRole("link", { name: "https://github.com/mattpocock/skills" });
    expect(repoLink.getAttribute("href")).toBe("https://github.com/mattpocock/skills");
    expect(screen.queryByText(/Updated 06\/04\/2026/i)).toBeNull();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.queryByText("Last checked")).toBeNull();
    expect(screen.getByText("Last synced")).toBeTruthy();
    expect(screen.getByText("Current commit")).toBeTruthy();
    expect(screen.getAllByText("aaf2453").length).toBeGreaterThan(0);
    expect(screen.getByText("Synced skills")).toBeTruthy();
    expect(screen.getByText("Agent Browser")).toBeTruthy();
    expect(screen.getByText("skills/agent-browser")).toBeTruthy();
    expect(screen.getByText("Sync issues")).toBeTruthy();
    expect(screen.getByText("Too Long Skill Slug")).toBeTruthy();
    expect(screen.getByText("skills/too-long-skill-slug")).toBeTruthy();
    expect(screen.getByText("Slug must be at most 96 characters.")).toBeTruthy();
    expect(screen.getByText("RAG Eval")).toBeTruthy();
    expect(screen.getByText("skills/rag-eval")).toBeTruthy();
    expect(screen.getByText("Slug conflict")).toBeTruthy();
    expect(screen.getByText("Slug already exists on ClawHub under @jonathanjing.")).toBeTruthy();
    expect(screen.queryByText("Ungrouped")).toBeNull();
    expect(screen.queryByRole("heading", { name: "No synced repositories" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Delete synced repo & skills" })).toBeTruthy();
    expect(screen.getByText(/This will delete the sync job for this repo/i)).toBeTruthy();
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton.className).toMatch(/border-red/);

    fireEvent.click(deleteButton);

    expect(deleteSource).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete mattpocock/skills" })).toBeTruthy();
    expect(screen.getByText("Skills to delete")).toBeTruthy();
    expect(screen.getAllByText("Agent Browser").length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete synced repo & skills" }));

    await waitFor(() => {
      expect(deleteSource).toHaveBeenCalledWith({
        ownerPublisherId: "publisher_openclaw",
        sourceId: "githubSkillSources:matt",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("GitHub sync deleted (0 skills deleted)");
  });

  it("does not let non-official publishers access GitHub sync sources", () => {
    mockSignedInSettings({
      search: { view: "githubSources" },
      memberships: [personalMembership],
    });

    render(<Settings />);

    expect(screen.queryByRole("button", { name: "GitHub Skill Sync" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Account & Preferences" }).getAttribute("aria-current"),
    ).toBe("true");
    expect(screen.queryByRole("heading", { name: "GitHub Skill Sync" })).toBeNull();
    expect(screen.queryByPlaceholderText("Enter a public repo")).toBeNull();
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
    expect(screen.getAllByText("Create an organization for your team").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("@openclaw")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "romneyda" } });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Dallin Romney @ OpenClaw" },
    });
    const createOrgButtons = screen.getAllByRole("button", { name: "Create" });
    expect(createOrgButtons[createOrgButtons.length - 1]?.querySelector("svg")).toBeNull();
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

  it("creates a member invite from the Members block invite dialog", async () => {
    const createInvite = vi.fn().mockResolvedValue({ ok: true, inviteId: "publisherInvites:1" });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publishers:createMemberInvite" ? createInvite : vi.fn(),
    );
    mockSignedInSettings({ search: { view: "organizations" } });

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: /Invite member/i }));
    fireEvent.change(await screen.findByLabelText("User handle"), {
      target: { value: "dallin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send invite/i }));

    await waitFor(() => {
      expect(createInvite).toHaveBeenCalledWith({
        publisherId: "publisher_openclaw",
        userHandle: "dallin",
        role: "publisher",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("Invitation sent to @dallin");
  });

  it("does not render member invite controls while existing members are loading", () => {
    const createInvite = vi.fn().mockResolvedValue({ ok: true, inviteId: "publisherInvites:1" });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publishers:createMemberInvite" ? createInvite : vi.fn(),
    );
    mockSignedInSettings({ search: { view: "organizations" }, membersLoading: true });

    render(<Settings />);

    expect(screen.getByLabelText("Loading settings")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Invite member/i })).toBeNull();
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("updates an existing member role from the Members block dialog", async () => {
    const createInvite = vi.fn();
    const addMember = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) => {
      const name = getFunctionName(mutation);
      if (name === "publishers:createMemberInvite") return createInvite;
      if (name === "publishers:addMember") return addMember;
      return vi.fn();
    });
    mockSignedInSettings({ search: { view: "organizations" } });

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: /Invite member/i }));
    fireEvent.change(await screen.findByLabelText("User handle"), {
      target: { value: "patrick" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send invite/i }));

    await waitFor(() => {
      expect(addMember).toHaveBeenCalledWith({
        publisherId: "publisher_openclaw",
        userHandle: "patrick",
        role: "publisher",
      });
    });
    expect(createInvite).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Updated @patrick role");
  });

  it("updates an existing member role by personal publisher handle when user handle is missing", async () => {
    const createInvite = vi.fn();
    const addMember = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) => {
      const name = getFunctionName(mutation);
      if (name === "publishers:createMemberInvite") return createInvite;
      if (name === "publishers:addMember") return addMember;
      return vi.fn();
    });
    mockSignedInSettings({
      search: { view: "organizations" },
      members: {
        publisher: { _id: "publisher_openclaw", handle: "openclaw" },
        members: [
          {
            role: "admin",
            user: {
              _id: "user_no_handle",
              handle: null,
              personalPublisherHandle: "legacy-patrick",
              displayName: "Patrick",
              image: null,
            },
          },
        ],
      },
    });

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: /Invite member/i }));
    fireEvent.change(await screen.findByLabelText("User handle"), {
      target: { value: "legacy-patrick" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send invite/i }));

    await waitFor(() => {
      expect(addMember).toHaveBeenCalledWith({
        publisherId: "publisher_openclaw",
        userHandle: "legacy-patrick",
        role: "publisher",
      });
    });
    expect(createInvite).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Updated @legacy-patrick role");
  });

  it("shows the convex error when an invite cannot be sent", async () => {
    const createInvite = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "[CONVEX M(publishers:createMemberInvite)] [Request ID: test] Server Error Called by client ConvexError: @dallin already has a pending invitation",
        ),
      );
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publishers:createMemberInvite" ? createInvite : vi.fn(),
    );
    mockSignedInSettings({ search: { view: "organizations" } });

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: /Invite member/i }));
    fireEvent.change(await screen.findByLabelText("User handle"), {
      target: { value: "dallin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send invite/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "@dallin already has a pending invitation",
      );
    });
    expect(toast.error).toHaveBeenCalledWith("@dallin already has a pending invitation");
  });

  it("lists pending invites for the selected org and lets owners revoke them", async () => {
    const revokeInvite = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publishers:revokeMemberInvite" ? revokeInvite : vi.fn(),
    );
    mockSignedInSettings({
      search: { view: "organizations" },
      pendingInvites: [
        makePublisherInviteFixture({
          _id: "publisherInvites:1" as Id<"publisherInvites">,
        }),
      ],
    });

    render(<Settings />);

    expect(screen.getByRole("heading", { name: "Pending invites" })).toBeTruthy();
    expect(screen.getByText("@dallin")).toBeTruthy();
    expect(screen.getByText(/Invited by @patrick/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Revoke/i }));

    await waitFor(() => {
      expect(revokeInvite).toHaveBeenCalledWith({ inviteId: "publisherInvites:1" });
    });
    expect(toast.success).toHaveBeenCalledWith("Invitation to @dallin revoked");
  });

  it("hides owner invite revoke controls from org admins", () => {
    const adminMembership = { ...orgMembership, role: "admin" as const };
    mockSignedInSettings({
      search: { view: "organizations" },
      memberships: [adminMembership],
      pendingInvites: [
        makePublisherInviteFixture({
          _id: "publisherInvites:owner" as Id<"publisherInvites">,
          role: "owner",
        }),
      ],
    });

    render(<Settings />);

    expect(screen.getByRole("heading", { name: "Pending invites" })).toBeTruthy();
    expect(screen.getByText("@dallin")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Revoke/i })).toBeNull();
  });

  it("accepts invitations addressed to the viewer", async () => {
    const acceptInvite = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) => {
      const name = getFunctionName(mutation);
      if (name === "publishers:acceptMemberInvite") return acceptInvite;
      return vi.fn();
    });
    mockSignedInSettings({
      search: { view: "organizations" },
      memberships: [personalMembership],
      myInvites: [
        makePublisherInviteFixture({
          targetHandle: "patrick",
          targetUser: {
            _id: "user_123" as Id<"users">,
            handle: "patrick",
            displayName: "Patrick",
            image: null,
          },
          role: "admin",
          inviter: {
            _id: "user_other" as Id<"users">,
            handle: "dallin",
            displayName: "Dallin",
            image: null,
          },
        }),
      ],
    });

    render(<Settings />);

    expect(screen.getByRole("heading", { name: "Invitations" })).toBeTruthy();
    expect(screen.getByText("OpenClaw Team")).toBeTruthy();
    expect(screen.getByText(/invited by @dallin/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Accept/i }));

    await waitFor(() => {
      expect(acceptInvite).toHaveBeenCalledWith({ inviteId: "publisherInvites:invite-1" });
    });
    expect(toast.success).toHaveBeenCalledWith("Joined @openclaw");
  });

  it("declines invitations addressed to the viewer", async () => {
    const declineInvite = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publishers:declineMemberInvite" ? declineInvite : vi.fn(),
    );
    mockSignedInSettings({
      search: { view: "organizations" },
      memberships: [personalMembership],
      myInvites: [
        makePublisherInviteFixture({
          targetHandle: "patrick",
          targetUser: {
            _id: "user_123" as Id<"users">,
            handle: "patrick",
            displayName: "Patrick",
            image: null,
          },
          role: "admin",
          inviter: {
            _id: "user_other" as Id<"users">,
            handle: "dallin",
            displayName: "Dallin",
            image: null,
          },
        }),
      ],
    });

    render(<Settings />);

    expect(screen.getByRole("heading", { name: "Invitations" })).toBeTruthy();
    expect(screen.getByText("OpenClaw Team")).toBeTruthy();
    expect(screen.getByText(/invited by @dallin/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Decline/i }));

    await waitFor(() => {
      expect(declineInvite).toHaveBeenCalledWith({ inviteId: "publisherInvites:invite-1" });
    });
    expect(toast.success).toHaveBeenCalledWith("Invitation from @openclaw declined");
  });
});
