/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { ActivePublisherProvider, useActivePublisher } from "./activePublisher";

const useQueryMock = vi.fn();
const useAuthStatusMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("./useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

const me = {
  _id: "users:local",
  handle: "local",
};

const personalPublisher = {
  publisher: {
    _id: "publishers:local",
    handle: "local",
    displayName: "Local",
    kind: "user",
    image: null,
  },
  role: "owner",
};

const orgPublisher = {
  publisher: {
    _id: "publishers:openclaw",
    handle: "openclaw",
    displayName: "OpenClaw",
    kind: "org",
    image: null,
  },
  role: "admin",
};

const publisherStorageKey = "clawhub-active-publisher:users:local";

function ProviderHarness({ children }: { children: ReactNode }) {
  return <ActivePublisherProvider>{children}</ActivePublisherProvider>;
}

function Probe() {
  const activePublisher = useActivePublisher();
  return (
    <div>
      <div data-testid="active-handle">{activePublisher.activeOwnerHandle ?? "none"}</div>
      <div data-testid="can-manage">{activePublisher.canManageActivePublisher ? "yes" : "no"}</div>
      <button
        type="button"
        onClick={() => activePublisher.setActivePublisherId("publishers:openclaw" as never)}
      >
        Switch org
      </button>
    </div>
  );
}

describe("ActivePublisherProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useQueryMock.mockReset();
    useAuthStatusMock.mockReset();
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me,
    });
    useQueryMock.mockImplementation((query, args) => {
      expect(getFunctionName(query)).toBe(getFunctionName(api.publishers.listMine));
      if (args === "skip") return undefined;
      return [personalPublisher, orgPublisher];
    });
  });

  it("loads memberships only after the signed-in user row exists", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: true,
      me: undefined,
    });
    render(
      <ProviderHarness>
        <Probe />
      </ProviderHarness>,
    );

    expect(useQueryMock).toHaveBeenCalledWith(api.publishers.listMine, "skip");
    expect(screen.getByTestId("active-handle").textContent).toBe("none");
  });

  it("falls back to the personal publisher and persists direct switches", async () => {
    render(
      <ProviderHarness>
        <Probe />
      </ProviderHarness>,
    );

    expect(screen.getByTestId("active-handle").textContent).toBe("local");

    screen.getByRole("button", { name: "Switch org" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("active-handle").textContent).toBe("openclaw");
    });
    expect(screen.getByTestId("can-manage").textContent).toBe("yes");
    expect(window.localStorage.getItem(publisherStorageKey)).toBe("publishers:openclaw");
  });

  it("clears stale persisted publishers and returns to the personal publisher", async () => {
    window.localStorage.setItem(publisherStorageKey, "publishers:stale");

    render(
      <ProviderHarness>
        <Probe />
      </ProviderHarness>,
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(publisherStorageKey)).toBeNull();
    });
    expect(screen.getByTestId("active-handle").textContent).toBe("local");
  });

  it("syncs active publisher changes from another tab", async () => {
    render(
      <ProviderHarness>
        <Probe />
      </ProviderHarness>,
    );

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: publisherStorageKey,
        newValue: "publishers:openclaw",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-handle").textContent).toBe("openclaw");
    });
  });
});
