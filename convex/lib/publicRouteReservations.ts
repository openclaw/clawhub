import { OPENCLAW_EXTENSION_SLUG_TO_PACKAGE } from "clawhub-schema";

const RESERVED_PUBLIC_OWNER_HANDLES = new Set(["admin", "clawhub", "docs", "plugins", "skills"]);
const RESERVED_OPENCLAW_EXTENSION_HANDLES = new Set(
  Object.keys(OPENCLAW_EXTENSION_SLUG_TO_PACKAGE),
);
const RESERVED_UNSCOPED_PACKAGE_NAMES = new Set(["publish"]);

export function isReservedPublicOwnerHandle(handle: string | undefined | null) {
  return Boolean(handle && RESERVED_PUBLIC_OWNER_HANDLES.has(handle.trim().toLowerCase()));
}

export function isReservedOpenClawExtensionHandle(handle: string | undefined | null) {
  return Boolean(handle && RESERVED_OPENCLAW_EXTENSION_HANDLES.has(handle.trim().toLowerCase()));
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
