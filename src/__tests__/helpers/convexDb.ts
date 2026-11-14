import { vi } from "vitest";

export function createMockDb() {
  return {
    get: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    query: vi.fn(),
    replace: vi.fn(),
    delete: vi.fn(),
    normalizeId: vi.fn(),
    system: {},
  };
}
