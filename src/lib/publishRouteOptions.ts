import { redirect } from "@tanstack/react-router";

export function parseSkillPublishSearch(search: Record<string, unknown>) {
  return {
    updateSlug: typeof search.updateSlug === "string" ? search.updateSlug : undefined,
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  };
}

function parseLegacyPluginPublishSearch(search: Record<string, unknown>) {
  return {
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
    name: typeof search.name === "string" ? search.name : undefined,
    displayName: typeof search.displayName === "string" ? search.displayName : undefined,
    family: search.family === "code-plugin" ? search.family : undefined,
    nextVersion: typeof search.nextVersion === "string" ? search.nextVersion : undefined,
    sourceRepo: typeof search.sourceRepo === "string" ? search.sourceRepo : undefined,
  };
}

export function createSkillPublishRedirectOptions() {
  return {
    validateSearch: parseSkillPublishSearch,
    beforeLoad: ({ search }: { search: ReturnType<typeof parseSkillPublishSearch> }) => {
      throw redirect({
        to: "/skills/publish",
        search,
      });
    },
  };
}

export function createPluginPublishRedirectOptions() {
  return {
    validateSearch: parseLegacyPluginPublishSearch,
    beforeLoad: ({ search }: { search: ReturnType<typeof parseLegacyPluginPublishSearch> }) => {
      throw redirect({
        to: "/plugins/publish",
        search,
      });
    },
  };
}
