import rootPackageJson from "../../package.json";

// The pinned Inspector version identifies publish-time outcomes even when the
// Node action died before it could report its own metadata.
export function getBundledPackageInspectorVersion() {
  return (
    process.env.CLAWHUB_PLUGIN_INSPECTOR_VERSION?.trim() ||
    rootPackageJson.dependencies["@openclaw/plugin-inspector"]
  );
}
