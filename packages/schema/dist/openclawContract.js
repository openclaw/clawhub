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
function readOpenClawBlock(packageJson) {
    const root = isRecord(packageJson) ? packageJson : undefined;
    const openclaw = isRecord(root?.openclaw) ? root.openclaw : undefined;
    const compat = isRecord(openclaw?.compat) ? openclaw.compat : undefined;
    const build = isRecord(openclaw?.build) ? openclaw.build : undefined;
    const install = isRecord(openclaw?.install) ? openclaw.install : undefined;
    return { root, compat, build, install };
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
//# sourceMappingURL=openclawContract.js.map