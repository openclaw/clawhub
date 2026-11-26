/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddPage } from "../routes/add";

const { authMock, queryMock } = vi.hoisted(() => ({ authMock: vi.fn(), queryMock: vi.fn() }));

vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => queryMock(...args) }));
vi.mock("../lib/useAuthStatus", () => ({ useAuthStatus: () => authMock() }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => ({ kind: "skill" }),
  }),
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, unknown>;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search ?? {})) {
      if (typeof value === "string") params.set(key, value);
    }
    return (
      <a {...props} href={`${to}?${params}`}>
        {children}
      </a>
    );
  },
}));

const memberships = [
  {
    publisher: {
      _id: "publishers:org",
      handle: "team",
      displayName: "Team",
      kind: "org",
      official: true,
    },
    role: "admin",
  },
  {
    publisher: { _id: "publishers:local", handle: "local", displayName: "Local", kind: "user" },
    role: "owner",
  },
];

describe("AddPage publisher scope", () => {
  let scrollIntoViewDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    queryMock.mockReset();
    queryMock.mockImplementation((_query, args) => (args === "skip" ? undefined : memberships));
    authMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:local" },
    });
  });

  afterEach(() => {
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("uses publisher summaries while preserving personal default and organization links", async () => {
    render(<AddPage />);
    expect(
      queryMock.mock.calls.find(
        ([query]) => getFunctionName(query as never) === "publishers:listMine",
      )?.[1],
    ).toEqual({ includePublishedItems: false });
    await waitFor(() =>
      expect(screen.getByLabelText("Publishing as").textContent).toContain("@local"),
    );
    expect(screen.getByRole("link", { name: /Upload files/ }).getAttribute("href")).toContain(
      "ownerHandle=local",
    );
    expect(screen.getByRole("link", { name: /Git sync/ })).toBeTruthy();

    fireEvent.keyDown(screen.getByLabelText("Publishing as"), { key: "ArrowDown" });
    fireEvent.keyDown(await screen.findByRole("option", { name: /@team/ }), { key: "Enter" });
    expect(screen.getByText("This will publish into @team.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Upload files/ }).getAttribute("href")).toContain(
      "ownerHandle=team",
    );
  });

  it("skips memberships while signed out", () => {
    authMock.mockReturnValue({ isAuthenticated: false, isLoading: false, me: null });
    render(<AddPage />);
    expect(
      queryMock.mock.calls.find(
        ([query]) => getFunctionName(query as never) === "publishers:listMine",
      )?.[1],
    ).toEqual("skip");
    expect(screen.getByRole("heading", { name: "Sign in to add a skill or plugin." })).toBeTruthy();
  });
});
