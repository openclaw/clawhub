/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsShBulkAdoptionPage } from "./skills-sh-adopt/index";

const useQueryMock = vi.fn();
const loadPreviewMock = vi.fn();
const startAdoptionMock = vi.fn();
const useAuthStatusMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (action: unknown) =>
    getFunctionName(action as never) === "skillsShBulkAdoption:previewMirroredPublisherEntries"
      ? loadPreviewMock
      : startAdoptionMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
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
      aria-label="Publisher"
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

const memberships = [
  {
    publisher: {
      _id: "publishers:patrick",
      handle: "patrick-erichsen",
      displayName: "Patrick",
      kind: "user",
      official: false,
    },
    role: "owner",
  },
  {
    publisher: {
      _id: "publishers:openclaw",
      handle: "openclaw",
      displayName: "OpenClaw",
      kind: "org",
      official: false,
    },
    role: "admin",
  },
];

const exactStart = {
  sourceContentHash: "c".repeat(64),
  idempotencyKey: "skills-sh-adoption:v1:patrick:html",
  expectedDestinationFingerprint: "destination-html",
};

const preview = {
  publisher: memberships[0]!.publisher,
  ownership: {
    kind: "personal",
    githubOwnerId: 42,
  },
  page: [
    {
      externalId: "patrick-erichsen/skills/html",
      displayName: "HTML",
      sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
      upstreamInstalls: 1200,
      classification: "new-destination",
      canStart: true,
      blockingReason: null,
      source: {
        externalId: "patrick-erichsen/skills/html",
        repository: "patrick-erichsen/skills",
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
        githubPath: "skills/html",
        githubCommit: "a".repeat(40),
        githubContentHash: "c".repeat(64),
        sourceContentHash: "c".repeat(64),
        sourceSnapshotId: "snapshot",
        sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
      },
      destination: {
        kind: "create",
        fingerprint: "destination-html",
      },
      start: exactStart,
    },
    {
      externalId: "patrick-erichsen/skills/unavailable",
      displayName: "Unavailable",
      sourceUrl: "https://skills.sh/patrick-erichsen/skills/unavailable",
      upstreamInstalls: 10,
      classification: "unavailable",
      canStart: false,
      blockingReason: "source_incomplete",
      source: null,
      destination: null,
      start: null,
    },
  ],
  isDone: true,
  continueCursor: "",
};

describe("skills.sh bulk adoption page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: {
        _id: "users:patrick",
        handle: "patrick-erichsen",
        displayName: "Patrick",
      },
    });
    useQueryMock.mockReturnValue(memberships);
    loadPreviewMock.mockResolvedValue(preview);
    startAdoptionMock.mockResolvedValue({
      adoptionId: "skillsShAdoptions:html",
      status: "pending_scan",
      destinationKind: "create",
      destinationSkillId: null,
      created: true,
    });
  });

  it("starts only selected eligible sources with the exact preview fingerprint", async () => {
    render(<SkillsShBulkAdoptionPage />);

    fireEvent.click(screen.getByRole("button", { name: "Preview sources" }));
    expect(await screen.findByText("HTML")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review HTML" }).getAttribute("href")).toBe(
      "/skills-sh-adopt/patrick-erichsen/skills/html",
    );
    expect(
      (screen.getByRole("checkbox", { name: "Select Unavailable" }) as HTMLInputElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select eligible" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Start one exact-source ClawHub scan/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start selected adoptions" }));

    await waitFor(() =>
      expect(startAdoptionMock).toHaveBeenCalledWith({
        publisherId: "publishers:patrick",
        externalId: "patrick-erichsen/skills/html",
        ...exactStart,
      }),
    );
    expect(startAdoptionMock).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("1 adoption request started.");
    expect(screen.queryByRole("button", { name: "Start selected adoptions" })).toBeNull();
  });

  it("discards a preview response after the publisher changes", async () => {
    let resolvePreview: ((value: typeof preview) => void) | undefined;
    loadPreviewMock.mockReturnValueOnce(
      new Promise<typeof preview>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    render(<SkillsShBulkAdoptionPage />);

    fireEvent.click(screen.getByRole("button", { name: "Preview sources" }));
    fireEvent.change(screen.getByLabelText("Publisher"), {
      target: { value: "openclaw" },
    });
    resolvePreview?.(preview);

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Preview sources" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(screen.queryByText("HTML")).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("requires confirmation again after refreshing the preview", async () => {
    render(<SkillsShBulkAdoptionPage />);

    fireEvent.click(screen.getByRole("button", { name: "Preview sources" }));
    await screen.findByText("HTML");
    fireEvent.click(screen.getByRole("button", { name: "Select eligible" }));
    const confirmation = screen.getByRole("checkbox", {
      name: /Start one exact-source ClawHub scan/,
    }) as HTMLInputElement;
    fireEvent.click(confirmation);
    expect(confirmation.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(confirmation.checked).toBe(false));
    expect(
      (screen.getByRole("button", { name: "Start selected adoptions" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it.each(["stale", "canceled"] as const)(
    "keeps a %s bulk result selectable for retry",
    async (retryableStatus) => {
      startAdoptionMock
        .mockResolvedValueOnce({
          adoptionId: "skillsShAdoptions:html",
          status: retryableStatus,
          destinationKind: "create",
          destinationSkillId: null,
          created: false,
        })
        .mockResolvedValueOnce({
          adoptionId: "skillsShAdoptions:html-retry",
          status: "pending_scan",
          destinationKind: "create",
          destinationSkillId: null,
          created: true,
        });
      render(<SkillsShBulkAdoptionPage />);
      fireEvent.click(screen.getByRole("button", { name: "Preview sources" }));
      await screen.findByText("HTML");
      fireEvent.click(screen.getByRole("checkbox", { name: "Select HTML" }));
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Start one exact-source ClawHub scan/ }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Start selected adoptions" }));

      const selection = await screen.findByRole("checkbox", { name: "Select HTML" });
      expect((selection as HTMLInputElement).disabled).toBe(false);
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Start one exact-source ClawHub scan/ }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Start selected adoptions" }));

      await waitFor(() => expect(startAdoptionMock).toHaveBeenCalledTimes(2));
    },
  );
});
