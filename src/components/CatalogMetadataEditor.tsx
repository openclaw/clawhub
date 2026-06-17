import { useEffect, useState } from "react";
import { getUserFacingConvexError } from "../lib/convexError";
import { CatalogMetadataFields, parseCatalogTopicsInput } from "./CatalogMetadataFields";
import { Button } from "./ui/button";

type CatalogMetadataEditorProps = {
  kind: "skill" | "plugin";
  categories?: string[] | null;
  topics?: string[] | null;
  onSave: (value: { categories?: string[]; topics: string[] }) => Promise<void>;
};

export function CatalogMetadataEditor({
  kind,
  categories: initialCategories,
  topics: initialTopics,
  onSave,
}: CatalogMetadataEditorProps) {
  const [categories, setCategories] = useState(initialCategories ?? []);
  const [topics, setTopics] = useState((initialTopics ?? []).join(", "));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSaving) return;
    setCategories(initialCategories ?? []);
    setTopics((initialTopics ?? []).join(", "));
  }, [initialCategories, initialTopics, isSaving]);

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        categories: categories.length ? categories : undefined,
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
        topics={topics}
        disabled={isSaving}
        onCategoriesChange={setCategories}
        onTopicsChange={setTopics}
      />
      <div className="summary-settings-footer">
        <span className="summary-settings-meta">
          {categories.length ? `${categories.length} categories` : "Automatic categories"}
        </span>
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
