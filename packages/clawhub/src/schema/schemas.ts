import { type inferred, type } from "arktype";

export const GlobalConfigSchema = type({
  registry: "string",
  token: "string?",
});
export type GlobalConfig = (typeof GlobalConfigSchema)[inferred];

export const WellKnownConfigSchema = type({
  apiBase: "string",
  authBase: "string?",
  minCliVersion: "string?",
}).or({
  registry: "string",
  authBase: "string?",
  minCliVersion: "string?",
});
export type WellKnownConfig = (typeof WellKnownConfigSchema)[inferred];

export const LockfileSchema = type({
  version: "1",
  skills: {
    "[string]": {
      version: "string|null",
      installedAt: "number",
      pinned: "boolean?",
      pinReason: "string?",
    },
  },
});
export type Lockfile = (typeof LockfileSchema)[inferred];

export const ApiCliWhoamiResponseSchema = type({
  user: {
    handle: "string|null",
  },
});

export const ApiSearchResponseSchema = type({
  results: type({
    slug: "string?",
    displayName: "string?",
    version: "string|null?",
    score: "number",
  }).array(),
});

export const ApiSkillMetaResponseSchema = type({
  latestVersion: type({
    version: "string",
  }).optional(),
  skill: "unknown|null?",
});

export const ApiCliUploadUrlResponseSchema = type({
  uploadUrl: "string",
});

export const ApiUploadFileResponseSchema = type({
  storageId: "string",
});

export const CliPublishFileSchema = type({
  path: "string",
  size: "number",
  storageId: "string",
  sha256: "string",
  contentType: "string?",
});
export type CliPublishFile = (typeof CliPublishFileSchema)[inferred];

export const PublishSourceSchema = type({
  kind: '"github"',
  url: "string",
  repo: "string",
  ref: "string",
  commit: "string",
  path: "string",
  importedAt: "number",
});

export const CliPublishRequestSchema = type({
  slug: "string",
  displayName: "string",
  ownerHandle: "string?",
  migrateOwner: "boolean?",
  version: "string",
  changelog: "string",
  clawScanNote: "string?",
  acceptLicenseTerms: "boolean?",
  tags: "string[]?",
  source: PublishSourceSchema.optional(),
  forkOf: type({
    slug: "string",
    version: "string?",
  }).optional(),
  files: CliPublishFileSchema.array(),
});
export type CliPublishRequest = (typeof CliPublishRequestSchema)[inferred];

export const ApiCliPublishResponseSchema = type({
  ok: "true",
  skillId: "string",
  versionId: "string",
});

export const CliSkillDeleteRequestSchema = type({
  slug: "string",
  reason: "string?",
});
export type CliSkillDeleteRequest = (typeof CliSkillDeleteRequestSchema)[inferred];

export const ApiCliSkillDeleteResponseSchema = type({
  ok: "true",
  slugReservedUntil: "number?",
});

export const ApiSkillResolveResponseSchema = type({
  match: type({ version: "string" }).or("null"),
  latestVersion: type({ version: "string" }).or("null"),
});

export const CliTelemetrySyncRequestSchema = type({
  roots: type({
    rootId: "string",
    label: "string",
    skills: type({
      slug: "string",
      version: "string|null?",
    }).array(),
  }).array(),
});
export type CliTelemetrySyncRequest = (typeof CliTelemetrySyncRequestSchema)[inferred];

export const ApiCliTelemetrySyncResponseSchema = type({
  ok: "true",
});

export const ApiV1WhoamiResponseSchema = type({
  user: {
    handle: "string|null",
    displayName: "string|null?",
    image: "string|null?",
    role: '"admin"|"moderator"|"user"|null?',
  },
});

export const ApiV1UserSearchResponseSchema = type({
  items: type({
    userId: "string",
    handle: "string|null",
    displayName: "string|null?",
    name: "string|null?",
    role: '"admin"|"moderator"|"user"|null?',
  }).array(),
  total: "number",
});

export const ApiV1PublisherCreateResponseSchema = type({
  ok: "true",
  publisherId: "string",
  handle: "string",
  created: "true",
  trusted: "false",
});
export type ApiV1PublisherCreateResponse = (typeof ApiV1PublisherCreateResponseSchema)[inferred];

export const ApiV1SearchResponseSchema = type({
  results: type({
    slug: "string?",
    displayName: "string?",
    summary: "string|null?",
    version: "string|null?",
    score: "number",
    updatedAt: "number?",
    ownerHandle: "string|null?",
    owner: type({
      handle: "string|null?",
      displayName: "string|null?",
      image: "string|null?",
    })
      .or("null")
      .optional(),
  }).array(),
});

export const ApiV1SkillListResponseSchema = type({
  items: type({
    slug: "string",
    displayName: "string",
    summary: "string|null?",
    tags: "unknown",
    stats: "unknown",
    createdAt: "number",
    updatedAt: "number",
    latestVersion: type({
      version: "string",
      createdAt: "number",
      changelog: "string",
      license: '"MIT-0"|null?',
    }).optional(),
  }).array(),
  nextCursor: "string|null",
});

export const ApiV1SkillResponseSchema = type({
  skill: type({
    slug: "string",
    displayName: "string",
    summary: "string|null?",
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

export const ApiV1SkillModerationResponseSchema = type({
  moderation: type({
    isSuspicious: "boolean",
    isMalwareBlocked: "boolean",
    verdict: '"clean"|"suspicious"|"malicious"',
    reasonCodes: "string[]",
    updatedAt: "number|null?",
    engineVersion: "string|null?",
    summary: "string|null?",
    legacyReason: "string|null?",
    evidence: type({
      code: "string",
      severity: '"info"|"warn"|"critical"',
      file: "string",
      line: "number",
      message: "string",
      evidence: "string",
    }).array(),
  }).or("null"),
});

export const SkillReportStatusSchema = type('"open"|"confirmed"|"dismissed"');
export type SkillReportStatus = (typeof SkillReportStatusSchema)[inferred];
export const SkillReportFinalActionSchema = type('"none"|"hide"');
export type SkillReportFinalAction = (typeof SkillReportFinalActionSchema)[inferred];

export const SkillReportListStatusSchema = SkillReportStatusSchema.or('"all"');
export type SkillReportListStatus = (typeof SkillReportListStatusSchema)[inferred];

export const SkillAppealStatusSchema = type('"open"|"accepted"|"rejected"');
export type SkillAppealStatus = (typeof SkillAppealStatusSchema)[inferred];
export const SkillAppealFinalActionSchema = type('"none"|"restore"');
export type SkillAppealFinalAction = (typeof SkillAppealFinalActionSchema)[inferred];

export const SkillAppealListStatusSchema = SkillAppealStatusSchema.or('"all"');
export type SkillAppealListStatus = (typeof SkillAppealListStatusSchema)[inferred];

export const SkillAppealRequestSchema = type({
  version: "string?",
  message: "string",
});
export type SkillAppealRequest = (typeof SkillAppealRequestSchema)[inferred];

export const ApiV1SkillReportResponseSchema = type({
  ok: "true",
  reported: "boolean",
  alreadyReported: "boolean",
  reportId: "string",
  skillId: "string",
  reportCount: "number",
});
export type ApiV1SkillReportResponse = (typeof ApiV1SkillReportResponseSchema)[inferred];

export const ApiV1SkillAppealResponseSchema = type({
  ok: "true",
  submitted: "boolean",
  alreadyOpen: "boolean",
  appealId: "string",
  skillId: "string",
  status: SkillAppealStatusSchema,
});
export type ApiV1SkillAppealResponse = (typeof ApiV1SkillAppealResponseSchema)[inferred];

export const SkillReportTriageRequestSchema = type({
  status: SkillReportStatusSchema,
  note: "string?",
  finalAction: SkillReportFinalActionSchema.optional(),
});
export type SkillReportTriageRequest = (typeof SkillReportTriageRequestSchema)[inferred];

export const SkillAppealResolveRequestSchema = type({
  status: SkillAppealStatusSchema,
  note: "string?",
  finalAction: SkillAppealFinalActionSchema.optional(),
});
export type SkillAppealResolveRequest = (typeof SkillAppealResolveRequestSchema)[inferred];

export const ApiV1SkillReportListResponseSchema = type({
  items: type({
    reportId: "string",
    skillId: "string",
    skillVersionId: "string|null?",
    slug: "string",
    displayName: "string",
    version: "string|null?",
    reason: "string|null?",
    status: SkillReportStatusSchema,
    createdAt: "number",
    reporter: type({
      userId: "string",
      handle: "string|null?",
      displayName: "string|null?",
    }),
    triagedAt: "number|null?",
    triagedBy: "string|null?",
    triageNote: "string|null?",
    actionTaken: SkillReportFinalActionSchema.or("null").optional(),
  }).array(),
  nextCursor: "string|null",
  done: "boolean",
});
export type ApiV1SkillReportListResponse = (typeof ApiV1SkillReportListResponseSchema)[inferred];

export const ApiV1SkillReportTriageResponseSchema = type({
  ok: "true",
  reportId: "string",
  skillId: "string",
  status: SkillReportStatusSchema,
  reportCount: "number",
  actionTaken: SkillReportFinalActionSchema.optional(),
});
export type ApiV1SkillReportTriageResponse =
  (typeof ApiV1SkillReportTriageResponseSchema)[inferred];

export const ApiV1SkillAppealListResponseSchema = type({
  items: type({
    appealId: "string",
    skillId: "string",
    skillVersionId: "string|null?",
    slug: "string",
    displayName: "string",
    version: "string|null?",
    message: "string",
    status: SkillAppealStatusSchema,
    createdAt: "number",
    submitter: type({
      userId: "string",
      handle: "string|null?",
      displayName: "string|null?",
    }),
    resolvedAt: "number|null?",
    resolvedBy: "string|null?",
    resolutionNote: "string|null?",
    actionTaken: SkillAppealFinalActionSchema.or("null").optional(),
  }).array(),
  nextCursor: "string|null",
  done: "boolean",
});
export type ApiV1SkillAppealListResponse = (typeof ApiV1SkillAppealListResponseSchema)[inferred];

export const ApiV1SkillAppealResolveResponseSchema = type({
  ok: "true",
  appealId: "string",
  skillId: "string",
  status: SkillAppealStatusSchema,
  actionTaken: SkillAppealFinalActionSchema.optional(),
});
export type ApiV1SkillAppealResolveResponse =
  (typeof ApiV1SkillAppealResolveResponseSchema)[inferred];

export const ApiV1SkillRescanResponseSchema = type({
  ok: "true",
  slug: "string",
  version: "string",
  skillId: "string",
  skillVersionId: "string",
  jobId: "string",
  alreadyQueued: "boolean",
});
export type ApiV1SkillRescanResponse = (typeof ApiV1SkillRescanResponseSchema)[inferred];

export const ApiV1SkillVersionListResponseSchema = type({
  items: type({
    version: "string",
    createdAt: "number",
    changelog: "string",
    changelogSource: '"auto"|"user"|null?',
  }).array(),
  nextCursor: "string|null",
});

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

export const ApiV1SkillResolveResponseSchema = type({
  match: type({ version: "string" }).or("null"),
  latestVersion: type({ version: "string" }).or("null"),
});

export const ApiV1PublishResponseSchema = type({
  ok: "true",
  skillId: "string",
  versionId: "string",
});

export const ApiV1DeleteResponseSchema = type({
  ok: "true",
  slugReservedUntil: "number?",
});

export const ApiV1SkillRenameResponseSchema = type({
  ok: "true",
  slug: "string",
  previousSlug: "string",
});

export const ApiV1SkillMergeResponseSchema = type({
  ok: "true",
  sourceSlug: "string",
  targetSlug: "string",
});

export const ApiV1TransferRequestResponseSchema = type({
  ok: "true",
  transferId: "string?",
  toUserHandle: "string?",
  toPublisherHandle: "string?",
  skillSlug: "string?",
  expiresAt: "number?",
  transferred: "boolean?",
});

export const ApiV1TransferDecisionResponseSchema = type({
  ok: "true",
  skillSlug: "string?",
});

export const ApiV1TransferListResponseSchema = type({
  transfers: type({
    _id: "string",
    skill: type({
      _id: "string",
      slug: "string",
      displayName: "string",
    }),
    fromUser: type({
      _id: "string",
      handle: "string|null",
      displayName: "string|null",
    }).optional(),
    toUser: type({
      _id: "string",
      handle: "string|null",
      displayName: "string|null",
    }).optional(),
    message: "string?",
    requestedAt: "number",
    expiresAt: "number",
  }).array(),
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

export const ApiV1ReclassifyBanResponseSchema = type({
  ok: "true",
  dryRun: "boolean",
  userId: "string",
  handle: "string|null",
  previousReason: "string|null",
  nextReason: "string",
  changed: "boolean",
});

export const ApiV1RemediateAutobansResponseSchema = type({
  ok: "true",
  dryRun: "boolean",
  scanned: "number",
  wouldUnban: "number",
  unbanned: "number",
  skipped: "number",
  restoredSkills: "number",
  restoredPackages: "number",
  items: "unknown[]",
  "nextCursor?": "string|null",
  "done?": "boolean",
});

export const ApiV1SetRoleResponseSchema = type({
  ok: "true",
  role: '"admin"|"moderator"|"user"',
});

export const ApiV1StarResponseSchema = type({
  ok: "true",
  starred: "boolean",
  alreadyStarred: "boolean",
});

export const ApiV1UnstarResponseSchema = type({
  ok: "true",
  unstarred: "boolean",
  alreadyUnstarred: "boolean",
});

export const SkillInstallSpecSchema = type({
  id: "string?",
  kind: '"brew"|"node"|"go"|"uv"',
  label: "string?",
  bins: "string[]?",
  formula: "string?",
  tap: "string?",
  package: "string?",
  module: "string?",
});
export type SkillInstallSpec = (typeof SkillInstallSpecSchema)[inferred];

export const ClawdisRequiresSchema = type({
  bins: "string[]?",
  anyBins: "string[]?",
  env: "string[]?",
  config: "string[]?",
});
export type ClawdisRequires = (typeof ClawdisRequiresSchema)[inferred];

export const EnvVarDeclarationSchema = type({
  name: "string",
  required: "boolean?",
  description: "string?",
});
export type EnvVarDeclaration = (typeof EnvVarDeclarationSchema)[inferred];

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
