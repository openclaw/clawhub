import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getUserFacingConvexError } from "../lib/convexError";
import { CatalogMetadataEditor } from "./CatalogMetadataEditor";
import { SettingsActionRow } from "./settings/SettingsActionRow";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";

type OwnedSkillOption = {
  _id: Id<"skills">;
  slug: string;
  displayName: string;
};

type SkillOwnershipPanelProps = {
  skillId: Id<"skills">;
  slug: string;
  ownerHandle: string | null;
  ownerId: Id<"users"> | Id<"publishers"> | null;
  ownedSkills: OwnedSkillOption[];
  summary?: string | null;
  onSaveSummary?: ((summary: string) => Promise<void>) | null;
  categories?: string[] | null;
  suggestedCategories?: string[];
  topics?: string[] | null;
  onSaveCatalogMetadata?:
    | ((value: { categories?: string[]; topics: string[] }) => Promise<void>)
    | null;
  canDeleteSkill: boolean;
};

function formatMutationError(error: unknown) {
  return getUserFacingConvexError(error, "Request failed.");
}

function SummarySettingsEditor({
  summary,
  onSaveSummary,
}: {
  summary?: string | null;
  onSaveSummary: (summary: string) => Promise<void>;
}) {
  const [value, setValue] = useState(summary ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSaving) setValue(summary ?? "");
  }, [isSaving, summary]);

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSaveSummary(value);
    } catch (saveError) {
      setError(getUserFacingConvexError(saveError, "Could not save description."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="summary-settings-editor">
      <Textarea
        aria-label="Description"
        rows={3}
        value={value}
        maxLength={500}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Enter a brief description..."
      />
      <div className="summary-settings-footer">
        <span className="summary-settings-meta">{value.trim().length}/500</span>
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

export function SkillOwnershipPanel({
  skillId,
  slug,
  ownerHandle,
  ownerId,
  ownedSkills,
  summary,
  onSaveSummary,
  categories,
  suggestedCategories,
  topics,
  onSaveCatalogMetadata,
  canDeleteSkill,
}: SkillOwnershipPanelProps) {
  const navigate = useNavigate();
  const renameOwnedSkill = useMutation(api.skills.renameOwnedSkill);
  const mergeOwnedSkillIntoCanonical = useMutation(api.skills.mergeOwnedSkillIntoCanonical);
  const setOwnedSkillSoftDeleted = useMutation(api.skills.setOwnedSkillSoftDeleted);

  const [renameSlug, setRenameSlug] = useState(slug);
  const [mergeTargetSlug, setMergeTargetSlug] = useState(ownedSkills[0]?.slug ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRename, setConfirmRename] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // When ownedSkills first arrives from the server, default the merge target to
  // the first available skill so the Select is never blank.
  useEffect(() => {
    setMergeTargetSlug((prev) =>
      prev === "" && ownedSkills.length > 0 ? ownedSkills[0].slug : prev,
    );
  }, [ownedSkills]);

  const handleRename = async () => {
    const nextSlug = renameSlug.trim().toLowerCase();
    if (!nextSlug || nextSlug === slug) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await renameOwnedSkill({ slug, newSlug: nextSlug, ownerHandle: ownerHandle ?? undefined });
      toast.success(`Renamed to ${nextSlug}. Old slug will redirect.`);
      await navigate({
        to: "/$owner/skills/$slug",
        params: {
          owner: ownerHandle ?? String(ownerId ?? ""),
          slug: nextSlug,
        },
        replace: true,
      });
    } catch (renameError) {
      setError(formatMutationError(renameError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMerge = async () => {
    const targetSlug = mergeTargetSlug.trim().toLowerCase();
    if (!targetSlug || targetSlug === slug) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await mergeOwnedSkillIntoCanonical({
        sourceSlug: slug,
        targetSlug,
        sourceOwnerHandle: ownerHandle ?? undefined,
        targetOwnerHandle: ownerHandle ?? undefined,
      });
      toast.success(`Merged into ${targetSlug}. This slug will redirect.`);
      await navigate({
        to: "/$owner/skills/$slug",
        params: {
          owner: ownerHandle ?? String(ownerId ?? ""),
          slug: targetSlug,
        },
        replace: true,
      });
    } catch (mergeError) {
      setError(formatMutationError(mergeError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await setOwnedSkillSoftDeleted({
        skillId,
      });
      toast.success(`Deleted ${slug}.`);
      await navigate({ to: "/", replace: true });
    } catch (deleteError) {
      setError(formatMutationError(deleteError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="skill-admin-panel" data-skill-id={skillId}>
        <SettingsActionRow
          title="Publish a new version"
          description="Upload a replacement release for this skill. New releases get a fresh scan."
        >
          <Button asChild variant="outline">
            <a
              href={`/publish-skill?updateSlug=${encodeURIComponent(slug)}${
                ownerHandle ? `&ownerHandle=${encodeURIComponent(ownerHandle)}` : ""
              }`}
            >
              New Version
            </a>
          </Button>
        </SettingsActionRow>

        <SettingsActionRow
          title="Short summary"
          description="Update the short summary used in cards, search, and previews."
        >
          {onSaveSummary ? (
            <SummarySettingsEditor summary={summary} onSaveSummary={onSaveSummary} />
          ) : null}
        </SettingsActionRow>

        <SettingsActionRow
          title="Catalog metadata"
          description="Choose browse categories and author topics for this skill."
        >
          {onSaveCatalogMetadata ? (
            <CatalogMetadataEditor
              kind="skill"
              categories={categories}
              suggestedCategories={suggestedCategories}
              topics={topics}
              onSave={onSaveCatalogMetadata}
            />
          ) : null}
        </SettingsActionRow>

        <SettingsActionRow
          title="Rename slug"
          description="Change the canonical URL slug. Old slugs stay as redirects."
        >
          <div className="skill-admin-row-controls">
            <div className="skill-admin-control-line">
              <Input
                aria-label="New slug"
                value={renameSlug}
                onChange={(event) => setRenameSlug(event.target.value)}
                placeholder="new-slug"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                variant="outline"
                onClick={() => setConfirmRename(true)}
                disabled={isSubmitting || renameSlug.trim().toLowerCase() === slug}
              >
                Update
              </Button>
            </div>
          </div>
        </SettingsActionRow>

        <SettingsActionRow
          title="Merge listing"
          description={
            <p>
              Fold this listing into another skill you own. The target remains live and this row is
              hidden from search and browse.
            </p>
          }
        >
          <div className="skill-admin-row-controls">
            <div className="skill-admin-control-line">
              <Select
                value={ownedSkills.length === 0 ? "__none__" : mergeTargetSlug}
                onValueChange={setMergeTargetSlug}
                disabled={ownedSkills.length === 0 || isSubmitting}
              >
                <SelectTrigger aria-label="Merge into">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ownedSkills.length === 0 ? (
                    <SelectItem value="__none__">No other owned skills</SelectItem>
                  ) : null}
                  {ownedSkills.map((entry) => (
                    <SelectItem key={entry._id} value={entry.slug}>
                      {entry.displayName} ({entry.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => setConfirmMerge(true)}
                disabled={isSubmitting || !mergeTargetSlug}
              >
                Update
              </Button>
            </div>
          </div>
        </SettingsActionRow>

        {canDeleteSkill ? (
          <div className="mt-8 rounded-[var(--radius-md)] border border-red-300/50 bg-red-500/[0.035] p-4 dark:border-red-500/35 dark:bg-red-500/[0.045] sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-red-300/40 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:text-red-300">
                  <ShieldAlert size={17} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-red-700 dark:text-red-300">Delete skill</h3>
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    Hide this skill from search, browse, and public install surfaces.
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                type="button"
                className="sm:w-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={isSubmitting}
              >
                <Trash2 size={16} aria-hidden="true" />
                Delete skill
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      {/* Rename confirmation dialog */}
      <Dialog open={confirmRename} onOpenChange={setConfirmRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename skill slug?</DialogTitle>
            <DialogDescription>
              This will permanently rename <strong>{slug}</strong> to{" "}
              <strong>{renameSlug.trim().toLowerCase()}</strong>. The old slug will become a
              redirect. This cannot be undone without another rename.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRename(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={isSubmitting}
              onClick={() => {
                void handleRename().finally(() => setConfirmRename(false));
              }}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge confirmation dialog */}
      <Dialog open={confirmMerge} onOpenChange={setConfirmMerge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge into another skill?</DialogTitle>
            <DialogDescription>
              This will hide <strong>{slug}</strong> and redirect it to{" "}
              <strong>{mergeTargetSlug.trim().toLowerCase()}</strong>. The listing row will be
              removed from search and browse views. This is not easily reversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmMerge(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={isSubmitting}
              onClick={() => {
                void handleMerge().finally(() => setConfirmMerge(false));
              }}
            >
              Merge and hide
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={canDeleteSkill && confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete skill</DialogTitle>
            <DialogDescription>
              Delete <strong>{slug}</strong> from public ClawHub surfaces. Accidental deletes can be
              restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={isSubmitting}
              onClick={() => {
                void handleDelete().finally(() => setConfirmDelete(false));
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
              Delete skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
