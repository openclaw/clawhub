import { type inferred } from "arktype";
export declare const FeedRepresentationSchema: import("arktype/internal/variants/string.ts").StringType<"publisher" | "catalog", {}>;
export type FeedRepresentation = (typeof FeedRepresentationSchema)[inferred];
export declare const FeedItemKindSchema: import("arktype/internal/variants/string.ts").StringType<"skill" | "plugin", {}>;
export type FeedItemKind = (typeof FeedItemKindSchema)[inferred];
export declare const FeedItemWatchSourceSchema: import("arktype/internal/variants/string.ts").StringType<"explicit" | "installed-sync", {}>;
export type FeedItemWatchSource = (typeof FeedItemWatchSourceSchema)[inferred];
export declare const FeedItemWatchRequestSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    feedId: "clawhub-official";
    representation: "catalog";
    itemKind: "plugin";
    itemId: string;
} | {
    feedId: "clawhub-official-skills";
    representation: "catalog";
    itemKind: "skill";
    itemId: string;
}, {}>;
export type FeedItemWatchRequest = (typeof FeedItemWatchRequestSchema)[inferred];
export declare const FeedItemWatchSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    watchId: string;
    feedId: string;
    representation: "publisher" | "catalog";
    itemKind: "skill" | "plugin";
    itemId: string;
    source: "explicit" | "installed-sync";
    createdAt: number;
    updatedAt: number;
}, {}>;
export type FeedItemWatch = (typeof FeedItemWatchSchema)[inferred];
export declare const FeedNotificationReasonSchema: import("arktype/internal/variants/string.ts").StringType<"blocked" | "updated" | "removed" | "security-state-changed", {}>;
export type FeedNotificationReason = (typeof FeedNotificationReasonSchema)[inferred];
export declare const FeedNotificationInboxItemSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    notificationId: string;
    eventId: string;
    feedId: string;
    representation: "publisher" | "catalog";
    itemKind: "skill" | "plugin";
    itemId: string;
    sequence: number;
    reason: "blocked" | "updated" | "removed" | "security-state-changed";
    signedStateUrl: string;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    readAt?: number | undefined;
    dismissedAt?: number | undefined;
}, {}>;
export type FeedNotificationInboxItem = (typeof FeedNotificationInboxItemSchema)[inferred];
export declare const FeedItemWatchListSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    items: {
        watchId: string;
        feedId: string;
        representation: "publisher" | "catalog";
        itemKind: "skill" | "plugin";
        itemId: string;
        source: "explicit" | "installed-sync";
        createdAt: number;
        updatedAt: number;
    }[];
    nextCursor: string | null;
}, {}>;
export type FeedItemWatchList = (typeof FeedItemWatchListSchema)[inferred];
export declare const FeedNotificationInboxListSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: true;
    items: {
        notificationId: string;
        eventId: string;
        feedId: string;
        representation: "publisher" | "catalog";
        itemKind: "skill" | "plugin";
        itemId: string;
        sequence: number;
        reason: "blocked" | "updated" | "removed" | "security-state-changed";
        signedStateUrl: string;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
        readAt?: number | undefined;
        dismissedAt?: number | undefined;
    }[];
    nextCursor: string | null;
}, {}>;
export type FeedNotificationInboxList = (typeof FeedNotificationInboxListSchema)[inferred];
