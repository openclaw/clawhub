import { vi } from "vitest";

export const convexReactMocks = {
  useAction: vi.fn(),
  useQuery: vi.fn(),
  useQueries: vi.fn(),
};

export const convexHttpMock = {
  action: vi.fn(),
  query: vi.fn(),
};

export function resetConvexReactMocks() {
  convexReactMocks.useAction.mockReset();
  convexReactMocks.useQuery.mockReset();
  convexReactMocks.useQueries.mockReset();
  convexHttpMock.action.mockReset();
  convexHttpMock.query.mockReset();
}

export function setupDefaultConvexReactMocks() {
  convexReactMocks.useAction.mockReturnValue(() => Promise.resolve([]));
  convexReactMocks.useQuery.mockReturnValue(null);
  convexReactMocks.useQueries.mockReturnValue({});
  convexHttpMock.action.mockResolvedValue([]);
  convexHttpMock.query.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });
}

// Keep the subscription hook real; replace only the transport's query result.
export async function setupRealCountQuery(initialValue: number | Error) {
  const { ConvexProvider, ConvexReactClient, useQueries } =
    await vi.importActual<typeof import("convex/react")>("convex/react");
  const client = new ConvexReactClient("https://example.invalid");
  const listeners = new Set<() => void>();
  let value = initialValue;
  vi.spyOn(client, "watchQuery").mockImplementation(() => ({
    localQueryResult: () => {
      if (value instanceof Error) throw value;
      return value;
    },
    onUpdate: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    journal: () => undefined,
  }));
  convexReactMocks.useQueries.mockImplementation(useQueries);
  return {
    ConvexProvider,
    client,
    setCount: (nextValue: number) => {
      value = nextValue;
      for (const listener of listeners) listener();
    },
  };
}
