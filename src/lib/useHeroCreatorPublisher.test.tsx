/* @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPublisher } from "./publicUser";
import { useHeroCreatorPublisher } from "./useHeroCreatorPublisher";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

const owner = {
  _id: "publishers:openclaw",
  _creationTime: 1,
  kind: "org",
  handle: "openclaw",
  displayName: "OpenClaw",
} as PublicPublisher;

describe("useHeroCreatorPublisher", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("enriches detail owners from the canonical publisher lookup", () => {
    useQueryMock.mockReturnValue({ ...owner, official: true });

    const { result } = renderHook(() => useHeroCreatorPublisher({ owner }));

    expect(useQueryMock.mock.calls[0]?.[1]).toEqual({ handle: "openclaw" });
    expect(result.current).toEqual({ ...owner, official: true });
  });

  it("skips the publisher lookup when the item already proves official status", () => {
    useQueryMock.mockReturnValue(undefined);

    const { result } = renderHook(() => useHeroCreatorPublisher({ owner, skillOfficial: true }));

    expect(useQueryMock.mock.calls[0]?.[1]).toBe("skip");
    expect(result.current).toEqual({ ...owner, official: true });
  });
});
