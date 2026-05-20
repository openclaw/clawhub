import { useId, useState } from "react";

type PublisherClawScanNoteProps = {
  note?: string | null;
  compact?: boolean;
};

export function PublisherClawScanNote({ note, compact = false }: PublisherClawScanNoteProps) {
  const headingId = useId();
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const trimmed = note?.trim();
  if (!trimmed) return null;
  const canToggle = trimmed.length > 420 || trimmed.split(/\r?\n/).length > 5;

  return (
    <section
      className={`publisher-clawscan-note${compact ? " publisher-clawscan-note-compact security-report-panel-compact" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="security-report-panel-header publisher-clawscan-note-header">
        <div className="publisher-clawscan-note-title-row">
          <h2 id={headingId} className="skill-install-panel-title">
            Publisher note
          </h2>
        </div>
      </div>
      <div className="publisher-clawscan-note-body">
        <blockquote
          id={contentId}
          className={`publisher-clawscan-note-text${canToggle && !expanded ? " is-clamped" : ""}`}
        >
          {trimmed}
        </blockquote>
        {canToggle ? (
          <button
            type="button"
            className="publisher-clawscan-note-toggle"
            aria-controls={contentId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
