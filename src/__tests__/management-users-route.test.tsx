/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
  }),
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, unknown>;
  }) => <a href={to}>{children}</a>,
}));

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useAuthStatusMock = vi.fn();
const setRole = vi.fn();
const banUser = vi.fn();
const unbanUser = vi.fn();

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => useMutationMock(),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

import { Route, UserManagementRoute } from "../routes/management/users";

function renderRoute() {
  render(createElement(UserManagementRoute as never));
}

describe("user management route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useAuthStatusMock.mockReset();
    setRole.mockReset();
    banUser.mockReset();
    unbanUser.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:admin", role: "admin" },
    });
    useMutationMock.mockReturnValue((args: Record<string, unknown>) => {
      if ("role" in args) return setRole(args);
      if ("reason" in args && args.userId === "users:banned") return unbanUser(args);
      return banUser(args);
    });
    setRole.mockResolvedValue({ ok: true });
    banUser.mockResolvedValue({ ok: true });
    unbanUser.mockResolvedValue({ ok: true });
    useQueryMock.mockReturnValue({
      total: 2,
      items: [
        {
          _id: "users:target",
          _creationTime: Date.UTC(2026, 0, 1),
          handle: "target",
          name: "target",
          email: "target@example.com",
          role: "user",
          createdAt: Date.UTC(2026, 0, 1),
        },
        {
          _id: "users:banned",
          _creationTime: Date.UTC(2026, 0, 2),
          handle: "banned",
          name: "banned",
          email: "banned@example.com",
          role: "moderator",
          createdAt: Date.UTC(2026, 0, 2),
          deletedAt: Date.UTC(2026, 0, 3),
          banReason: "malware",
        },
      ],
    });
  });

  it("registers the dedicated user management route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders role management and confirms moderator writes", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    renderRoute();

    expect(screen.getByRole("heading", { name: "User roles" })).toBeTruthy();
    expect(screen.getByText("/management/users")).toBeTruthy();
    expect(screen.getByText("@target")).toBeTruthy();
    expect(screen.getByText("malware")).toBeTruthy();

    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "moderator" } });

    await waitFor(() => {
      expect(setRole).toHaveBeenCalledWith({
        userId: "users:target",
        role: "moderator",
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Set @target role from user to moderator"),
    );
  });

  it("requires a reason for ban writes", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.spyOn(window, "prompt").mockReturnValueOnce("security abuse");

    renderRoute();

    fireEvent.click(screen.getAllByRole("button", { name: "Ban" })[0]!);

    await waitFor(() => {
      expect(banUser).toHaveBeenCalledWith({
        userId: "users:target",
        reason: "security abuse",
      });
    });
  });

  it("blocks non-admin users", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });

    renderRoute();

    expect(screen.getByText("Management access required")).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });
});
