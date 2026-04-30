/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown; validateSearch?: unknown }) => ({
    __config: config,
  }),
}));

vi.mock("../components/UserListItem", () => ({
  UserListItem: ({ user }: { user: { _id: string } }) => <div>{user._id}</div>,
}));

vi.mock("../components/ui/card", () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

async function loadRoute() {
  return (await import("../routes/users/index")).Route as unknown as {
    __config: {
      component?: ComponentType;
      validateSearch?: unknown;
    };
  };
}

describe("users route", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ items: [], total: 0 });
  });

  it("does not expose public user search", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    await waitFor(() => expect(queryMock).toHaveBeenCalled());
    expect(queryMock.mock.calls[0]?.[1]).toEqual({ limit: 48 });
    expect(screen.queryByPlaceholderText(/search users/i)).toBeNull();
    expect(route.__config.validateSearch).toBeUndefined();
  });
});
