/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { PluginVersionsPanel } from "../components/PluginVersionsPanel";
import { SkillVersionsPanel } from "../components/SkillVersionsPanel";
import { fetchPackageVersions } from "../lib/packageApi";

const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../lib/packageApi", () => ({
  fetchPackageVersions: vi.fn(),
}));

const latestSkillVersionId = "skillVersions:latest" as Id<"skillVersions">;
const olderSkillVersionId = "skillVersions:older" as Id<"skillVersions">;
const otherLatestSkillVersionId = "skillVersions:other-latest" as Id<"skillVersions">;
const otherOlderSkillVersionId = "skillVersions:other-older" as Id<"skillVersions">;

const skillVersions = [
  {
    _id: latestSkillVersionId,
    version: "2.0.0",
    createdAt: 2,
    changelog: "Current skill release",
    files: [],
    parsed: {},
  },
  {
    _id: olderSkillVersionId,
    version: "1.0.0",
    createdAt: 1,
    changelog: "Older skill release",
    files: [],
    parsed: {},
  },
] as unknown as Doc<"skillVersions">[];

const otherSkillVersions = [
  {
    _id: otherLatestSkillVersionId,
    version: "3.0.0",
    createdAt: 3,
    changelog: "Current other skill release",
    files: [],
    parsed: {},
  },
  {
    _id: otherOlderSkillVersionId,
    version: "2.5.0",
    createdAt: 2,
    changelog: "Older other skill release",
    files: [],
    parsed: {},
  },
] as unknown as Doc<"skillVersions">[];

const pluginVersions = {
  items: [
    {
      version: "2.0.0",
      createdAt: 2,
      changelog: "Current plugin release",
      distTags: ["latest"],
    },
    {
      version: "1.0.0",
      createdAt: 1,
      changelog: "Older plugin release",
      distTags: [],
    },
  ],
  nextCursor: null,
};

const otherPluginVersions = {
  items: [
    {
      version: "3.0.0",
      createdAt: 3,
      changelog: "Current other plugin release",
      distTags: ["latest"],
    },
    {
      version: "1.0.0",
      createdAt: 1,
      changelog: "Older other plugin release",
      distTags: [],
    },
  ],
  nextCursor: null,
};

function makeSkillVersionsPanel({
  versions = skillVersions,
  latestVersionId = latestSkillVersionId,
  canDeleteVersions = true,
  skillSlug = "weather",
}: {
  versions?: Doc<"skillVersions">[];
  latestVersionId?: Id<"skillVersions">;
  canDeleteVersions?: boolean;
  skillSlug?: string;
} = {}) {
  return (
    <SkillVersionsPanel
      versions={versions}
      latestVersionId={latestVersionId}
      canDeleteVersions={canDeleteVersions}
      nixPlugin={false}
      skillSlug={skillSlug}
      suppressScanResults={false}
      suppressedMessage={null}
    />
  );
}

function renderSkillVersions(canDeleteVersions = true) {
  return render(makeSkillVersionsPanel({ canDeleteVersions }));
}

function renderPluginVersions({
  canDeleteVersions = true,
  onVersionDeleted = vi.fn(),
}: {
  canDeleteVersions?: boolean;
  onVersionDeleted?: () => void;
} = {}) {
  return {
    onVersionDeleted,
    ...render(
      <PluginVersionsPanel
        packageName="demo-plugin"
        versions={pluginVersions}
        latestVersion="2.0.0"
        canDeleteVersions={canDeleteVersions}
        onVersionDeleted={onVersionDeleted}
      />,
    ),
  };
}

function expectIrreversibleConfirmation(version: string) {
  expect(screen.getByRole("heading", { name: `Delete version ${version}?` })).toBeTruthy();
  expect(screen.getByText(/deletion is permanent/i)).toBeTruthy();
  expect(screen.getByText(/cannot be restored or republished/i)).toBeTruthy();
  expect(screen.getByText(/version number remains reserved/i)).toBeTruthy();
  expect(screen.getByText(/recovery is publishing a new version/i)).toBeTruthy();
}

function getVersionRowButton(version: string) {
  const versionPattern = new RegExp(`v${version.replaceAll(".", "\\.")}`);
  const toggle = screen
    .getAllByRole("button", { hidden: true })
    .find(
      (button) =>
        button.classList.contains("skill-version-release-toggle") &&
        versionPattern.test(button.textContent ?? ""),
    );
  if (!toggle) {
    throw new Error(`Version toggle for v${version} not found`);
  }
  return toggle;
}

describe("version Delete UI", () => {
  beforeEach(() => {
    useMutationMock.mockReset();
    vi.mocked(fetchPackageVersions).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it("lets a skill owner confirm deletion of a non-latest version", async () => {
    const deleteOwnedVersion = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "skills:deleteOwnedVersion" ? deleteOwnedVersion : vi.fn(),
    );

    renderSkillVersions();

    expect(screen.getByText("Latest")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete version 2.0.0" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    expectIrreversibleConfirmation("1.0.0");

    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));

    await waitFor(() => {
      expect(deleteOwnedVersion).toHaveBeenCalledWith({ versionId: olderSkillVersionId });
      expect(screen.queryByText("Older skill release")).toBeNull();
      expect(getVersionRowButton("2.0.0")).toBeTruthy();
      expect(toast.success).toHaveBeenCalledWith("Deleted version 1.0.0.");
    });
  });

  it("cannot confirm a pending skill deletion after navigating to another skill", () => {
    const deleteOwnedVersion = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "skills:deleteOwnedVersion" ? deleteOwnedVersion : vi.fn(),
    );
    const { rerender } = renderSkillVersions();

    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    expectIrreversibleConfirmation("1.0.0");

    rerender(
      makeSkillVersionsPanel({
        versions: otherSkillVersions.slice(0, 1),
        latestVersionId: otherLatestSkillVersionId,
        skillSlug: "other-skill",
      }),
    );

    expect(screen.queryByRole("heading", { name: "Delete version 1.0.0?" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete version" })).toBeNull();
    expect(deleteOwnedVersion).not.toHaveBeenCalled();
  });

  it("does not let a deletion response from the previous skill reset the current skill dialog", async () => {
    let resolveDelete: (result: { ok: true }) => void = () => undefined;
    const pendingDelete = new Promise<{ ok: true }>((resolve) => {
      resolveDelete = resolve;
    });
    const deleteOwnedVersion = vi.fn().mockReturnValue(pendingDelete);
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "skills:deleteOwnedVersion" ? deleteOwnedVersion : vi.fn(),
    );
    const { rerender } = renderSkillVersions();

    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));
    await waitFor(() => {
      expect(deleteOwnedVersion).toHaveBeenCalledWith({ versionId: olderSkillVersionId });
    });

    rerender(
      makeSkillVersionsPanel({
        versions: otherSkillVersions,
        latestVersionId: otherLatestSkillVersionId,
        skillSlug: "other-skill",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete version 2.5.0" }));
    expectIrreversibleConfirmation("2.5.0");

    resolveDelete({ ok: true });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete version 2.5.0?" })).toBeTruthy();
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("hides skill Delete actions without owner capability", () => {
    renderSkillVersions(false);

    expect(screen.getByText("Latest")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete version/ })).toBeNull();
  });

  it("keeps unavailable staff-history skill versions visible without download or Delete actions", () => {
    useMutationMock.mockReturnValue(vi.fn());
    const unavailableVersions = [
      skillVersions[0],
      {
        ...skillVersions[1],
        softDeletedAt: 3,
        ownerDeletedAt: 3,
      },
      {
        ...skillVersions[1],
        _id: "skillVersions:owner-deleted" as Id<"skillVersions">,
        version: "0.9.0",
        changelog: "Owner-deleted skill release",
        ownerDeletedAt: 2,
      },
    ] as Doc<"skillVersions">[];

    render(makeSkillVersionsPanel({ versions: unavailableVersions }));

    expect(getVersionRowButton("1.0.0")).toBeTruthy();
    expect(getVersionRowButton("0.9.0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete version 1.0.0" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete version 0.9.0" })).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: /Download version v/ })
        .map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("version")),
    ).toEqual(["2.0.0"]);
  });

  it("keeps Download version and Delete actions on active skill version rows", () => {
    useMutationMock.mockReturnValue(vi.fn());

    renderSkillVersions();

    expect(screen.getByText("Latest")).toBeTruthy();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.getAllByText("Download version")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Delete version 2.0.0" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete version 1.0.0" })).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: /Download version v/ })
        .map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("version")),
    ).toEqual(["2.0.0", "1.0.0"]);
  });

  it("treats the skill latest tag as current when latest version metadata is stale", () => {
    useMutationMock.mockReturnValue(vi.fn());

    render(
      <SkillVersionsPanel
        versions={skillVersions}
        latestVersionId={olderSkillVersionId}
        latestTaggedVersionId={latestSkillVersionId}
        canDeleteVersions
        nixPlugin={false}
        skillSlug="weather"
        suppressScanResults={false}
        suppressedMessage={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete version 2.0.0" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete version 1.0.0" })).toBeNull();
  });

  it("shows backend replacement guidance when skill version deletion fails", async () => {
    const deleteOwnedVersion = vi
      .fn()
      .mockRejectedValue(
        new Error("Publish a replacement version before deleting the current latest version."),
      );
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "skills:deleteOwnedVersion" ? deleteOwnedVersion : vi.fn(),
    );

    renderSkillVersions();
    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Publish a replacement version before deleting the current latest version.",
      );
    });
    expect(getVersionRowButton("1.0.0")).toBeTruthy();
  });

  it("lets a plugin owner confirm deletion and refresh route metadata", async () => {
    const deleteOwnedRelease = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "packages:deleteOwnedRelease" ? deleteOwnedRelease : vi.fn(),
    );
    const { onVersionDeleted } = renderPluginVersions();

    expect(screen.getAllByText(/latest/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Delete version 2.0.0" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    expectIrreversibleConfirmation("1.0.0");

    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));

    await waitFor(() => {
      expect(deleteOwnedRelease).toHaveBeenCalledWith({
        name: "demo-plugin",
        version: "1.0.0",
      });
    });
    expect(screen.queryByRole("button", { name: /v1\.0\.0/ })).toBeNull();
    expect(getVersionRowButton("2.0.0")).toBeTruthy();
    expect(onVersionDeleted).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Deleted version 1.0.0.");
  });

  it("ignores a plugin deletion response after navigating to another plugin", async () => {
    let resolveFirstDelete: (result: { ok: true }) => void = () => undefined;
    const firstDelete = new Promise<{ ok: true }>((resolve) => {
      resolveFirstDelete = resolve;
    });
    const secondDelete = new Promise<{ ok: true }>(() => undefined);
    const deleteOwnedRelease = vi
      .fn()
      .mockReturnValueOnce(firstDelete)
      .mockReturnValueOnce(secondDelete);
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "packages:deleteOwnedRelease" ? deleteOwnedRelease : vi.fn(),
    );
    const onVersionDeleted = vi.fn();
    const { rerender } = render(
      <PluginVersionsPanel
        packageName="demo-plugin"
        versions={pluginVersions}
        latestVersion="2.0.0"
        canDeleteVersions
        onVersionDeleted={onVersionDeleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));
    await waitFor(() => {
      expect(deleteOwnedRelease).toHaveBeenCalledWith({
        name: "demo-plugin",
        version: "1.0.0",
      });
    });

    rerender(
      <PluginVersionsPanel
        packageName="other-plugin"
        versions={otherPluginVersions}
        latestVersion="3.0.0"
        canDeleteVersions
        onVersionDeleted={onVersionDeleted}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));
    await waitFor(() => {
      expect(deleteOwnedRelease).toHaveBeenCalledWith({
        name: "other-plugin",
        version: "1.0.0",
      });
    });

    await act(async () => {
      resolveFirstDelete({ ok: true });
      await firstDelete;
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete version 1.0.0?" })).toBeTruthy();
      expect(getVersionRowButton("1.0.0")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Delete version" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(onVersionDeleted).not.toHaveBeenCalled();
    });
  });

  it("hides plugin Delete actions from staff-only viewers", () => {
    renderPluginVersions({ canDeleteVersions: false });

    expect(screen.getAllByText(/latest/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Delete version/ })).toBeNull();
  });

  it("treats the plugin latest dist-tag as current when route metadata is stale", () => {
    useMutationMock.mockReturnValue(vi.fn());

    render(
      <PluginVersionsPanel
        packageName="demo-plugin"
        versions={pluginVersions}
        latestVersion={null}
        canDeleteVersions
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete version 2.0.0" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete version 1.0.0" })).toBeTruthy();
  });

  it("shows backend replacement guidance when plugin release deletion fails", async () => {
    const deleteOwnedRelease = vi
      .fn()
      .mockRejectedValue(
        new Error("Publish a replacement release before deleting the current latest release."),
      );
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "packages:deleteOwnedRelease" ? deleteOwnedRelease : vi.fn(),
    );

    renderPluginVersions();
    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Publish a replacement release before deleting the current latest release.",
      );
    });
    expect(getVersionRowButton("1.0.0")).toBeTruthy();
  });

  it("keeps plugin pagination behavior while exposing Delete on loaded owner rows", async () => {
    useMutationMock.mockReturnValue(vi.fn());
    vi.mocked(fetchPackageVersions).mockResolvedValueOnce({
      items: [
        {
          version: "0.9.0",
          createdAt: 0,
          changelog: "Loaded older plugin release",
          distTags: [],
        },
      ],
      nextCursor: null,
    });

    render(
      <PluginVersionsPanel
        packageName="demo-plugin"
        versions={{
          items: pluginVersions.items,
          nextCursor: "versions:next",
        }}
        latestVersion="2.0.0"
        canDeleteVersions
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(getVersionRowButton("0.9.0")).toBeTruthy();
    });
    expect(fetchPackageVersions).toHaveBeenCalledWith("demo-plugin", {
      cursor: "versions:next",
      limit: 20,
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByRole("button", { name: "Delete version 0.9.0" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
