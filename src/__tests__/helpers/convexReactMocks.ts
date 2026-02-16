import { vi } from 'vitest'

export const convexReactMocks = {
  useAction: vi.fn(),
  useQuery: vi.fn(),
  usePaginatedQuery: vi.fn(),
}

export function resetConvexReactMocks() {
  convexReactMocks.useAction.mockReset()
  convexReactMocks.useQuery.mockReset()
  convexReactMocks.usePaginatedQuery.mockReset()
}

export function setupDefaultConvexReactMocks() {
  convexReactMocks.useAction.mockReturnValue(() => Promise.resolve([]))
  convexReactMocks.useQuery.mockReturnValue(null)
}
