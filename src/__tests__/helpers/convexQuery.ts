import { vi } from "vitest";

export function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

export function indexedUnique(readValue: () => unknown) {
  // Keep fixture evaluation lazy and create a fresh unique mock for each index call.
  return {
    withIndex: vi.fn(() => ({
      unique: vi.fn().mockResolvedValue(readValue()),
    })),
  };
}

export function orderedTake<T>(readValues: () => T[]) {
  return {
    order: vi.fn(() => ({
      take: vi.fn().mockResolvedValue(readValues()),
    })),
  };
}
