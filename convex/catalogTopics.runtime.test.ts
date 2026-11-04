import { expect, it, vi } from "vitest";

vi.mock("./functions", () => {
  throw new Error("Catalog topics loaded mutation triggers");
});
vi.mock("clawhub-schema", () => {
  throw new Error("Catalog topics loaded the schema compiler");
});

it("registers the topic query without mutation or schema compiler initialization", async () => {
  vi.resetModules();
  const entry = await import("./catalogTopics");
  expect(typeof entry.listTopByCategory).toBe("function");
});
