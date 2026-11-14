export function createActiveSkillSeedDefaults() {
  return {
    tags: {},
    badges: {},
    moderationStatus: "active" as const,
    createdAt: 1,
    updatedAt: 1,
  };
}
