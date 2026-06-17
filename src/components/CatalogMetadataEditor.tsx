import {
  CATALOG_CATEGORY_LIMIT,
  INTERNAL_UNCATEGORIZED_CATEGORY,
  isPluginCategorySlug,
  isSkillCategorySlug,
} from "clawhub-schema";
import { useEffect, useState } from "react";
import { getUserFacingConvexError } from "../lib/convexError";
import {
  CatalogMetadataFields,
  formatCatalogTopicsInput,
  parseCatalogTopicsInput,
} from "./CatalogMetadataFields";
import { Button } from "./ui/button";

type CatalogMetadataEditorProps = {
  kind: "skill" | "plugin";
  categories?: string[] | null;
  suggestedCategories?: string[];
  topics?: string[] | null;
  onSave: (value: { categories?: string[]; topics: string[] }) => Promise<void>;
};

function sanitizeInitialCategories(
  kind: CatalogMetadataEditorProps["kind"],
  categories: string[] | null | undefined,
): string[] {
  const isCategorySlug = kind === "skill" ? isSkillCategorySlug : isPluginCategorySlug;
  const validCategories = [
    ...new Set((categories ?? []).filter((category) => isCategorySlug(category))),
  ];
  const specificCategories = validCategories.filter(
    (category) => category !== INTERNAL_UNCATEGORIZED_CATEGORY,
  );
  return (specificCategories.length ? specificCategories : validCategories).slice(
    0,
    CATALOG_CATEGORY_LIMIT,
  );
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function CatalogMetadataEditor({
  kind,
  categories: initialCategories,
  suggestedCategories,
  topics: initialTopics,
  onSave,
}: CatalogMetadataEditorProps) {
  const sanitizedInitialCategories = sanitizeInitialCategories(kind, initialCategories);
  const [categories, setCategories] = useState(sanitizedInitialCategories);
  const [topics, setTopics] = useState(formatCatalogTopicsInput(initialTopics ?? []));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serializedInitialCategories = JSON.stringify(sanitizedInitialCategories);
  const serializedInitialTopics = JSON.stringify(initialTopics ?? []);
  const topicCount = parseCatalogTopicsInput(topics).length;

  useEffect(() => {
    // Convex updates can recreate equivalent arrays; reset only when their values change.
    setCategories(JSON.parse(serializedInitialCategories) as string[]);
    setTopics(formatCatalogTopicsInput(JSON.parse(serializedInitialTopics) as string[]));
  }, [serializedInitialCategories, serializedInitialTopics]);

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        categories: categories.length ? categories : [INTERNAL_UNCATEGORIZED_CATEGORY],
        topics: parseCatalogTopicsInput(topics),
      });
    } catch (saveError) {
      setError(getUserFacingConvexError(saveError, "Could not save catalog metadata."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="catalog-metadata-settings-editor">
      <CatalogMetadataFields
        kind={kind}
        categories={categories}
        suggestedCategories={suggestedCategories}
        topics={topics}
        disabled={isSaving}
        onCategoriesChange={setCategories}
        onTopicsChange={setTopics}
      />
      <div className="summary-settings-footer">
        <div className="summary-settings-meta flex items-center gap-2 whitespace-nowrap">
          <span>{formatCount(categories.length, "category", "categories")}</span>
          <span aria-hidden="true">{"\u00b7"}</span>
          <span>{formatCount(topicCount, "topic")}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          loading={isSaving}
          onClick={() => void handleSave()}
        >
          {isSaving ? "Saving" : "Save"}
        </Button>
      </div>
      {error ? <p className="summary-settings-error">{error}</p> : null}
    </div>
  );
}
