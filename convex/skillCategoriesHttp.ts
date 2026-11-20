import { catalogBrowseIcon, SKILL_CATEGORY_DEFINITIONS } from "clawhub-schema/catalogMetadata";
import { httpAction } from "./_generated/server";
import { json } from "./lib/httpHeaders";

// The static taxonomy is identical for every viewer. The router applies the read rate limit.
const categories = SKILL_CATEGORY_DEFINITIONS.map(({ slug, label, description, icon }) => ({
  slug,
  label,
  description,
  icon: catalogBrowseIcon(slug, icon),
}));

export const get = httpAction(async () =>
  json({ categories }, 200, {
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
  }),
);
