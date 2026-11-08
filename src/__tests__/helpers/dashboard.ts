import type { DashboardPackage, DashboardSkill } from "../../components/dashboard/types";

export function makeDashboardSkill(overrides: Partial<DashboardSkill> = {}): DashboardSkill {
  return {
    _id: "skills:a",
    _creationTime: 1,
    slug: "alpha",
    displayName: "Alpha",
    summary: "Alpha skill",
    ownerUserId: "users:local",
    ownerPublisherId: "publishers:local",
    canonicalSkillId: null,
    forkOf: null,
    latestVersionId: null,
    tags: {},
    badges: {},
    stats: {
      downloads: 10,
      installsCurrent: 4,
      installsAllTime: 12,
      stars: 0,
      versions: 1,
    },
    moderationStatus: "active",
    moderationReason: null,
    moderationVerdict: null,
    moderationFlags: [],
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 100,
    ownerPath: "local",
    latestVersion: {
      version: "1.0.0",
      createdAt: 1,
      llmStatus: "clean",
    },
    ...overrides,
  } as DashboardSkill;
}

export function makeDashboardPackage(overrides: Partial<DashboardPackage> = {}): DashboardPackage {
  return {
    _id: "packages:b",
    name: "beta-plugin",
    displayName: "Beta Plugin",
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    updatedAt: 200,
    stats: { downloads: 50, installs: 20, stars: 0, versions: 1 },
    latestRelease: {
      version: "1.0.0",
      createdAt: 1,
      llmStatus: "clean",
    },
    ...overrides,
  };
}
