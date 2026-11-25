import { useQuery } from "convex/react";
import { History } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { skillTabFromHash } from "../lib/skillDetailTabs";
import { SkillVersionsPanel } from "./SkillVersionsPanel";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

type HistoryProps = Omit<ComponentProps<typeof SkillVersionsPanel>, "versions"> & {
  displayName: string;
};

export function SkillVersionHistory({ displayName, ...props }: HistoryProps) {
  const [open, setOpen] = useState(false);
  const previousHash = useRef("");
  useEffect(() => {
    const sync = () => {
      previousHash.current = "";
      setOpen(window.location.hash.toLowerCase() === "#versions");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const versions = useQuery(
    api.skills.listVersions,
    open ? { skillId: props.skillId, limit: 50 } : "skip",
  ) as Doc<"skillVersions">[] | undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next)
          previousHash.current = skillTabFromHash(window.location.hash) ? window.location.hash : "";
        const hash = next ? "#versions" : previousHash.current;
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search + hash,
        );
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className="skill-sidebar-action-link">
          <History size={14} aria-hidden="true" />
          Version history
        </button>
      </DialogTrigger>
      <DialogContent className="skill-version-history-dialog">
        <DialogTitle>Version history</DialogTitle>
        <DialogDescription>{displayName}</DialogDescription>
        <SkillVersionsPanel {...props} versions={versions} />
      </DialogContent>
    </Dialog>
  );
}
