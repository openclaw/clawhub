import { vi } from "vitest";

export const convexReactMocks = {
  useAction: vi.fn(),
  useQuery: vi.fn(),
};

export const convexHttpMock = {
  action: vi.fn(),
  query: vi.fn(),
};

export function resetConvexReactMocks() {
  convexReactMocks.useAction.mockReset();
  convexReactMocks.useQuery.mockReset();
  convexHttpMock.action.mockReset();
  convexHttpMock.query.mockReset();
}

export function setupDefaultConvexReactMocks() {
  convexReactMocks.useAction.mockReturnValue(() => Promise.resolve([]));
  convexReactMocks.useQuery.mockReturnValue(null);
  convexHttpMock.action.mockResolvedValue([]);
  convexHttpMock.query.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });
}
