import { Info } from "lucide-react";
import { useId, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
      className={`publisher-clawscan-note${compact ? " publisher-clawscan-note-compact" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="security-report-panel-header publisher-clawscan-note-header">
        <div className="publisher-clawscan-note-title-row">
          <h2 id={headingId} className="skill-install-panel-title">
            Publisher note
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="publisher-clawscan-note-info"
                aria-label="About publisher ClawScan notes"
              >
                <Info aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="publisher-clawscan-note-tooltip">
              Additional notes the publisher has provided to ClawScan for context when reviewing
            </TooltipContent>
          </Tooltip>
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
