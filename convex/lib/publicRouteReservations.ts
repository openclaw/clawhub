/**
 * Handles and package names that are reserved for ClawHub platform routes.
 *
 * RESERVED_PUBLIC_OWNER_HANDLES: every top-level path segment that exists as
 * a real app route and would shadow the `/$owner` dynamic catch-all if a user
 * were able to register it as a publisher handle.
 *
 * Add entries here whenever a new top-level route is added to src/routes/.
 */
const RESERVED_PUBLIC_OWNER_HANDLES = new Set([
  // Content browsing
  "skills",
  "souls",
  "plugins",
  "packages",
  "publishers",
  "orgs",

  // Publisher / user profile shortlinks
  "p",
  "u",

  // User-facing flows
  "search",
  "import",
  "upload",
  "publish-skill",
  "publish-plugin",
  "stars",
  "dashboard",
  "settings",

  // Admin / platform-internal
  "admin",
  "management",
  "audits",

  // Informational / static
  "docs",
  "cli",

  // Auth / user account
  "user",
  "users",
]);

/**
 * Unscoped package names that are reserved for ClawHub routes or CLI commands.
 * Scoped packages (e.g. @scope/publish) are not affected.
 */
const RESERVED_UNSCOPED_PACKAGE_NAMES = new Set(["publish"]);

export function isReservedPublicOwnerHandle(handle: string | undefined | null) {
  return Boolean(handle && RESERVED_PUBLIC_OWNER_HANDLES.has(handle.trim().toLowerCase()));
}

export function isReservedUnscopedPackageName(name: string | undefined | null) {
  return Boolean(name && RESERVED_UNSCOPED_PACKAGE_NAMES.has(name.trim().toLowerCase()));
}

export function formatReservedPublicOwnerHandleMessage(handle: string) {
  return `Handle "@${handle}" is reserved for ClawHub routes. Choose a different handle.`;
}

export function formatReservedUnscopedPackageNameMessage(name: string) {
  return `Package name "${name}" is reserved for ClawHub routes. Use a scoped name or choose a different package name.`;
}
