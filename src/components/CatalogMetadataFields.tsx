import {
  CATALOG_CATEGORY_LIMIT,
  INTERNAL_UNCATEGORIZED_CATEGORY,
  PLUGIN_CATEGORY_DEFINITIONS,
  SKILL_CATEGORY_DEFINITIONS,
} from "clawhub-schema";
import { ChevronDown, Sparkles } from "lucide-react";
import { getCategoryIconComponent } from "../lib/categoryIcons";
import { CatalogTopicInput } from "./CatalogTopicInput";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Label } from "./ui/label";

export { formatCatalogTopicsInput, parseCatalogTopicsInput } from "./CatalogTopicInput";

type CatalogMetadataFieldsProps = {
  kind: "skill" | "plugin";
  idPrefix?: string;
  categories: string[];
  suggestedCategories?: string[];
  topics: string;
  disabled?: boolean;
  onCategoriesChange: (value: string[]) => void;
  onTopicsChange: (value: string) => void;
};

export function CatalogMetadataFields({
  kind,
  idPrefix,
  categories: selectedCategories,
  suggestedCategories,
  topics,
  disabled,
  onCategoriesChange,
  onTopicsChange,
}: CatalogMetadataFieldsProps) {
  const categories = kind === "skill" ? SKILL_CATEGORY_DEFINITIONS : PLUGIN_CATEGORY_DEFINITIONS;
  const prefix = kind === "skill" ? "skill" : "plugin";
  const fieldIdPrefix = idPrefix ?? prefix;
  const selected = new Set(selectedCategories);
  const limitReached = selectedCategories.length >= CATALOG_CATEGORY_LIMIT;
  const selectedLabels = categories
    .filter((category) => selected.has(category.slug))
    .map((category) => category.label);
  const categorySlugs = new Set<string>(categories.map((category) => category.slug));
  const generatedCategories =
    suggestedCategories === undefined
      ? undefined
      : [...new Set(suggestedCategories.filter((category) => categorySlugs.has(category)))]
          .slice(0, CATALOG_CATEGORY_LIMIT)
          .filter((category) => category !== INTERNAL_UNCATEGORIZED_CATEGORY);

  const toggleCategory = (slug: string) => {
    if (selected.has(slug)) {
      onCategoriesChange(selectedCategories.filter((category) => category !== slug));
      return;
    }
    if (slug === INTERNAL_UNCATEGORIZED_CATEGORY) {
      onCategoriesChange([slug]);
      return;
    }
    const specificCategories = selectedCategories.filter(
      (category) => category !== INTERNAL_UNCATEGORIZED_CATEGORY,
    );
    if (specificCategories.length >= CATALOG_CATEGORY_LIMIT) return;
    onCategoriesChange([...specificCategories, slug]);
  };

  const categoryToolbar = (
    <div className="catalog-metadata-field-actions flex items-center gap-2">
      {generatedCategories ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          aria-label="Generate categories"
          onClick={() =>
            onCategoriesChange(
              generatedCategories.length ? generatedCategories : [INTERNAL_UNCATEGORIZED_CATEGORY],
            )
          }
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Generate
        </Button>
      ) : null}
      <span className="text-xs font-medium text-[color:var(--ink-soft)]">
        {selectedCategories.length}/{CATALOG_CATEGORY_LIMIT}
      </span>
    </div>
  );

  return (
    <div className="catalog-metadata-fields col-span-full">
      <div className="catalog-metadata-field flex min-w-0 flex-col gap-2">
        <div className="catalog-metadata-field-header">
          <Label htmlFor={`${fieldIdPrefix}Categories`}>Categories</Label>
          {categoryToolbar}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              id={`${fieldIdPrefix}Categories`}
              type="button"
              disabled={disabled}
              aria-label="Categories"
              className="flex min-h-[44px] w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-input-border bg-input-bg px-3.5 py-space-3 text-sm text-[color:var(--ink)] transition-all duration-[180ms] ease-out focus:outline-none focus:border-input-focus-border focus:shadow-[0_0_0_3px_var(--input-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className={selectedLabels.length ? "truncate" : "truncate text-input-placeholder"}
              >
                {selectedLabels.length ? selectedLabels.join(", ") : "Choose categories"}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="z-[90] w-[var(--radix-dropdown-menu-trigger-width)]"
          >
            {categories.map((category) => {
              const checked = selected.has(category.slug);
              const Icon = getCategoryIconComponent(category.icon);
              return (
                <DropdownMenuCheckboxItem
                  key={category.slug}
                  checked={checked}
                  disabled={
                    disabled ||
                    (!checked &&
                      limitReached &&
                      category.slug !== INTERNAL_UNCATEGORIZED_CATEGORY &&
                      !selected.has(INTERNAL_UNCATEGORIZED_CATEGORY))
                  }
                  onCheckedChange={() => toggleCategory(category.slug)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                    <span className="truncate">{category.label}</span>
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="catalog-metadata-field flex min-w-0 flex-col gap-2">
        <div className="catalog-metadata-field-header">
          <Label htmlFor={`${fieldIdPrefix}Topics`}>Topics</Label>
          <div
            className="catalog-metadata-field-actions min-h-[30px] shrink-0"
            aria-hidden="true"
          />
        </div>
        <CatalogTopicInput
          id={`${fieldIdPrefix}Topics`}
          value={topics}
          disabled={disabled}
          onChange={onTopicsChange}
        />
      </div>
    </div>
  );
}
