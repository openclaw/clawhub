/* @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBrowseTopicSearch } from "./useBrowseTopicSearch";

const useRouterStateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useRouterState: (options: { select: (state: unknown) => unknown }) =>
    options.select({
      location: { searchStr: useRouterStateMock() },
    }),
}));

describe("useBrowseTopicSearch", () => {
  it("uses the validated route topic when present", () => {
    useRouterStateMock.mockReturnValue("");
    const { result } = renderHook(() => useBrowseTopicSearch({ topic: "github" }));
    expect(result.current.activeTopic).toBe("github");
    expect(result.current.search.topic).toBe("github");
  });

  it("falls back to malformed topic%3Dgithub query strings", () => {
    useRouterStateMock.mockReturnValue("?topic%3Dgithub");
    const { result } = renderHook(() =>
      useBrowseTopicSearch<{ topic?: string; "topic=github"?: string }>({ "topic=github": "" }),
    );
    expect(result.current.activeTopic).toBe("github");
    expect(result.current.search.topic).toBe("github");
  });
});
