import { MAX_CLAWSCAN_NOTE_CHARS } from "clawhub-schema";
import { useState } from "react";
import { getUserFacingConvexError } from "../lib/convexError";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type PublisherNoteSettingsEditorProps = {
  note?: string | null;
  onSaveAndRescan: (note: string) => Promise<void>;
};

export function PublisherNoteSettingsEditor({
  note,
  onSaveAndRescan,
}: PublisherNoteSettingsEditorProps) {
  const [value, setValue] = useState(note ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedLength = value.trim().length;
  const tooLong = trimmedLength > MAX_CLAWSCAN_NOTE_CHARS;
  const disabledReason = tooLong
    ? `Publisher note must be at most ${MAX_CLAWSCAN_NOTE_CHARS} characters.`
    : null;

  async function handleSave() {
    if (disabledReason || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSaveAndRescan(value);
    } catch (saveError) {
      setError(getUserFacingConvexError(saveError, "Could not save publisher note."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="publisher-note-settings-editor">
      <Textarea
        aria-label="Publisher note"
        rows={3}
        value={value}
        maxLength={MAX_CLAWSCAN_NOTE_CHARS + 1}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Optional context for ClawScan, e.g. why this version needs network access."
      />
      <div className="publisher-note-settings-meta">
        <span>
          {trimmedLength}/{MAX_CLAWSCAN_NOTE_CHARS}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        loading={isSaving}
        disabled={Boolean(disabledReason)}
        title={disabledReason ?? undefined}
        onClick={() => void handleSave()}
      >
        {isSaving ? "Rescanning" : "Save & Rescan"}
      </Button>
      {error ? <p className="publisher-note-settings-error">{error}</p> : null}
    </div>
  );
}
