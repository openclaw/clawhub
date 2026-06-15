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
            Deletion is permanent. Version {version} cannot be restored or republished, and the
            version number remains reserved. Recovery is publishing a new version.
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
