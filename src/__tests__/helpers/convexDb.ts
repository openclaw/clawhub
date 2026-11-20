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

export type TestDbRow = Record<string, unknown> & { _id: string };

export function createTableStore(initial: Record<string, TestDbRow[]> = {}) {
  const tables: Record<string, TestDbRow[]> = Object.fromEntries(
    Object.entries(initial).map(([table, rows]) => [table, [...rows]]),
  );
  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };
  return {
    tables,
    list,
    get: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      return list(table).find((row) => row._id === id) ?? null;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const table = id.split(":")[0] ?? "";
      const row = list(table).find((candidate) => candidate._id === id);
      if (!row) return;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    delete: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      const rows = list(table);
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}
