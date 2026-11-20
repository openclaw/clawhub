export function createPackageSeedDefaults() {
  return {
    family: "code-plugin" as const,
    channel: "community" as const,
    isOfficial: false,
    tags: {},
    createdAt: 1,
    updatedAt: 1,
  };
}
