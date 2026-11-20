export function makeApiSkill(overrides: Record<string, unknown> = {}) {
  return {
    slug: "demo",
    displayName: "Demo",
    summary: null,
    tags: {},
    stats: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
