import { type } from "arktype";
const HttpsUrlSchema = type("string").narrow((value, ctx) => {
    try {
        return new URL(value).protocol === "https:" || ctx.mustBe("an HTTPS URL");
    }
    catch {
        return ctx.mustBe("an HTTPS URL");
    }
});
export const PromotionsFeedModelSchema = type({
    "+": "reject",
    modelRef: "string",
    "alias?": "string",
    "suggestedDefault?": "boolean",
});
export const PromotionsFeedEntrySchema = type({
    "+": "reject",
    type: '"promotion"',
    slug: "string",
    title: "string",
    blurb: "string",
    "sponsor?": "string",
    startsAt: "number",
    endsAt: "number",
    "provider?": "string",
    "authChoiceId?": "string",
    "pluginNames?": "string[]",
    models: PromotionsFeedModelSchema.array(),
    "signupUrl?": HttpsUrlSchema,
    "docsUrl?": HttpsUrlSchema,
    "launchPageUrl?": HttpsUrlSchema,
});
export const PromotionsFeedSchema = type({
    "+": "reject",
    schemaVersion: "number",
    id: "string",
    generatedAt: "string",
    sequence: "number",
    expiresAt: "string",
    "description?": "string",
    entries: PromotionsFeedEntrySchema.array(),
});
/**
 * Cross-repo wire contract with the OpenClaw promotions consumer. Bump this
 * only after matching OpenClaw parser/validation support has shipped,
 * otherwise clients reject the hosted feed.
 */
export const PROMOTIONS_FEED_SCHEMA_VERSION = 1;
export const PROMOTIONS_FEED_ID = "clawhub-promotions";
export const PROMOTIONS_FEED_DESCRIPTION = "Active promotional offers surfaced to OpenClaw clients at runtime.";
export function parsePromotionsFeed(value) {
    const feed = PromotionsFeedSchema.assert(value);
    if (feed.id !== PROMOTIONS_FEED_ID) {
        throw new Error(`Unsupported promotions feed id: ${feed.id}`);
    }
    if (feed.schemaVersion !== PROMOTIONS_FEED_SCHEMA_VERSION) {
        throw new Error(`Unsupported promotions feed schema version: ${feed.schemaVersion}`);
    }
    if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
        throw new Error("Promotions feed sequence must be a non-negative integer");
    }
    if (!Number.isFinite(Date.parse(feed.generatedAt)) ||
        !Number.isFinite(Date.parse(feed.expiresAt))) {
        throw new Error("Promotions feed timestamps must be valid ISO dates");
    }
    if (Date.parse(feed.expiresAt) <= Date.parse(feed.generatedAt)) {
        throw new Error("Promotions feed expiresAt must be after generatedAt");
    }
    for (const entry of feed.entries) {
        if (entry.endsAt <= entry.startsAt) {
            throw new Error(`Promotions feed entry "${entry.slug}" has an inverted window`);
        }
    }
    return feed;
}
export function serializePromotionsFeed(feed) {
    const parsed = parsePromotionsFeed(feed);
    const entries = [...parsed.entries]
        .sort((left, right) => left.slug.localeCompare(right.slug))
        .map((entry) => ({
        type: entry.type,
        slug: entry.slug,
        title: entry.title,
        blurb: entry.blurb,
        ...(entry.sponsor === undefined ? {} : { sponsor: entry.sponsor }),
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        ...(entry.provider === undefined ? {} : { provider: entry.provider }),
        ...(entry.authChoiceId === undefined ? {} : { authChoiceId: entry.authChoiceId }),
        ...(entry.pluginNames === undefined ? {} : { pluginNames: [...entry.pluginNames] }),
        models: [...entry.models]
            .sort((left, right) => left.modelRef.localeCompare(right.modelRef))
            .map((model) => ({
            modelRef: model.modelRef,
            ...(model.alias === undefined ? {} : { alias: model.alias }),
            ...(model.suggestedDefault === undefined
                ? {}
                : { suggestedDefault: model.suggestedDefault }),
        })),
        ...(entry.signupUrl === undefined ? {} : { signupUrl: entry.signupUrl }),
        ...(entry.docsUrl === undefined ? {} : { docsUrl: entry.docsUrl }),
        ...(entry.launchPageUrl === undefined ? {} : { launchPageUrl: entry.launchPageUrl }),
    }));
    return JSON.stringify({
        schemaVersion: parsed.schemaVersion,
        id: parsed.id,
        generatedAt: parsed.generatedAt,
        sequence: parsed.sequence,
        expiresAt: parsed.expiresAt,
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
        entries,
    });
}
//# sourceMappingURL=promotionsFeed.js.map