/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStatus } from "./useAuthStatus";

const useConvexAuthMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useConvexAuth: () => useConvexAuthMock(),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

function Probe() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  return (
    <output>
      {JSON.stringify({
        isAuthenticated,
        isLoading,
        me,
      })}
    </output>
  );
}

describe("useAuthStatus", () => {
  beforeEach(() => {
    useConvexAuthMock.mockReset();
    useQueryMock.mockReset();
  });

  it("skips the current-user query while auth is still resolving", () => {
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    useQueryMock.mockReturnValue(undefined);

    render(<Probe />);

    expect(useQueryMock.mock.calls[0]?.[1]).toBe("skip");
    expect(screen.getByText('{"isAuthenticated":false,"isLoading":true}')).toBeTruthy();
  });

  it("returns a signed-out state after auth resolves unauthenticated", () => {
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    useQueryMock.mockReturnValue(undefined);

    render(<Probe />);

    expect(useQueryMock.mock.calls[0]?.[1]).toBe("skip");
    expect(screen.getByText('{"isAuthenticated":false,"isLoading":false,"me":null}')).toBeTruthy();
  });

  it("keeps loading true until the authenticated profile query resolves", () => {
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    useQueryMock.mockReturnValue(undefined);

    render(<Probe />);

    expect(useQueryMock.mock.calls[0]?.[1]).toEqual({});
    expect(screen.getByText('{"isAuthenticated":true,"isLoading":true}')).toBeTruthy();
  });

  it("returns the resolved current user for authenticated sessions", () => {
    const me = { _id: "users:1", handle: "local" };
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    useQueryMock.mockReturnValue(me);

    render(<Probe />);

    expect(
      screen.getByText(JSON.stringify({ isAuthenticated: true, isLoading: false, me })),
    ).toBeTruthy();
  });
});
