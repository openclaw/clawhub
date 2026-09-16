import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function ScannerInfoTooltip({
  name,
  company,
  description,
  href,
}: {
  name: string;
  company: string;
  description: string;
  href: string;
}) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const openedByHover = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelClose = () => clearTimeout(closeTimer.current);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const closeAfterHover = () => {
    cancelClose();
    if (!openedByHover.current) return;
    // Leave time to cross the gap from the info icon to the repository link.
    closeTimer.current = setTimeout(() => {
      if (!contentRef.current?.contains(document.activeElement)) setOpen(false);
    }, 200);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        cancelClose();
        openedByHover.current = false;
        setOpen(nextOpen);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="security-scanner-info-trigger"
          aria-label={`About ${name}`}
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            cancelClose();
            if (!open) {
              openedByHover.current = true;
              setOpen(true);
            }
          }}
          onPointerLeave={closeAfterHover}
        >
          <Info size={15} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          className="security-scanner-info-tooltip"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-label={`About ${name}`}
          aria-describedby={descriptionId}
          onPointerEnter={cancelClose}
          onPointerLeave={closeAfterHover}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            // Radix skips links in its default autofocus candidates.
            if (!openedByHover.current) linkRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (openedByHover.current) event.preventDefault();
          }}
        >
          <span className="security-scanner-info-company">
            {name} by {company}
          </span>
          <p id={descriptionId}>{description}</p>
          <a ref={linkRef} href={href} target="_blank" rel="noopener noreferrer">
            Learn more
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
