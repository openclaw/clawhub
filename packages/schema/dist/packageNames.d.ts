export declare function normalizePackageOwnerHandle(handle: string | null | undefined): string | undefined;
export declare function inferPackageNameScope(name: string): string | undefined;
export declare function getPackageScopeOwnerMismatch(name: string, ownerHandle: string | null | undefined): {
    scope: string;
    selectedOwner: string;
    suggestedName: string;
    message: string;
} | null;
