import { type inferred } from "arktype";
export declare const PromotionsFeedModelSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    modelRef: string;
    alias?: string | undefined;
    suggestedDefault?: boolean | undefined;
}, {}>;
export type PromotionsFeedModel = (typeof PromotionsFeedModelSchema)[inferred];
export declare const PromotionsFeedEntrySchema: import("arktype/internal/variants/object.ts").ObjectType<{
    type: "promotion";
    slug: string;
    title: string;
    blurb: string;
    startsAt: number;
    endsAt: number;
    models: {
        modelRef: string;
        alias?: string | undefined;
        suggestedDefault?: boolean | undefined;
    }[];
    sponsor?: string | undefined;
    provider?: string | undefined;
    authChoiceId?: string | undefined;
    pluginNames?: string[] | undefined;
    signupUrl?: string | undefined;
    docsUrl?: string | undefined;
    launchPageUrl?: string | undefined;
}, {}>;
export type PromotionsFeedEntry = (typeof PromotionsFeedEntrySchema)[inferred];
export declare const PromotionsFeedSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    schemaVersion: number;
    id: string;
    generatedAt: string;
    sequence: number;
    expiresAt: string;
    entries: {
        type: "promotion";
        slug: string;
        title: string;
        blurb: string;
        startsAt: number;
        endsAt: number;
        models: {
            modelRef: string;
            alias?: string | undefined;
            suggestedDefault?: boolean | undefined;
        }[];
        sponsor?: string | undefined;
        provider?: string | undefined;
        authChoiceId?: string | undefined;
        pluginNames?: string[] | undefined;
        signupUrl?: string | undefined;
        docsUrl?: string | undefined;
        launchPageUrl?: string | undefined;
    }[];
    description?: string | undefined;
}, {}>;
export type PromotionsFeed = (typeof PromotionsFeedSchema)[inferred];
/**
 * Cross-repo wire contract with the OpenClaw promotions consumer. Bump this
 * only after matching OpenClaw parser/validation support has shipped,
 * otherwise clients reject the hosted feed.
 */
export declare const PROMOTIONS_FEED_SCHEMA_VERSION = 1;
export declare const PROMOTIONS_FEED_ID = "clawhub-promotions";
export declare const PROMOTIONS_FEED_DESCRIPTION = "Active promotional offers surfaced to OpenClaw clients at runtime.";
export declare function parsePromotionsFeed(value: unknown): PromotionsFeed;
export declare function serializePromotionsFeed(feed: PromotionsFeed): string;
