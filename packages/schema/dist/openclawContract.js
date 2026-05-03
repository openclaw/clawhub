export const OPENCLAW_EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS = [
    "openclaw.compat.pluginApi",
    "openclaw.build.openclawVersion",
];
const COMPILED_RUNTIME_EXTENSIONS = [".js", ".mjs", ".cjs"];
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function getTrimmedString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function getTrimmedStringArray(value) {
    return Array.isArray(value)
        ? value
            .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
        : [];
}
function normalizePackagePath(value) {
    return value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}
function isTypeScriptRuntimeEntry(value) {
    return /\.(?:c|m)?ts$/u.test(value);
}
function compiledRuntimeCandidates(entry) {
    const normalized = normalizePackagePath(entry);
    const withoutExtension = normalized.replace(/\.[^.]+$/u, "");
    const distBase = normalized.startsWith("src/")
        ? `dist/${normalized.slice("src/".length).replace(/\.[^.]+$/u, "")}`
        : `dist/${withoutExtension}`;
    return [
        ...COMPILED_RUNTIME_EXTENSIONS.map((ext) => `${distBase}${ext}`),
        ...COMPILED_RUNTIME_EXTENSIONS.map((ext) => `${withoutExtension}${ext}`),
    ];
}
function readOpenClawBlock(packageJson) {
    const root = isRecord(packageJson) ? packageJson : undefined;
    const openclaw = isRecord(root?.openclaw) ? root.openclaw : undefined;
    const compat = isRecord(openclaw?.compat) ? openclaw.compat : undefined;
    const build = isRecord(openclaw?.build) ? openclaw.build : undefined;
    const install = isRecord(openclaw?.install) ? openclaw.install : undefined;
    return { root, openclaw, compat, build, install };
}
export function normalizeOpenClawExternalPluginCompatibility(packageJson) {
    const { root, compat, build, install } = readOpenClawBlock(packageJson);
    const version = getTrimmedString(root?.version);
    const minHostVersion = getTrimmedString(install?.minHostVersion);
    const compatibility = {};
    const pluginApi = getTrimmedString(compat?.pluginApi);
    if (pluginApi) {
        compatibility.pluginApiRange = pluginApi;
    }
    const minGatewayVersion = getTrimmedString(compat?.minGatewayVersion) ?? minHostVersion;
    if (minGatewayVersion) {
        compatibility.minGatewayVersion = minGatewayVersion;
    }
    const builtWithOpenClawVersion = getTrimmedString(build?.openclawVersion) ?? version;
    if (builtWithOpenClawVersion) {
        compatibility.builtWithOpenClawVersion = builtWithOpenClawVersion;
    }
    const pluginSdkVersion = getTrimmedString(build?.pluginSdkVersion);
    if (pluginSdkVersion) {
        compatibility.pluginSdkVersion = pluginSdkVersion;
    }
    return Object.keys(compatibility).length > 0 ? compatibility : undefined;
}
export function listMissingOpenClawExternalCodePluginFieldPaths(packageJson) {
    const { compat, build } = readOpenClawBlock(packageJson);
    const missing = [];
    if (!getTrimmedString(compat?.pluginApi)) {
        missing.push("openclaw.compat.pluginApi");
    }
    if (!getTrimmedString(build?.openclawVersion)) {
        missing.push("openclaw.build.openclawVersion");
    }
    return missing;
}
export function validateOpenClawExternalCodePluginPackageJson(packageJson) {
    const issues = listMissingOpenClawExternalCodePluginFieldPaths(packageJson).map((fieldPath) => ({
        fieldPath,
        message: `${fieldPath} is required for external code plugins published to ClawHub.`,
    }));
    return {
        compatibility: normalizeOpenClawExternalPluginCompatibility(packageJson),
        issues,
    };
}
export function validateOpenClawExternalCodePluginPackageContents(packageJson, filePaths) {
    const validation = validateOpenClawExternalCodePluginPackageJson(packageJson);
    const { root, openclaw } = readOpenClawBlock(packageJson);
    const name = getTrimmedString(root?.name) ?? "package";
    const packageFiles = new Set(Array.from(filePaths, normalizePackagePath));
    const sourceEntries = getTrimmedStringArray(openclaw?.extensions);
    const runtimeEntries = getTrimmedStringArray(openclaw?.runtimeExtensions);
    if (runtimeEntries.length > 0 && runtimeEntries.length !== sourceEntries.length) {
        validation.issues.push({
            fieldPath: "openclaw.runtimeExtensions",
            message: `${name} openclaw.runtimeExtensions length (${runtimeEntries.length}) must match openclaw.extensions length (${sourceEntries.length}).`,
        });
    }
    for (const runtimeEntry of runtimeEntries) {
        const normalized = normalizePackagePath(runtimeEntry);
        if (!packageFiles.has(normalized)) {
            validation.issues.push({
                fieldPath: "openclaw.runtimeExtensions",
                message: `${name} runtime extension entry not found: ./${normalized}`,
            });
        }
    }
    if (runtimeEntries.length === 0) {
        for (const sourceEntry of sourceEntries) {
            if (!isTypeScriptRuntimeEntry(sourceEntry))
                continue;
            const candidates = compiledRuntimeCandidates(sourceEntry);
            if (candidates.some((candidate) => packageFiles.has(candidate)))
                continue;
            validation.issues.push({
                fieldPath: "openclaw.extensions",
                message: `${name} requires compiled runtime output for TypeScript entry ${sourceEntry}: expected ${candidates.map((candidate) => `./${candidate}`).join(", ")}`,
            });
        }
    }
    return validation;
}
//# sourceMappingURL=openclawContract.js.map