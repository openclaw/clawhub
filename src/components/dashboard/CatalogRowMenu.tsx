import { Link } from "@tanstack/react-router";
import { ExternalLink, MoreHorizontal, Settings, Upload } from "lucide-react";
import { buildSkillSettingsHref } from "../../lib/ownerRoute";
import { buildPluginDetailHref } from "../../lib/pluginRoutes";
import { buildSkillHref } from "../skillDetailUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  const actions = buildRowActions(item, ownerHandle);

  return (
    <div className="dashboard-row-actions" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
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
        label: "View public page",
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
  const detailHref = buildPluginDetailHref(pkg.name, { ownerHandle });

  return [
    {
      id: "public",
      label: "View public page",
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
