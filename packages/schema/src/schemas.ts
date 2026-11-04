import { type inferred, type } from "arktype";
import { SkillPlatformLicenseSchema } from "./license.js";
import {
  type ClawdisRequires,
  ClawdisRequiresSchema,
  type EnvVarDeclaration,
  EnvVarDeclarationSchema,
  type SkillInstallSpec,
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
      pinned: "boolean?",
      pinReason: "string?",
    },
  },
});
export type Lockfile = (typeof LockfileSchema)[inferred];

export const ApiV1SearchResponseSchema = type({
  results: type({
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
    })
      .or("null")
      .optional(),
  }).array(),
});

export const ApiV1SkillListResponseSchema = type({
  items: type({
    requiresIntermediary: "boolean|null?",
    intermediaryDetails: "string|null?",
    ownerHandle: "string",
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
      license: SkillPlatformLicenseSchema.or("null").optional(),
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
  }).array(),
  nextCursor: "string|null",
});

export const ApiV1SkillResponseSchema = type({
  requiresIntermediary: "boolean|null?",
  intermediaryDetails: "string|null?",
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
    license: SkillPlatformLicenseSchema.or("null").optional(),
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
  // Optional for clients talking to servers that predate local worker assignments.
  queuedJobIds: "string[]?",
});
export type ApiV1SkillScanBatchStatusResponse =
  (typeof ApiV1SkillScanBatchStatusResponseSchema)[inferred];

export const SecurityStatusSchema = type({
  status: '"clean" | "suspicious" | "malicious" | "pending" | "error"',
  hasWarnings: "boolean",
  checkedAt: "number|null",
  model: "string|null",
});

export const ApiV1SkillVersionResponseSchema = type({
  version: type({
    requiresIntermediary: "boolean|null?",
    intermediaryDetails: "string|null?",
    version: "string",
    createdAt: "number",
    changelog: "string",
    changelogSource: '"auto"|"user"|null?',
    license: SkillPlatformLicenseSchema.or("null").optional(),
    files: "unknown?",
    security: SecurityStatusSchema.optional(),
  }).or("null"),
  skill: type({
    slug: "string",
    displayName: "string",
  }).or("null"),
});

export const NixPluginSpecSchema = type({
  plugin: "string",
  systems: "string[]?",
});
export type NixPluginSpec = (typeof NixPluginSpecSchema)[inferred];

export const ClawdbotConfigSpecSchema = type({
  requiredEnv: "string[]?",
  stateDirs: "string[]?",
  example: "string?",
});
export type ClawdbotConfigSpec = (typeof ClawdbotConfigSpecSchema)[inferred];

export const DependencyDeclarationSchema = type({
  name: "string",
  type: '"pip"|"npm"|"brew"|"go"|"cargo"|"apt"|"other"',
  version: "string?",
  url: "string?",
  repository: "string?",
});
export type DependencyDeclaration = (typeof DependencyDeclarationSchema)[inferred];

export const SkillLinksSchema = type({
  homepage: "string?",
  repository: "string?",
  documentation: "string?",
  changelog: "string?",
});
export type SkillLinks = (typeof SkillLinksSchema)[inferred];

export const ClawdisSkillMetadataSchema = type({
  always: "boolean?",
  skillKey: "string?",
  primaryEnv: "string?",
  emoji: "string?",
  homepage: "string?",
  os: "string[]?",
  cliHelp: "string?",
  requires: ClawdisRequiresSchema.optional(),
  install: SkillInstallSpecSchema.array().optional(),
  nix: NixPluginSpecSchema.optional(),
  config: ClawdbotConfigSpecSchema.optional(),
  envVars: EnvVarDeclarationSchema.array().optional(),
  dependencies: DependencyDeclarationSchema.array().optional(),
  author: "string?",
  links: SkillLinksSchema.optional(),
});
// Explicit interface because ArkType's [inferred] doesn't resolve all fields for TS.
// The _ClawdisSkillMetadataCheck below will fail to compile if this drifts from the schema.
export type ClawdisSkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  cliHelp?: string;
  requires?: ClawdisRequires;
  install?: SkillInstallSpec[];
  nix?: NixPluginSpec;
  config?: ClawdbotConfigSpec;
  envVars?: EnvVarDeclaration[];
  dependencies?: DependencyDeclaration[];
  author?: string;
  links?: SkillLinks;
};
type _ClawdisInferred = (typeof ClawdisSkillMetadataSchema)[inferred];
type _AssertExactKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
type _ClawdisKeysMatch = _AssertExactKeys<ClawdisSkillMetadata, _ClawdisInferred>;
// If this line errors, ClawdisSkillMetadata is out of sync with ClawdisSkillMetadataSchema
const _clawdisKeysCheck: _ClawdisKeysMatch = true;
void _clawdisKeysCheck;
