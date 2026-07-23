/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsShAdoptionPage } from "./skills-sh-adopt/$owner/$repo/$slug";

const useQueryMock = vi.fn();
const loadPreviewMock = vi.fn();
const startLegacyAdoptionMock = vi.fn();
const startMirroredAdoptionMock = vi.fn();
const useAuthStatusMock = vi.fn();
const { paramsMock } = vi.hoisted(() => ({
  paramsMock: vi.fn(() => ({ owner: "acme", repo: "skills", slug: "demo" })),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => startLegacyAdoptionMock,
  useAction: (action: unknown) =>
    getFunctionName(action as never) === "skillsShAdoption:getMirroredPreview"
      ? loadPreviewMock
      : startMirroredAdoptionMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({
    ...(config as Record<string, unknown>),
    useParams: paramsMock,
  }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("../components/PublisherOwnerSelect", () => ({
  PublisherOwnerSelect: ({
    value,
    onValueChange,
    memberships,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    memberships: Array<{ publisher: { handle: string } }>;
  }) => (
    <select
      aria-label="Adopt into publisher"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {memberships.map((membership) => (
        <option key={membership.publisher.handle} value={membership.publisher.handle}>
          {membership.publisher.handle}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const user = {
  _id: "users:alice",
  handle: "alice",
  displayName: "Alice",
};

const memberships = [
  {
    publisher: {
      _id: "publishers:alice",
      handle: "alice",
      displayName: "Alice",
      kind: "user",
      official: false,
    },
    role: "owner",
  },
];

const preview = {
  canStart: true,
  blockingReason: null,
  idempotencyKey:
    "skills-sh-adoption:v1:publishers:alice:acme/skills/demo:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  publisher: {
    id: "publishers:alice",
    handle: "alice",
    kind: "user",
  },
  ownership: {
    kind: "personal",
    verified: true,
    reason: null,
  },
  source: {
    externalId: "acme/skills/demo",
    githubOwnerId: 42,
    repository: "acme/skills",
    owner: "acme",
    repo: "skills",
    slug: "demo",
    githubPath: "skills/demo",
    githubCommit: "a".repeat(40),
    githubContentHash: "b".repeat(64),
    sourceContentHash: "c".repeat(64),
    sourceSnapshotId: "snapshot-1",
    sourceUrl: "https://skills.sh/acme/skills/demo",
  },
  destination: {
    kind: "replace",
    skillId: "skills:demo",
    fingerprint: "destination-fingerprint-1",
    route: "/alice/demo",
    activeContentWillBeReplaced: true,
    preserved: {
      identity: true,
      downloads: 800,
      bookmarks: 90,
      comments: 7,
      official: true,
      versions: 4,
      auditHistory: true,
    },
  },
};

describe("skills.sh adoption page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: user,
    });
    useQueryMock.mockImplementation((query, args) => {
      const name = query ? getFunctionName(query) : "";
      if (args === "skip") return undefined;
      if (name === "publishers:listMine") return memberships;
      if (name === "skillsShAdoption:getPreview") return null;
      return undefined;
    });
    loadPreviewMock.mockResolvedValue(preview);
    startLegacyAdoptionMock.mockResolvedValue({
      adoptionId: "skillsShAdoptions:1",
      status: "pending_scan",
      destinationKind: "replace",
      destinationSkillId: "skills:demo",
      created: true,
    });
    startMirroredAdoptionMock.mockResolvedValue({
      adoptionId: "skillsShAdoptions:1",
      status: "pending_scan",
      destinationKind: "replace",
      destinationSkillId: "skills:demo",
      created: true,
    });
  });

  it("shows the exact source and retained destination state before enabling replacement", async () => {
    render(<SkillsShAdoptionPage />);

    await screen.findByText("acme/skills");
    expect(screen.getByText("acme/skills")).toBeTruthy();
    expect(screen.getByText("skills/demo")).toBeTruthy();
    expect(screen.getByText("a".repeat(40))).toBeTruthy();
    expect(screen.getByText("c".repeat(64))).toBeTruthy();
    expect(screen.getByText("800")).toBeTruthy();
    expect(screen.getByText("90")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Official state retained")).toBeTruthy();

    const startButton = screen.getByRole("button", {
      name: "Create adoption request",
    }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /replace the active content at @alice\/demo after this exact candidate passes/i,
      }),
    );
    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() =>
      expect(startMirroredAdoptionMock).toHaveBeenCalledWith({
        publisherId: "publishers:alice",
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview.idempotencyKey,
        expectedDestinationFingerprint: preview.destination.fingerprint,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Adoption request created. Exact-source scan is waiting.",
    );
  });

  it("keeps the production-capable catalog preview and mutation when available", async () => {
    useQueryMock.mockImplementation((query, args) => {
      const name = query ? getFunctionName(query) : "";
      if (args === "skip") return undefined;
      if (name === "publishers:listMine") return memberships;
      if (name === "skillsShAdoption:getPreview") return preview;
      return undefined;
    });

    render(<SkillsShAdoptionPage />);

    expect(await screen.findByText("acme/skills")).toBeTruthy();
    expect(loadPreviewMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /replace the active content at @alice\/demo after this exact candidate passes/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create adoption request" }));

    await waitFor(() =>
      expect(startLegacyAdoptionMock).toHaveBeenCalledWith({
        publisherId: "publishers:alice",
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview.idempotencyKey,
        expectedDestinationFingerprint: preview.destination.fingerprint,
      }),
    );
    expect(startMirroredAdoptionMock).not.toHaveBeenCalled();
  });

  it("renders fail-closed ownership guidance without a start action", async () => {
    loadPreviewMock.mockResolvedValue({
      ...preview,
      canStart: false,
      blockingReason: "github_identity_mismatch",
      ownership: {
        kind: "personal",
        verified: false,
        reason: "github_identity_mismatch",
      },
    });

    render(<SkillsShAdoptionPage />);

    await screen.findByText("The connected GitHub account does not own this source.");
    expect(screen.getByText("The connected GitHub account does not own this source.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create adoption request" })).toBeNull();
  });

  it("requires confirmation again when the publisher preview changes", async () => {
    const bobMembership = {
      publisher: {
        _id: "publishers:bob",
        handle: "bob",
        displayName: "Bob",
        kind: "user",
        official: false,
      },
      role: "owner",
    };
    let currentPreview = preview;
    useQueryMock.mockImplementation((query, args) => {
      const name = query ? getFunctionName(query) : "";
      if (args === "skip") return undefined;
      if (name === "publishers:listMine") return [...memberships, bobMembership];
      if (name === "skillsShAdoption:getPreview") return null;
      return undefined;
    });
    loadPreviewMock.mockImplementation(async () => currentPreview);

    render(<SkillsShAdoptionPage />);
    await screen.findByText("acme/skills");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /replace the active content at @alice\/demo after this exact candidate passes/i,
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create adoption request" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );

    currentPreview = {
      ...preview,
      destination: {
        ...preview.destination,
        fingerprint: "destination-fingerprint-2",
      },
    };
    fireEvent.change(screen.getByLabelText("Adopt into publisher"), {
      target: { value: "bob" },
    });

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create adoption request" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });

  it("selects a remaining publisher when the current membership disappears", async () => {
    const bobMembership = {
      publisher: {
        _id: "publishers:bob",
        handle: "bob",
        displayName: "Bob",
        kind: "user",
        official: false,
      },
      role: "owner",
    };
    let currentMemberships = memberships;
    useQueryMock.mockImplementation((query, args) => {
      const name = query ? getFunctionName(query) : "";
      if (args === "skip") return undefined;
      if (name === "publishers:listMine") return currentMemberships;
      if (name === "skillsShAdoption:getPreview") return null;
      return undefined;
    });

    const view = render(<SkillsShAdoptionPage />);
    expect((screen.getByLabelText("Adopt into publisher") as HTMLSelectElement).value).toBe(
      "alice",
    );

    currentMemberships = [bobMembership];
    view.rerender(<SkillsShAdoptionPage />);

    await waitFor(() =>
      expect((screen.getByLabelText("Adopt into publisher") as HTMLSelectElement).value).toBe(
        "bob",
      ),
    );
    await waitFor(() =>
      expect(
        loadPreviewMock.mock.calls.some(
          ([args]) => (args as { publisherId?: string }).publisherId === "publishers:bob",
        ),
      ).toBe(true),
    );
  });

  it("shows the actual status of an existing idempotent request", async () => {
    startMirroredAdoptionMock.mockResolvedValue({
      adoptionId: "skillsShAdoptions:1",
      status: "rejected",
      destinationKind: "replace",
      destinationSkillId: "skills:demo",
      created: false,
    });
    render(<SkillsShAdoptionPage />);
    await screen.findByText("acme/skills");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /replace the active content at @alice\/demo after this exact candidate passes/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create adoption request" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The existing adoption request was rejected."),
    );
    expect(screen.getByRole("button", { name: "Scan rejected" })).toBeTruthy();
  });

  it.each(["stale", "canceled"] as const)(
    "keeps a %s adoption request retryable",
    async (retryableStatus) => {
      startMirroredAdoptionMock
        .mockResolvedValueOnce({
          adoptionId: "skillsShAdoptions:1",
          status: retryableStatus,
          destinationKind: "replace",
          destinationSkillId: "skills:demo",
          created: false,
        })
        .mockResolvedValueOnce({
          adoptionId: "skillsShAdoptions:2",
          status: "pending_scan",
          destinationKind: "replace",
          destinationSkillId: "skills:demo",
          created: true,
        });
      render(<SkillsShAdoptionPage />);
      await screen.findByText("acme/skills");
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: /replace the active content at @alice\/demo after this exact candidate passes/i,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Create adoption request" }));

      const retry = await screen.findByRole("button", { name: "Retry adoption request" });
      expect((retry as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(retry);

      await waitFor(() => expect(startMirroredAdoptionMock).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("button", { name: "Waiting for scan" })).toBeTruthy();
    },
  );
});
