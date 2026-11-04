export const OPENCLAW_EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS = [
    "openclaw.compat.pluginApi",
    "openclaw.build.openclawVersion",
];
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
// OpenClaw resolves entries with path.resolve(packageDir, entry) and rejects any
// that leave the package directory. Mirror that without node:path so browsers
// and the Convex runtime share one implementation. Returns null for escapes.
function resolvePackageEntryPath(value) {
    const slashed = value.trim().replaceAll("\\", "/");
    if (slashed.startsWith("/") || /^[a-z]:\//iu.test(slashed))
        return null;
    const segments = [];
    for (const segment of slashed.split("/")) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..") {
            if (segments.length === 0)
                return null;
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return segments.length > 0 ? segments.join("/") : null;
}
function normalizePackageFilePath(value) {
    return value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}
function packageEntryExtension(entry) {
    const fileName = entry.slice(entry.lastIndexOf("/") + 1);
    const dot = fileName.lastIndexOf(".");
    return dot > 0 ? fileName.slice(dot).toLowerCase() : "";
}
function isTypeScriptRuntimeEntry(value) {
    return [".ts", ".tsx", ".mts", ".cts"].includes(packageEntryExtension(value));
}
// Mirrors OpenClaw's listBuiltRuntimeEntryCandidates (src/plugins/package-entrypoints.ts):
// installed packages never load TypeScript source, only these compiled outputs.
function compiledRuntimeCandidates(entry) {
    const normalized = resolvePackageEntryPath(entry);
    if (!normalized || !isTypeScriptRuntimeEntry(normalized))
        return [];
    const withoutExtension = normalized.replace(/\.[^./]+$/u, "");
    const distBase = withoutExtension.startsWith("src/")
        ? `dist/${withoutExtension.slice("src/".length)}`
        : `dist/${withoutExtension}`;
    const sourceExtension = packageEntryExtension(normalized);
    const outputExtensions = sourceExtension === ".mts"
        ? [".mjs", ".js", ".cjs"]
        : sourceExtension === ".cts"
            ? [".cjs", ".js", ".mjs"]
            : [".js", ".mjs", ".cjs"];
    return [
        distBase,
        ...(withoutExtension.startsWith("src/") ? [`dist/${withoutExtension}`] : []),
        withoutExtension,
    ].flatMap((base) => outputExtensions.map((extension) => `${base}${extension}`));
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
const PUBLISH_ENTRY_FIX = "Build first and publish a local folder or .tgz, or include the runtime file in the GitHub ref.";
// Mirrors OpenClaw's validatePackageExtensionEntriesForInstall for installed
// packages (no TypeScript source fallback): a declared runtime entry must exist;
// otherwise a compiled candidate of a TypeScript entry, or the JavaScript entry itself.
function validateDeclaredEntry(check) {
    const { packageName, packageFiles, entry, runtimeEntry } = check;
    const entryPath = resolvePackageEntryPath(entry);
    // OpenClaw bounds-checks the declared entry even when a runtime entry replaces it.
    if (!entryPath) {
        return {
            fieldPath: check.fieldPath,
            message: `${packageName} declares ${check.fieldPath} entry ${entry}, which points outside the package. Point it at a file inside the published package.`,
        };
    }
    if (runtimeEntry) {
        const runtimePath = resolvePackageEntryPath(runtimeEntry);
        if (runtimePath && packageFiles.has(runtimePath))
            return undefined;
        return {
            fieldPath: check.runtimeFieldPath,
            message: runtimePath
                ? `${packageName} declares ${check.runtimeFieldPath} entry ./${runtimePath}, but that file is missing from the package. ${PUBLISH_ENTRY_FIX}`
                : `${packageName} declares ${check.runtimeFieldPath} entry ${runtimeEntry}, which points outside the package. Point it at a file inside the published package.`,
        };
    }
    const candidates = compiledRuntimeCandidates(entryPath);
    if (candidates.some((candidate) => packageFiles.has(candidate)))
        return undefined;
    if (candidates.length > 0) {
        return {
            fieldPath: check.fieldPath,
            message: `${packageName} requires compiled runtime output for TypeScript entry ${entry}: expected ${candidates.map((candidate) => `./${candidate}`).join(", ")}. ${PUBLISH_ENTRY_FIX}`,
        };
    }
    if (packageFiles.has(entryPath))
        return undefined;
    return {
        fieldPath: check.fieldPath,
        message: `${packageName} declares ${check.fieldPath} entry ./${entryPath}, but that file is missing from the package. OpenClaw cannot load this plugin without it. ${PUBLISH_ENTRY_FIX} Otherwise update package.json ${check.fieldPath} to point at a published file.`,
    };
}
/**
 * Validates package metadata plus the declared OpenClaw entrypoints against the
 * uploaded file list. Entry checks follow OpenClaw's installed-package rules so a
 * release ClawHub accepts is one OpenClaw can load.
 */
export function validateOpenClawExternalCodePluginPackageContents(packageJson, filePaths) {
    const validation = validateOpenClawExternalCodePluginPackageJson(packageJson);
    const { root, openclaw } = readOpenClawBlock(packageJson);
    const name = getTrimmedString(root?.name) ?? "package";
    const packageFiles = new Set(Array.from(filePaths, (filePath) => resolvePackageEntryPath(filePath) ?? normalizePackageFilePath(filePath)));
    const sourceEntries = getTrimmedStringArray(openclaw?.extensions);
    const runtimeEntries = getTrimmedStringArray(openclaw?.runtimeExtensions);
    if (runtimeEntries.length > 0 && runtimeEntries.length !== sourceEntries.length) {
        validation.issues.push({
            fieldPath: "openclaw.runtimeExtensions",
            message: `${name} openclaw.runtimeExtensions length (${runtimeEntries.length}) must match openclaw.extensions length (${sourceEntries.length}).`,
        });
        // Without a one-to-one mapping, report every declared runtime file that is absent.
        for (const runtimeEntry of runtimeEntries) {
            const issue = validateDeclaredEntry({
                packageName: name,
                packageFiles,
                entry: runtimeEntry,
                runtimeEntry,
                fieldPath: "openclaw.extensions",
                runtimeFieldPath: "openclaw.runtimeExtensions",
            });
            if (issue)
                validation.issues.push(issue);
        }
    }
    else {
        for (const [index, entry] of sourceEntries.entries()) {
            const issue = validateDeclaredEntry({
                packageName: name,
                packageFiles,
                entry,
                runtimeEntry: runtimeEntries[index],
                fieldPath: "openclaw.extensions",
                runtimeFieldPath: "openclaw.runtimeExtensions",
            });
            if (issue)
                validation.issues.push(issue);
        }
    }
    const setupEntry = getTrimmedString(openclaw?.setupEntry);
    const runtimeSetupEntry = getTrimmedString(openclaw?.runtimeSetupEntry);
    if (runtimeSetupEntry && !setupEntry) {
        validation.issues.push({
            fieldPath: "openclaw.runtimeSetupEntry",
            message: `${name} declares openclaw.runtimeSetupEntry without openclaw.setupEntry. OpenClaw requires openclaw.setupEntry whenever openclaw.runtimeSetupEntry is set.`,
        });
    }
    else if (setupEntry) {
        const issue = validateDeclaredEntry({
            packageName: name,
            packageFiles,
            entry: setupEntry,
            runtimeEntry: runtimeSetupEntry,
            fieldPath: "openclaw.setupEntry",
            runtimeFieldPath: "openclaw.runtimeSetupEntry",
        });
        if (issue)
            validation.issues.push(issue);
    }
    return validation;
}
//# sourceMappingURL=openclawContract.js.map