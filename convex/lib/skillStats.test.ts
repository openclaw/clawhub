import { describe, expect, it } from "vitest";
import {
  buildExternalSkillMetricPatch,
  readPublicDownloads,
  readSkillMetricSources,
} from "./skillStats";

const skill = {
  statsDownloads: 40,
  statsStars: 7,
  statsInstallsCurrent: 3,
  statsInstallsAllTime: 12,
  statsSkillsShInstalls: 9,
  statsGithubStars: 250,
  stats: {
    downloads: 40,
    stars: 7,
    installsCurrent: 3,
    installsAllTime: 12,
  },
};

describe("source-attributed skill metrics", () => {
  it("keeps every source independently attributable", () => {
    expect(readSkillMetricSources(skill)).toEqual({
      clawHubDownloads: 40,
      skillsShInstalls: 9,
      openClawInstallsCurrent: 3,
      openClawInstallsAllTime: 12,
      githubStars: 250,
      bookmarks: 7,
    });
  });

  it("keeps public downloads scoped to ClawHub artifacts", () => {
    expect(readPublicDownloads(skill)).toBe(40);
  });

  it("preserves unavailable external metrics instead of serializing them as zero", () => {
    expect(
      readSkillMetricSources({
        statsDownloads: 4,
        statsStars: 2,
        statsInstallsCurrent: 1,
        statsInstallsAllTime: 3,
        stats: {},
      }),
    ).toEqual({
      clawHubDownloads: 4,
      skillsShInstalls: null,
      openClawInstallsCurrent: 1,
      openClawInstallsAllTime: 3,
      githubStars: null,
      bookmarks: 2,
    });
  });

  it("builds a source-only refresh patch and preserves unknown GitHub popularity", () => {
    expect(
      buildExternalSkillMetricPatch({
        skillsShInstalls: 11,
        githubStars: undefined,
      }),
    ).toEqual({
      statsSkillsShInstalls: 11,
    });
  });
});
