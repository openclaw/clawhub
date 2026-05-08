const RESERVED_PUBLIC_OWNER_HANDLES = new Set(["plugins", "skills"]);
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
