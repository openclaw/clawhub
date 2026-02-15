import { type } from 'arktype';
export const GlobalConfigSchema = type({
    registry: 'string',
    token: 'string?',
});
export const WellKnownConfigSchema = type({
    apiBase: 'string',
    authBase: 'string?',
    minCliVersion: 'string?',
}).or({
    registry: 'string',
    authBase: 'string?',
    minCliVersion: 'string?',
});
export const LockfileSchema = type({
    version: '1',
    skills: {
        '[string]': {
            version: 'string|null',
            installedAt: 'number',
        },
    },
});
export const ApiCliWhoamiResponseSchema = type({
    user: {
        handle: 'string|null',
    },
});
export const ApiSearchResponseSchema = type({
    results: type({
        slug: 'string?',
        displayName: 'string?',
        version: 'string|null?',
        score: 'number',
    }).array(),
});
export const ApiSkillMetaResponseSchema = type({
    latestVersion: type({
        version: 'string',
    }).optional(),
    skill: 'unknown|null?',
});
export const ApiCliUploadUrlResponseSchema = type({
    uploadUrl: 'string',
});
export const ApiUploadFileResponseSchema = type({
    storageId: 'string',
});
export const CliPublishFileSchema = type({
    path: 'string',
    size: 'number',
    storageId: 'string',
    sha256: 'string',
    contentType: 'string?',
});
export const PublishSourceSchema = type({
    kind: '"github"',
    url: 'string',
    repo: 'string',
    ref: 'string',
    commit: 'string',
    path: 'string',
    importedAt: 'number',
});
export const CliPublishRequestSchema = type({
    slug: 'string',
    displayName: 'string',
    version: 'string',
    changelog: 'string',
    tags: 'string[]?',
    source: PublishSourceSchema.optional(),
    forkOf: type({
        slug: 'string',
        version: 'string?',
    }).optional(),
    files: CliPublishFileSchema.array(),
});
export const ApiCliPublishResponseSchema = type({
    ok: 'true',
    skillId: 'string',
    versionId: 'string',
});
export const CliSkillDeleteRequestSchema = type({
    slug: 'string',
});
export const ApiCliSkillDeleteResponseSchema = type({
    ok: 'true',
});
export const ApiSkillResolveResponseSchema = type({
    match: type({ version: 'string' }).or('null'),
    latestVersion: type({ version: 'string' }).or('null'),
});
export const CliTelemetrySyncRequestSchema = type({
    roots: type({
        rootId: 'string',
        label: 'string',
        skills: type({
            slug: 'string',
            version: 'string|null?',
        }).array(),
    }).array(),
});
export const ApiCliTelemetrySyncResponseSchema = type({
    ok: 'true',
});
export const ApiV1WhoamiResponseSchema = type({
    user: {
        handle: 'string|null',
        displayName: 'string|null?',
        image: 'string|null?',
    },
});
export const ApiV1UserSearchResponseSchema = type({
    items: type({
        userId: 'string',
        handle: 'string|null',
        displayName: 'string|null?',
        name: 'string|null?',
        role: '"admin"|"moderator"|"user"|null?',
    }).array(),
    total: 'number',
});
export const ApiV1SearchResponseSchema = type({
    results: type({
        slug: 'string?',
        displayName: 'string?',
        summary: 'string|null?',
        version: 'string|null?',
        score: 'number',
        updatedAt: 'number?',
    }).array(),
});
export const ApiV1SkillListResponseSchema = type({
    items: type({
        slug: 'string',
        displayName: 'string',
        summary: 'string|null?',
        tags: 'unknown',
        stats: 'unknown',
        createdAt: 'number',
        updatedAt: 'number',
        latestVersion: type({
            version: 'string',
            createdAt: 'number',
            changelog: 'string',
        }).optional(),
    }).array(),
    nextCursor: 'string|null',
});
export const ApiV1SkillResponseSchema = type({
    skill: type({
        slug: 'string',
        displayName: 'string',
        summary: 'string|null?',
        tags: 'unknown',
        stats: 'unknown',
        createdAt: 'number',
        updatedAt: 'number',
    }).or('null'),
    latestVersion: type({
        version: 'string',
        createdAt: 'number',
        changelog: 'string',
    }).or('null'),
    owner: type({
        handle: 'string|null',
        displayName: 'string|null?',
        image: 'string|null?',
    }).or('null'),
    moderation: type({
        isSuspicious: 'boolean',
        isMalwareBlocked: 'boolean',
        verdict: '"clean"|"suspicious"|"malicious"?',
        reasonCodes: 'string[]?',
        updatedAt: 'number|null?',
        engineVersion: 'string|null?',
        summary: 'string|null?',
    })
        .or('null')
        .optional(),
});
export const ApiV1SkillModerationResponseSchema = type({
    moderation: type({
        isSuspicious: 'boolean',
        isMalwareBlocked: 'boolean',
        verdict: '"clean"|"suspicious"|"malicious"',
        reasonCodes: 'string[]',
        updatedAt: 'number|null?',
        engineVersion: 'string|null?',
        summary: 'string|null?',
        legacyReason: 'string|null?',
        evidence: type({
            code: 'string',
            severity: '"info"|"warn"|"critical"',
            file: 'string',
            line: 'number',
            message: 'string',
            evidence: 'string',
        }).array(),
    }).or('null'),
});
export const ApiV1SkillVersionListResponseSchema = type({
    items: type({
        version: 'string',
        createdAt: 'number',
        changelog: 'string',
        changelogSource: '"auto"|"user"|null?',
    }).array(),
    nextCursor: 'string|null',
});
export const ApiV1SkillVersionResponseSchema = type({
    version: type({
        version: 'string',
        createdAt: 'number',
        changelog: 'string',
        changelogSource: '"auto"|"user"|null?',
        files: 'unknown?',
    }).or('null'),
    skill: type({
        slug: 'string',
        displayName: 'string',
    }).or('null'),
});
export const ApiV1SkillResolveResponseSchema = type({
    match: type({ version: 'string' }).or('null'),
    latestVersion: type({ version: 'string' }).or('null'),
});
export const ApiV1PublishResponseSchema = type({
    ok: 'true',
    skillId: 'string',
    versionId: 'string',
});
export const ApiV1DeleteResponseSchema = type({
    ok: 'true',
});
export const ApiV1SetRoleResponseSchema = type({
    ok: 'true',
    role: '"admin"|"moderator"|"user"',
});
export const ApiV1StarResponseSchema = type({
    ok: 'true',
    starred: 'boolean',
    alreadyStarred: 'boolean',
});
export const ApiV1UnstarResponseSchema = type({
    ok: 'true',
    unstarred: 'boolean',
    alreadyUnstarred: 'boolean',
});
export const SkillInstallSpecSchema = type({
    id: 'string?',
    kind: '"brew"|"node"|"go"|"uv"',
    label: 'string?',
    bins: 'string[]?',
    formula: 'string?',
    tap: 'string?',
    package: 'string?',
    module: 'string?',
});
export const NixPluginSpecSchema = type({
    plugin: 'string',
    systems: 'string[]?',
});
export const ClawdbotConfigSpecSchema = type({
    requiredEnv: 'string[]?',
    stateDirs: 'string[]?',
    example: 'string?',
});
export const ClawdisRequiresSchema = type({
    bins: 'string[]?',
    anyBins: 'string[]?',
    env: 'string[]?',
    config: 'string[]?',
});
export const ClawdisSkillMetadataSchema = type({
    always: 'boolean?',
    skillKey: 'string?',
    primaryEnv: 'string?',
    emoji: 'string?',
    homepage: 'string?',
    os: 'string[]?',
    cliHelp: 'string?',
    requires: ClawdisRequiresSchema.optional(),
    install: SkillInstallSpecSchema.array().optional(),
    nix: NixPluginSpecSchema.optional(),
    config: ClawdbotConfigSpecSchema.optional(),
});
//# sourceMappingURL=schemas.js.map