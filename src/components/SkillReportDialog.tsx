import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";

type SkillReportDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  reportReason: string;
  reportError: string | null;
  title?: string;
  description?: string;
  submitLabel?: string;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function SkillReportDialog({
  isOpen,
  isSubmitting,
  reportReason,
  reportError,
  title = "Report skill",
  description = "Describe the issue so moderators can review it quickly.",
  submitLabel = "Submit report",
  onReasonChange,
  onCancel,
  onSubmit,
}: SkillReportDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Textarea
            aria-label="Report reason"
            placeholder="What should moderators know?"
            value={reportReason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={5}
            disabled={isSubmitting}
            className="min-h-[120px]"
          />
          {reportError ? (
            <p className="text-sm font-medium text-status-error-fg" role="alert">
              {reportError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (!isSubmitting) onCancel();
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} loading={isSubmitting}>
              {isSubmitting ? "Submitting..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
