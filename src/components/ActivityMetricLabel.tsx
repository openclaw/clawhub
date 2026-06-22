import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const DOWNLOAD_COUNT_HELP =
  "Download counts can be inflated by bots or spam. Use them as context only, not as a quality or trust signal.";

export function ActivityMetricLabel({ label }: { label: string }) {
  return (
    <span className="activity-metric-label">
      <span>{label}</span>
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="security-audit-sidebar-info"
              aria-label="About activity counts"
            >
              <Info size={13} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="activity-metric-tooltip">
            {DOWNLOAD_COUNT_HELP}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}
