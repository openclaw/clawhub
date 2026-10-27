export const PLUGIN_BUNDLE_MANIFESTS = [
    { path: ".codex-plugin/plugin.json", format: "codex" },
    { path: ".claude-plugin/plugin.json", format: "claude" },
    { path: ".cursor-plugin/plugin.json", format: "cursor" },
];
export function selectPluginManifest(input) {
    const markers = PLUGIN_BUNDLE_MANIFESTS.filter((marker) => input.paths.includes(marker.path));
    if (input.family === "code-plugin") {
        if (input.bundleFormat !== undefined)
            throw new Error("Bundle format requires the bundle-plugin family");
        if (!input.paths.includes("openclaw.plugin.json")) {
            throw new Error("openclaw.plugin.json is required for code-plugin packages");
        }
        return { path: "openclaw.plugin.json", format: undefined };
    }
    if (input.family !== "bundle-plugin") {
        throw new Error("Unsupported plugin input family");
    }
    if (markers.length !== 1) {
        throw new Error("bundle-plugin requires exactly one supported bundle manifest");
    }
    const marker = markers[0];
    if (input.bundleFormat !== undefined && input.bundleFormat !== marker.format) {
        throw new Error("Claimed bundle format does not match the bundle manifest");
    }
    return marker;
}
export function bundlePluginRuntimeId(manifest) {
    const rawName = typeof manifest?.name === "string" ? manifest.name : "";
    const name = rawName.trim();
    if (!name)
        throw new Error("bundle manifest must declare a name");
    const hasControl = Array.from(rawName).some((character) => {
        const characterCode = character.charCodeAt(0);
        return characterCode < 0x20 || characterCode === 0x7f;
    });
    if (rawName.includes("/") ||
        rawName.includes("\\") ||
        hasControl ||
        name === "." ||
        name === "..") {
        throw new Error("bundle manifest has an unsafe name");
    }
    const runtimeId = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (!runtimeId)
        throw new Error("bundle manifest name has no canonical identity");
    return runtimeId;
}
//# sourceMappingURL=pluginInput.js.map