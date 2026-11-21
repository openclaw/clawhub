import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getUserFacingConvexError } from "./convexError";

type VersionChoice<Key> = { key: Key; version: string };

export function useVersionWithdrawal<Key extends string>({
  deleteVersion,
  restoreVersion,
  onChanged,
  onRestored,
}: {
  deleteVersion: (key: Key) => Promise<unknown>;
  restoreVersion: (key: Key) => Promise<unknown>;
  onChanged?: () => void;
  onRestored?: (key: Key) => void;
}) {
  const [deleting, setDeleting] = useState<VersionChoice<Key> | null>(null);
  const [restoring, setRestoring] = useState<VersionChoice<Key> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [overrides, setOverrides] = useState(() => new Map<Key, boolean>());
  const generationRef = useRef(0);

  const reset = useCallback(() => {
    generationRef.current += 1;
    setDeleting(null);
    setRestoring(null);
    setIsDeleting(false);
    setIsRestoring(false);
    setOverrides(new Map());
  }, []);

  const run = async (action: "delete" | "restore") => {
    const choice = action === "delete" ? deleting : restoring;
    if (!choice) return;
    const generation = generationRef.current;
    const setPending = action === "delete" ? setIsDeleting : setIsRestoring;
    const clearChoice = action === "delete" ? setDeleting : setRestoring;
    const mutate = action === "delete" ? deleteVersion : restoreVersion;
    const verb = action === "delete" ? "deleted" : "restored";
    setPending(true);
    try {
      await mutate(choice.key);
      if (generationRef.current !== generation) return;
      setOverrides((current) => new Map(current).set(choice.key, action === "delete"));
      if (action === "restore") onRestored?.(choice.key);
      toast.success(`${action === "delete" ? "Deleted" : "Restored"} version ${choice.version}.`);
      clearChoice(null);
      onChanged?.();
    } catch (error) {
      if (generationRef.current !== generation) return;
      toast.error(getUserFacingConvexError(error, `Version could not be ${verb}. Try again.`));
    } finally {
      if (generationRef.current === generation) setPending(false);
    }
  };

  return {
    overrides,
    reset,
    requestDelete: (key: Key, version: string) => setDeleting({ key, version }),
    requestRestore: (key: Key, version: string) => setRestoring({ key, version }),
    deleteDialog: {
      version: deleting?.version ?? null,
      isDeleting,
      onCancel: () => setDeleting(null),
      onConfirm: () => {
        void run("delete");
      },
    },
    restoreDialog: {
      version: restoring?.version ?? null,
      isRestoring,
      onCancel: () => setRestoring(null),
      onConfirm: () => {
        void run("restore");
      },
    },
  };
}
