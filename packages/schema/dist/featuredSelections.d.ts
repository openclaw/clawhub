export declare const FeaturedEditorialSaveSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    expectedRevision: number;
    items: {
        id: string;
        name: string;
        displayName: string;
        reason: string;
    }[];
}, {}>;
export declare const FeaturedSelectionPublishSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    reportId: string;
    expectedEditorialRevision: number;
    expectedPublicationAt: number | null;
    periodStart: number;
    periodEnd: number;
    items: {
        id: string;
        version: string;
        selectionBasis: "editorial" | "telemetry";
        reason: string;
        installs30d?: number | undefined;
        installs7d?: number | undefined;
    }[];
    dryRun: boolean;
}, {}>;
