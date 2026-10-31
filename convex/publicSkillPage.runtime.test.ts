import { expect, it, vi } from "vitest";

vi.mock("./skills", () => {
  throw new Error("Detail reader loaded the publishing-coupled skills module");
});
vi.mock("./lib/skillPublish", () => {
  throw new Error("Detail reader loaded the publishing implementation");
});
vi.mock("./functions", () => {
  throw new Error("Detail reader loaded mutation triggers");
});
vi.mock("clawhub-schema", () => {
  throw new Error("Detail reader loaded the schema compiler");
});

it("registers the detail query without publishing or schema compiler initialization", async () => {
  vi.resetModules();
  const entry = await import("./publicSkillPage");
  expect(typeof entry.getBySlug).toBe("function");
});
