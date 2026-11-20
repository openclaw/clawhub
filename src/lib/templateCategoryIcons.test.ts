import { TEMPLATE_CATEGORY_DEFINITIONS } from "clawhub-schema/catalogMetadata";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { describe, expect, it } from "vitest";

// Browse filters and other clients use the Lucide icon names from the shared taxonomy.
describe("Template category icons", () => {
  it.each(TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug, icon }) => ({ slug, icon })))(
    "names a real Lucide icon for $slug: $icon",
    ({ icon }) => {
      expect(Object.hasOwn(dynamicIconImports, icon)).toBe(true);
    },
  );
});
