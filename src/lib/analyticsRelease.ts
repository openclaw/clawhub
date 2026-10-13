/** Identify the executing built client asset, without deployment-only metadata. */
export function analyticsReleaseFromModuleUrl(moduleUrl: string) {
  try {
    const url = new URL(moduleUrl);
    const basename = url.pathname.split("/").at(-1) ?? "";
    if (/^https?:$/.test(url.protocol) && /^[\w.-]{1,80}-[\w-]{8}\.js$/.test(basename)) {
      return basename;
    }
  } catch {
    // Development/non-browser modules are not a shipped client identity.
  }
  return "unknown";
}
