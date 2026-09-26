import { PLUGIN_CATEGORY_DEFINITIONS, type PluginCategorySlug } from "clawhub-schema";
import reviewedEnglishListings from "./reviewedEnglishPluginListings.json";
import { isEnglishTrendingText } from "./trendingLanguage";

// Canonical package identities also let clients rank their trusted bundled copies.
// Missing or ineligible packages never reserve a visible slot.
const PINNED_PACKAGES: Partial<Record<PluginCategorySlug, readonly string[]>> = {
  channels: [
    "@openclaw/telegram",
    "@openclaw/whatsapp",
    "@openclaw/discord",
    "@openclaw/slack",
    "@openclaw/feishu",
    "@openclaw/qqbot",
  ],
  models: ["@openclaw/openai-provider", "@openclaw/anthropic-provider", "@openclaw/google-plugin"],
  memory: [
    "@honcho-ai/openclaw-honcho",
    "@mem0/openclaw-mem0",
    "@supermemory/openclaw-supermemory",
    "@hyperspell/openclaw-hyperspell",
    "@cognee/cognee-openclaw",
  ],
  voice: ["@openclaw/google-meet", "@openclaw/zoom-meetings", "@openclaw/teams-meetings"],
  web: [
    "@openclaw/brave-plugin",
    "@openclaw/tavily-plugin",
    "@openclaw/firecrawl-plugin",
    "@openclaw/perplexity-plugin",
    "@openclaw/exa-plugin",
    "@apify/apify-openclaw-plugin",
  ],
  "computer-use": ["@openclaw/cua-computer"],
};

export function getPluginDiscoveryPins(category: PluginCategorySlug): readonly string[] {
  return PINNED_PACKAGES[category] ?? [];
}

export function getPluginDiscoveryCategories(homepage = false) {
  return PLUGIN_CATEGORY_DEFINITIONS.filter(
    (category) => !homepage || category.slug !== "other",
  ).map((category, order) => ({
    ...category,
    order,
    pinnedPackages: [...getPluginDiscoveryPins(category.slug)],
  }));
}

// A reviewed exception is bound to the complete listing text. Republishing changed
// text invalidates it; neither an official badge nor a priority pin bypasses language.
export function isEnglishPluginListing(listing: {
  name: string;
  displayName: string;
  summary?: string | null;
}) {
  return (
    isEnglishTrendingText(listing.displayName, listing.summary) ||
    reviewedEnglishListings.some(
      (reviewed) =>
        reviewed.name === listing.name &&
        reviewed.displayName === listing.displayName &&
        reviewed.summary === listing.summary,
    )
  );
}
