import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../../lib/publicUser";

export function makePublicSkill(overrides: Partial<PublicSkill> = {}): PublicSkill {
  return {
    _id: "skills:demo" as Id<"skills">,
    _creationTime: 1,
    slug: "demo",
    displayName: "Demo Skill",
    summary: "Demo summary",
    icon: undefined,
    ownerUserId: "users:owner" as Id<"users">,
    ownerPublisherId: "publishers:owner" as Id<"publishers">,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    badges: {},
    stats: {
      downloads: 0,
      stars: 0,
      versions: 1,
      comments: 0,
      installs: 0,
    },
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function makePublicPublisher(overrides: Partial<PublicPublisher> = {}): PublicPublisher {
  return {
    _id: "publishers:owner" as Id<"publishers">,
    _creationTime: 1,
    kind: "org",
    handle: "owner",
    displayName: "Owner",
    image: undefined,
    bio: undefined,
    linkedUserId: undefined,
    ...overrides,
  };
}
