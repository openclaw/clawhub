import { type inferred, type } from "arktype";
import {
  ClawdisRequiresSchema,
  EnvVarDeclarationSchema,
  SkillInstallSpecSchema,
} from "./schemaShared.js";

export * from "./schemaShared.js";

export const LockfileSchema = type({
  version: "1",
  skills: {
    "[string]": {
      version: "string|null",
      installedAt: "number",
      ownerHandle: "string?",
      sourceRef: "string?",
      sourceKind: '"skills-sh"?',
      sourceRepository: "string?",
      sourcePath: "string?",
      sourceUrl: "string?",
      canonicalRef: "string?",
      clawhubScan: '"unscanned"|"scanned"?',
      trustLabel: "string?",
      pinned: "boolean?",
      pinReason: "string?",
    },
  },
});
export type Lockfile = (typeof LockfileSchema)[inferred];

export const ApiV1PublisherEnsureResponseSchema = type({
  ok: "true",
  publisherId: "string",
  handle: "string",
  created: "boolean",
  migrated: "boolean",
  trusted: "boolean",
  "member?": type({
    userId: "string",
    handle: "string",
    role: '"owner"|"admin"|"publisher"',
  }),
});
export type ApiV1PublisherEnsureResponse = (typeof ApiV1PublisherEnsureResponseSchema)[inferred];

export const ApiV1PublisherRemoveMemberResponseSchema = type({
  ok: "true",
  publisherId: "string",
  handle: "string",
  removed: "boolean",
  member: type({
    userId: "string",
    handle: "string",
    role: '"owner"|"admin"|"publisher"',
  }),
});
export type ApiV1PublisherRemoveMemberResponse =
  (typeof ApiV1PublisherRemoveMemberResponseSchema)[inferred];

export const ApiV1PublisherProfileUpdateResponseSchema = type({
  ok: "true",
  publisherId: "string",
  handle: "string",
  bio: "string|null",
  image: "string|null",
  bioUpdated: "boolean",
  logoUpdated: "boolean",
});
export type ApiV1PublisherProfileUpdateResponse =
  (typeof ApiV1PublisherProfileUpdateResponseSchema)[inferred];

export const ApiV1PublisherRecoveryResponseSchema = type({
  ok: "true",
  dryRun: "boolean",
  recovered: "boolean",
  publisherId: "string",
  handle: "string",
  previousUser: {
    userId: "string",
    handle: "string|null",
    nextHandle: "string|null",
    githubProviderAccountId: "string",
    authAccountCount: "number",
  },
  nextUser: {
    userId: "string",
    handle: "string|null",
    nextHandle: "string",
    githubProviderAccountId: "string",
    authAccountCount: "number",
  },
  retiredPersonalPublisher: type({
    publisherId: "string",
    handle: "string",
    skills: "number",
    packages: "number",
    githubSources: "number",
  }).or("null"),
  resourceOwnerMigration: {
    limitPerTable: "number",
    skills: "number",
    skillSlugAliases: "number",
    packages: "number",
    packageInspectorWarnings: "number",
    githubSourcesChecked: "number",
    handleReservations: "number",
  },
  identityVerified: "boolean",
  reason: "string",
});
export type ApiV1PublisherRecoveryResponse =
  (typeof ApiV1PublisherRecoveryResponseSchema)[inferred];

export const ApiV1OfficialPublisherListResponseSchema = type({
  ok: "true",
  items: type({
    officialPublisherId: "string",
    publisherId: "string",
    handle: "string|null",
    displayName: "string|null",
    kind: '"user"|"org"|null',
    active: "boolean",
    reason: "string|null",
    createdByUserId: "string|null",
    createdByHandle: "string|null",
    createdAt: "number",
    updatedAt: "number",
  }).array(),
});
export type ApiV1OfficialPublisherListResponse =
  (typeof ApiV1OfficialPublisherListResponseSchema)[inferred];

export const ApiV1OfficialPublisherUpdateResponseSchema = type({
  ok: "true",
  publisherId: "string",
  handle: "string",
  "added?": "boolean",
  "removed?": "boolean",
  "officialPublisherId?": "string",
});
export type ApiV1OfficialPublisherUpdateResponse =
  (typeof ApiV1OfficialPublisherUpdateResponseSchema)[inferred];

export const ApiV1SearchResponseSchema = type({
  results: type({
    "id?": "string",
    "source?": '"clawhub"|"skills-sh"',
    slug: "string?",
    ownerHandle: "string|null?",
    displayName: "string?",
    summary: "string|null?",
    version: "string|null?",
    score: "number",
    downloads: "number?",
    updatedAt: "number?",
    owner: type({
      handle: "string|null?",
      displayName: "string|null?",
      image: "string|null?",
      "kind?": '"user"|"org"',
      "official?": "boolean",
    })
      .or("null")
      .optional(),
    "canonicalUrl?": "string",
    "official?": "boolean",
    "featured?": "boolean",
    "links?": {
      canonical: "string",
      source: "string|null",
    },
    "publisher?": type({
      kind: '"user"|"org"',
      handle: "string|null",
      displayName: "string|null",
      image: "string|null",
      official: "boolean",
    }).or("null"),
    "install?": {
      kind: '"clawhub"|"github"|"skills-sh"',
      reference: "string",
      sourceUrl: "string|null",
    },
    "sourceIdentity?": {
      id: "string",
      owner: "string|null",
      repo: "string|null",
      host: "string|null",
      lifetimeInstalls: "number|null",
    },
    "trust?": {
      visibility: '"public"',
      installability: '"installable"',
      clawHubVerdict: "string|null",
      upstreamScanners: "unknown|null",
      sourceFreshness: '"native"|"observed-only"',
    },
    "metrics?": {
      rolling60DayInstalls: "number|null",
      bookmarks: "number|null",
      updatedAt: "number",
    },
  }).array(),
});

export const ApiV1SkillListResponseSchema = type({
  items: type({
    // Custom registries may still serve the earlier, slug-only list shape.
    ownerHandle: "string?",
    slug: "string",
    displayName: "string",
    summary: "string|null?",
    description: "string|null?",
    topics: "string[]?",
    tags: "unknown",
    stats: "unknown",
    createdAt: "number",
    updatedAt: "number",
    latestVersion: type({
      version: "string",
      createdAt: "number",
      changelog: "string",
      license: '"MIT-0"|null?',
    })
      .or("null")
      .optional(),
    metadata: type({
      setup: type({
        key: "string",
        required: "boolean",
      }).array(),
      os: "string[]|null?",
      systems: "string[]|null?",
    })
      .or("null")
      .optional(),
  }).array(),
  nextCursor: "string|null",
});

export const ApiV1SkillResponseSchema = type({
  skill: type({
    slug: "string",
    displayName: "string",
    summary: "string|null?",
    description: "string|null?",
    topics: "string[]?",
    tags: "unknown",
    stats: "unknown",
    createdAt: "number",
    updatedAt: "number",
  }).or("null"),
  latestVersion: type({
    version: "string",
    createdAt: "number",
    changelog: "string",
    license: '"MIT-0"|null?',
  }).or("null"),
  metadata: type({
    setup: type({
      key: "string",
      required: "boolean",
    }).array(),
    os: "string[]|null?",
    systems: "string[]|null?",
  })
    .or("null")
    .optional(),
  owner: type({
    handle: "string|null",
    displayName: "string|null?",
    image: "string|null?",
  }).or("null"),
  moderation: type({
    isSuspicious: "boolean",
    isMalwareBlocked: "boolean",
    verdict: '"clean"|"suspicious"|"malicious"?',
    reasonCodes: "string[]?",
    updatedAt: "number|null?",
    engineVersion: "string|null?",
    summary: "string|null?",
  })
    .or("null")
    .optional(),
});

export const ApiV1SkillScanBatchStatusResponseSchema = type({
  ok: "true",
  total: "number",
  queued: "number",
  running: "number",
  succeeded: "number",
  failed: "number",
  missing: "number",
  terminal: "number",
  done: "boolean",
  failedJobIds: "string[]",
});
export type ApiV1SkillScanBatchStatusResponse =
  (typeof ApiV1SkillScanBatchStatusResponseSchema)[inferred];

export const ApiV1SkillVersionResponseSchema = type({
  version: type({
    version: "string",
    createdAt: "number",
    changelog: "string",
    changelogSource: '"auto"|"user"|null?',
    license: '"MIT-0"|null?',
    files: "unknown?",
  }).or("null"),
  skill: type({
    slug: "string",
    displayName: "string",
  }).or("null"),
});

export const ApiV1BanUserResponseSchema = type({
  ok: "true",
  alreadyBanned: "boolean",
  deletedSkills: "number",
});

export const ApiV1UnbanUserResponseSchema = type({
  ok: "true",
  alreadyUnbanned: "boolean",
  restoredSkills: "number?",
});

export const ApiV1LiftModerationHoldResponseSchema = type({
  ok: "true",
  alreadyCleared: "boolean",
  restoredSkills: "number",
  scheduledSkills: "boolean",
});

export const ApiV1PromotionModelSchema = type({
  modelRef: "string",
  alias: "string?",
  suggestedDefault: "boolean?",
});

export const ApiV1PromotionSchema = type({
  slug: "string",
  title: "string",
  blurb: "string",
  sponsor: "string?",
  status: '"draft"|"active"|"ended"',
  active: "boolean",
  startsAt: "number",
  endsAt: "number",
  provider: "string?",
  authChoiceId: "string?",
  pluginNames: "string[]?",
  models: ApiV1PromotionModelSchema.array(),
  signupUrl: "string?",
  docsUrl: "string?",
  launchPageUrl: "string?",
});
export type ApiV1Promotion = (typeof ApiV1PromotionSchema)[inferred];

export const ApiV1PromotionsListResponseSchema = type({
  promotions: ApiV1PromotionSchema.array(),
  "nextCursor?": "string|null",
});

export const ApiV1PromotionWriteResponseSchema = type({
  ok: "true",
  slug: "string",
  status: '"draft"|"active"|"ended"',
});

export const ClawdisSkillMetadataSchema = type({
  always: "boolean?",
  skillKey: "string?",
  primaryEnv: "string?",
  emoji: "string?",
  homepage: "string?",
  os: "string[]?",
  requires: ClawdisRequiresSchema.optional(),
  install: SkillInstallSpecSchema.array().optional(),
  envVars: EnvVarDeclarationSchema.array().optional(),
});
export type ClawdisSkillMetadata = (typeof ClawdisSkillMetadataSchema)[inferred];
