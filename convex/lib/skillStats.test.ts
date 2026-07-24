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

  it("adds skills.sh installs to public downloads without double-counting OpenClaw installs", () => {
    expect(readPublicDownloads(skill)).toBe(49);
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
