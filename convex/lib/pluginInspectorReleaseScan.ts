// Plugin Inspector monitors accepted releases from GitHub Actions, never inside
// a publish. Each accepted plugin release dispatches one targeted run of the
// existing bulk scan workflow; the workflow's nightly sweep covers anything a
// dispatch misses.
export const PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT = "clawhub-plugin-inspector-release-scan";

// Reuses the deployment's existing GitHub event-dispatch switch and App
// credentials. The workflow scans the production site, so only the production
// deployment dispatches; staging, test, and preview deployments rely on nothing.
export function isPluginInspectorReleaseScanDispatchEnabled(env: NodeJS.ProcessEnv = process.env) {
  const deployment = env.CLAWHUB_ENV?.trim();
  return (
    env.SECURITY_SCAN_EVENT_DISPATCH_ENABLED === "1" &&
    (!deployment || deployment === "production") &&
    env.CLAWHUB_PREVIEW !== "1" &&
    Boolean(
      env.GITHUB_APP_ID?.trim() &&
      env.GITHUB_APP_INSTALLATION_ID?.trim() &&
      env.GITHUB_APP_PRIVATE_KEY?.trim(),
    )
  );
}
