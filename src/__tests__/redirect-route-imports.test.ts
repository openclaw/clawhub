import { expect, it, vi } from "vitest";

// The generated route tree eagerly imports redirect definitions on every page,
// including Templates. The actual skill UI belongs to its canonical route split.
vi.mock("../components/SkillDetailPage", () => {
  throw new Error("redirect route imported the Skill detail UI");
});

it("registers legacy redirects without loading the unrelated Skill detail UI", async () => {
  expect((await import("../routes/$owner/$slug")).Route).toBeDefined();
  expect((await import("../routes/$owner/$slug/settings")).Route).toBeDefined();
});
