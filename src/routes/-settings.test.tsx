/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./settings";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

describe("Settings", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
  });

  it("skips token loading until auth has resolved", () => {
    useQueryMock.mockImplementation(() => undefined);

    render(<Settings />);

    expect(screen.getByText(/sign in to access settings\./i)).toBeTruthy();
    expect(useQueryMock.mock.calls.some(([, args]) => args === "skip")).toBe(true);
  });
});
