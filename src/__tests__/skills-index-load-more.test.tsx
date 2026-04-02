/* @vitest-environment jsdom */
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsIndex } from "../routes/skills/index";
import {
  convexHttpMock,
  convexReactMocks,
  resetConvexReactMocks,
  setupDefaultConvexReactMocks,
} from "./helpers/convexReactMocks";

const navigateMock = vi.fn();
let searchMock: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_config: { component: unknown; validateSearch: unknown }) => ({
    useNavigate: () => navigateMock,
    useSearch: () => searchMock,
  }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}));

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => convexReactMocks.useAction(...args),
  useQuery: (...args: unknown[]) => convexReactMocks.useQuery(...args),
}));

vi.mock("../../src/convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexHttpMock.query(...args),
  },
}));

describe("SkillsIndex load-more observer", () => {
  beforeEach(() => {
    resetConvexReactMocks();
    navigateMock.mockReset();
    searchMock = {};
    setupDefaultConvexReactMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("triggers one load-more fetch for repeated intersection callbacks", async () => {
    // First call returns a page with a cursor, second call (load more) tracks calls
    let loadMoreCallCount = 0;
    convexHttpMock.query
      .mockResolvedValueOnce({
        page: [makeListResult("skill-0", "Skill 0")],
        hasMore: true,
        nextCursor: "cursor-1",
      })
      .mockImplementation(() => {
        loadMoreCallCount++;
        // Never resolve to keep in loading state
        return new Promise(() => {});
      });

    type ObserverInstance = {
      callback: IntersectionObserverCallback;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    };

    const observers: ObserverInstance[] = [];
    class IntersectionObserverMock {
      callback: IntersectionObserverCallback;
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "0px";
      thresholds: number[] = [];

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    }
    vi.stubGlobal(
      "IntersectionObserver",
      IntersectionObserverMock as unknown as typeof IntersectionObserver,
    );

    render(<SkillsIndex />);
    await act(async () => {});

    // Find the observer (there may be multiple from re-renders; use the last one)
    const observer = observers[observers.length - 1];
    const entries = [{ isIntersecting: true }] as Array<IntersectionObserverEntry>;

    await act(async () => {
      observer.callback(entries, observer as unknown as IntersectionObserver);
      observer.callback(entries, observer as unknown as IntersectionObserver);
      observer.callback(entries, observer as unknown as IntersectionObserver);
    });

    // Only one load-more fetch should have been triggered
    expect(loadMoreCallCount).toBe(1);
  });
});

function makeListResult(slug: string, displayName: string) {
  return {
    skill: {
      _id: `skill_${slug}`,
      slug,
      displayName,
      summary: `${displayName} summary`,
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 1,
        comments: 0,
      },
      createdAt: 0,
      updatedAt: 0,
    },
    latestVersion: null,
    ownerHandle: null,
  };
}
