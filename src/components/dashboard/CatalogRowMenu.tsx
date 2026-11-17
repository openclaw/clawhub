import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ExternalLink, MoreHorizontal, Settings, Trash2, Upload } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getUserFacingConvexError } from "../../lib/convexError";
import { buildSkillSettingsHref } from "../../lib/ownerRoute";
import { buildPluginDetailHref } from "../../lib/pluginRoutes";
import { buildTemplateDetailHref } from "../../lib/templateRoutes";
import { buildSkillHref } from "../skillDetailUtils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { DashboardCatalogItem } from "./types";

const PUBLISHER_ROLE_TOOLTIP = "Only org owners and admins can change settings.";

type CatalogRowMenuProps = {
  item: DashboardCatalogItem;
  ownerHandle: string;
  canManage: boolean;
};

type RowAction = {
  id: string;
  label: string;
  ariaLabel: string;
  href: string;
  external: boolean;
  search?: Record<string, unknown>;
  icon: typeof Settings;
};

export function CatalogRowMenu({ item, ownerHandle, canManage }: CatalogRowMenuProps) {
  if (item.kind === "plugin" && item.data.family === "template" && canManage) {
    return <TemplateRowMenu item={item} ownerHandle={ownerHandle} />;
  }
  return <RowMenu item={item} ownerHandle={ownerHandle} canManage={canManage} />;
}

function TemplateRowMenu({
  item,
  ownerHandle,
}: {
  item: Extract<DashboardCatalogItem, { kind: "plugin" }>;
  ownerHandle: string;
}) {
  const softDelete = useMutation(api.packages.softDeletePackage);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function deleteTemplate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      await softDelete({ packageId: item.id as Id<"packages"> });
      setConfirmOpen(false);
      toast.success(`${item.name} deleted`);
    } catch (cause) {
      setError(getUserFacingConvexError(cause, "Could not delete this template. Try again."));
    } finally {
      inFlight.current = false;
      setIsDeleting(false);
    }
  }

  return (
    <>
      <RowMenu
        item={item}
        ownerHandle={ownerHandle}
        canManage
        triggerRef={triggerRef}
        onDelete={() => {
          setError(null);
          setConfirmOpen(true);
        }}
      />
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!inFlight.current) setConfirmOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={!isDeleting}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete {item.name}?</DialogTitle>
            <DialogDescription>
              This removes the template and all its versions from the public catalog and prevents
              new downloads. Existing installations are not removed.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-status-error-fg">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              ref={cancelRef}
              variant="ghost"
              disabled={isDeleting}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={isDeleting}
              onClick={() => void deleteTemplate()}
            >
              Delete template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RowMenu({
  item,
  ownerHandle,
  canManage,
  onDelete,
  triggerRef,
}: CatalogRowMenuProps & {
  onDelete?: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const actions = buildRowActions(item, ownerHandle);

  return (
    <div className="dashboard-row-actions" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            className="dashboard-row-btn"
            aria-label={`Open actions for ${item.name}`}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {actions.map((action) => {
            const Icon = action.icon;
            if (action.id === "settings" && !canManage) {
              return (
                <Tooltip key={action.id}>
                  <TooltipTrigger asChild>
                    <span>
                      <DropdownMenuItem disabled aria-label="Settings (restricted)">
                        <Icon size={14} aria-hidden="true" />
                        Settings
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">{PUBLISHER_ROLE_TOOLTIP}</TooltipContent>
                </Tooltip>
              );
            }

            if (action.external) {
              return (
                <DropdownMenuItem key={action.id} asChild>
                  <a href={action.href} aria-label={action.ariaLabel}>
                    <Icon size={14} aria-hidden="true" />
                    {action.label}
                  </a>
                </DropdownMenuItem>
              );
            }

            return (
              <DropdownMenuItem key={action.id} asChild>
                <Link
                  to={action.href}
                  search={action.search as never}
                  aria-label={action.ariaLabel}
                >
                  <Icon size={14} aria-hidden="true" />
                  {action.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
          {onDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 size={14} aria-hidden="true" />
                Delete template
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function buildRowActions(item: DashboardCatalogItem, ownerHandle: string): RowAction[] {
  if (item.kind === "skill") {
    const skill = item.data;
    const ownerSegment = ownerHandle.trim() || String(skill.ownerPublisherId ?? skill.ownerUserId);
    const detailHref =
      skill.detailHref ??
      buildSkillHref(ownerHandle, skill.ownerPublisherId ?? skill.ownerUserId, skill.slug);
    const settingsHref = skill.settingsHref ?? buildSkillSettingsHref(ownerSegment, skill.slug);

    return [
      {
        id: "settings",
        label: "Settings",
        ariaLabel: `Open settings for ${skill.displayName}`,
        href: settingsHref,
        external: true,
        icon: Settings,
      },
      {
        id: "public",
        label: "View page",
        ariaLabel: `View public page for ${skill.displayName}`,
        href: detailHref,
        external: true,
        icon: ExternalLink,
      },
      {
        id: "new-version",
        label: "New version",
        ariaLabel: `Publish new version of ${skill.displayName}`,
        href: "/skills/publish",
        search: {
          updateSlug: skill.slug,
          ownerHandle: ownerHandle || undefined,
        },
        external: false,
        icon: Upload,
      },
    ];
  }

  const pkg = item.data;
  if (pkg.family === "template") {
    return [
      {
        id: "public",
        label: "View page",
        ariaLabel: `View public page for ${pkg.displayName}`,
        href: buildTemplateDetailHref(pkg.name, ownerHandle)!,
        external: true,
        icon: ExternalLink,
      },
      {
        id: "new-version",
        label: "New version",
        ariaLabel: `How to publish a new version of ${pkg.displayName}`,
        href: "/docs/templates#validate-build-and-publish",
        external: true,
        icon: Upload,
      },
    ];
  }
  const detailHref = buildPluginDetailHref(pkg.name, { ownerHandle });

  return [
    {
      id: "public",
      label: "View page",
      ariaLabel: `View public page for ${pkg.displayName}`,
      href: detailHref,
      external: true,
      icon: ExternalLink,
    },
    {
      id: "new-version",
      label: "New version",
      ariaLabel: `Publish new version of ${pkg.displayName}`,
      href: "/plugins/publish",
      search: {
        ownerHandle: ownerHandle || undefined,
        name: pkg.name,
        displayName: pkg.displayName,
        family: pkg.family === "bundle-plugin" ? "bundle-plugin" : "code-plugin",
        nextVersion: undefined,
        sourceRepo: pkg.sourceRepo ?? undefined,
      },
      external: false,
      icon: Upload,
    },
  ];
}
