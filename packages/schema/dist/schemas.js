import { type } from "arktype";
import { SkillPlatformLicenseSchema } from "./license.js";
import { ClawdisRequiresSchema, EnvVarDeclarationSchema, SkillInstallSpecSchema, } from "./schemaShared.js";
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
export const ClawdbotConfigSpecSchema = type({
    requiredEnv: "string[]?",
    stateDirs: "string[]?",
    example: "string?",
});
export const DependencyDeclarationSchema = type({
    name: "string",
    type: '"pip"|"npm"|"brew"|"go"|"cargo"|"apt"|"other"',
    version: "string?",
    url: "string?",
    repository: "string?",
});
export const SkillLinksSchema = type({
    homepage: "string?",
    repository: "string?",
    documentation: "string?",
    changelog: "string?",
});
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
// If this line errors, ClawdisSkillMetadata is out of sync with ClawdisSkillMetadataSchema
const _clawdisKeysCheck = true;
void _clawdisKeysCheck;
//# sourceMappingURL=schemas.js.map