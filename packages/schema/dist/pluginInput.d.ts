export declare const PLUGIN_BUNDLE_MANIFESTS: readonly [{
    readonly path: ".codex-plugin/plugin.json";
    readonly format: "codex";
}, {
    readonly path: ".claude-plugin/plugin.json";
    readonly format: "claude";
}, {
    readonly path: ".cursor-plugin/plugin.json";
    readonly format: "cursor";
}];
export declare function selectPluginManifest(input: {
    family: unknown;
    paths: string[];
    bundleFormat?: string;
}): {
    readonly path: ".codex-plugin/plugin.json";
    readonly format: "codex";
} | {
    readonly path: ".claude-plugin/plugin.json";
    readonly format: "claude";
} | {
    readonly path: ".cursor-plugin/plugin.json";
    readonly format: "cursor";
} | {
    path: string;
    format: undefined;
};
export declare function bundlePluginRuntimeId(manifest: Record<string, unknown> | undefined): string;
