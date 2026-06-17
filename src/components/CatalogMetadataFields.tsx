import {
  CATALOG_CATEGORY_LIMIT,
  PLUGIN_CATEGORY_DEFINITIONS,
  SKILL_CATEGORY_DEFINITIONS,
} from "clawhub-schema";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type CatalogMetadataFieldsProps = {
  kind: "skill" | "plugin";
  categories: string[];
  topics: string;
  disabled?: boolean;
  onCategoriesChange: (value: string[]) => void;
  onTopicsChange: (value: string) => void;
};

export function parseCatalogTopicsInput(value: string) {
  return value
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

export function CatalogMetadataFields({
  kind,
  categories: selectedCategories,
  topics,
  disabled,
  onCategoriesChange,
  onTopicsChange,
}: CatalogMetadataFieldsProps) {
  const categories = kind === "skill" ? SKILL_CATEGORY_DEFINITIONS : PLUGIN_CATEGORY_DEFINITIONS;
  const prefix = kind === "skill" ? "skill" : "plugin";
  const selected = new Set(selectedCategories);
  const limitReached = selectedCategories.length >= CATALOG_CATEGORY_LIMIT;

  const toggleCategory = (slug: string) => {
    if (selected.has(slug)) {
      onCategoriesChange(selectedCategories.filter((category) => category !== slug));
      return;
    }
    if (limitReached) return;
    onCategoriesChange([...selectedCategories, slug]);
  };

  return (
    <>
      <fieldset className="catalog-category-fieldset">
        <legend className="catalog-category-legend">
          <span>Categories</span>
          <span className="catalog-category-mode">
            {selectedCategories.length
              ? `${selectedCategories.length}/${CATALOG_CATEGORY_LIMIT}`
              : "Automatic"}
          </span>
        </legend>
        <div className="catalog-category-options">
          {categories.map((category) => {
            const checked = selected.has(category.slug);
            return (
              <label key={category.slug} className="catalog-category-option">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (!checked && limitReached)}
                  onChange={() => toggleCategory(category.slug)}
                />
                <span>{category.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${prefix}Topics`}>Topics</Label>
        <Input
          id={`${prefix}Topics`}
          value={topics}
          disabled={disabled}
          onChange={(event) => onTopicsChange(event.target.value)}
          placeholder="email, calendar, productivity"
        />
      </div>
    </>
  );
}
