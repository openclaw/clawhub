/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("does not keep auth loading true when only the profile query is unresolved", () => {
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    useQueryMock.mockReturnValue(undefined);

    render(<Probe />);

    expect(screen.getByText('{"isAuthenticated":false,"isLoading":false}')).toBeTruthy();
  });

  it("preserves authenticated session state before the profile query resolves", () => {
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    useQueryMock.mockReturnValue(undefined);

    render(<Probe />);

    expect(screen.getByText('{"isAuthenticated":true,"isLoading":false}')).toBeTruthy();
  });
});
