import { TEMPLATE_CATEGORY_DEFINITIONS } from "clawhub-schema/catalogMetadata";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { describe, expect, it } from "vitest";

// Template category icons are Lucide names for whichever client renders the chips. This site
// renders the category as text only, so nothing here would otherwise notice a misspelled name.
describe("Template category icons", () => {
  it.each(TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug, icon }) => ({ slug, icon })))(
    "names a real Lucide icon for $slug: $icon",
    ({ icon }) => {
      expect(Object.hasOwn(dynamicIconImports, icon)).toBe(true);
    },
  );
});
