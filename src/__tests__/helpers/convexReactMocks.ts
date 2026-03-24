import { vi } from "vitest";

export const convexReactMocks = {
  useAction: vi.fn(),
  useQuery: vi.fn(),
};

export const convexHttpMock = {
  query: vi.fn(),
};

export function resetConvexReactMocks() {
  convexReactMocks.useAction.mockReset();
  convexReactMocks.useQuery.mockReset();
  convexHttpMock.query.mockReset();
}

export function setupDefaultConvexReactMocks() {
  convexReactMocks.useAction.mockReturnValue(() => Promise.resolve([]));
  convexReactMocks.useQuery.mockReturnValue(null);
  convexHttpMock.query.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });
}
