import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type VersionRestoreDialogProps = {
  version: string | null;
  isRestoring: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function VersionRestoreDialog({
  version,
  isRestoring,
  onCancel,
  onConfirm,
}: VersionRestoreDialogProps) {
  return (
    <Dialog
      open={version !== null}
      onOpenChange={(open) => {
        if (!open && !isRestoring) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore version {version}?</DialogTitle>
          <DialogDescription>
            This restores the exact retained artifact. It will not become latest or regain removed
            tags automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isRestoring}>
            Cancel
          </Button>
          <Button loading={isRestoring} onClick={onConfirm}>
            Restore version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
