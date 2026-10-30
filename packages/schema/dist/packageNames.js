import { DocsLinks } from "./docsLinks.js";
export function normalizePackageOwnerHandle(handle) {
    const normalized = handle?.trim().replace(/^@+/, "").toLowerCase();
    return normalized || undefined;
}
export function inferPackageNameScope(name) {
    return /^@([^/]+)\//.exec(name.trim().toLowerCase())?.[1];
}
export function getPackageScopeOwnerMismatch(name, ownerHandle) {
    const scope = inferPackageNameScope(name);
    const selectedOwner = normalizePackageOwnerHandle(ownerHandle);
    if (!scope || !selectedOwner || scope === selectedOwner)
        return null;
    const packageSlug = name.split("/").pop()?.trim() || "plugin-name";
    return {
        scope,
        selectedOwner,
        suggestedName: `@${selectedOwner}/${packageSlug}`,
        message: `Package scope "@${scope}" must match selected owner "@${selectedOwner}". Publish as "@${scope}" or rename this package to "@${selectedOwner}/${packageSlug}". More info: ${DocsLinks.clawhub.packageScopeFaq}`,
    };
}
//# sourceMappingURL=packageNames.js.map