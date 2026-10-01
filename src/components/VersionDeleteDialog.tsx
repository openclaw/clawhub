import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type VersionDeleteDialogProps = {
  version: string | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function VersionDeleteDialog({
  version,
  isDeleting,
  onCancel,
  onConfirm,
}: VersionDeleteDialogProps) {
  return (
    <Dialog
      open={version !== null}
      onOpenChange={(open) => {
        if (!open && !isDeleting) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete version {version}?</DialogTitle>
          <DialogDescription>
            This withdraws the version from public use. You can restore the exact retained artifact
            later, but the version number remains reserved and cannot be republished with different
            contents.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" loading={isDeleting} onClick={onConfirm}>
            Delete version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
