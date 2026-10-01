import type { ReactNode } from "react";
import { cn } from "../lib/utils";

type SidebarMetadataItem = {
  label: ReactNode;
  key?: string;
  value: ReactNode;
  large?: boolean;
  inline?: boolean;
};

type SidebarMetadataBlock =
  | SidebarMetadataItem
  | {
      grid: SidebarMetadataItem[];
    };

function isGridBlock(block: SidebarMetadataBlock): block is { grid: SidebarMetadataItem[] } {
  return "grid" in block;
}

function getSidebarMetadataItemKey(item: SidebarMetadataItem, fallback: string) {
  return item.key ?? (typeof item.label === "string" ? item.label : fallback);
}

function SidebarMetadataRow({ item }: { item: SidebarMetadataItem }) {
  if (item.value === null || item.value === undefined || item.value === "") return null;
  return (
    <div
      className={cn(
        "sidebar-metadata-row",
        item.large && "sidebar-metadata-row-large",
        item.inline && "sidebar-metadata-row-inline",
      )}
    >
      <dt className="sidebar-metadata-label">{item.label}</dt>
      <dd className="sidebar-metadata-value">{item.value}</dd>
    </div>
  );
}

export function SidebarMetadata({
  ariaLabel,
  blocks,
  className,
  density = "default",
}: {
  ariaLabel: string;
  blocks: SidebarMetadataBlock[];
  className?: string;
  density?: "default" | "compact";
}) {
  return (
    <dl
      className={cn(
        "sidebar-metadata",
        density === "compact" && "sidebar-metadata-compact",
        className,
      )}
      aria-label={ariaLabel}
    >
      {blocks.map((block, index) =>
        isGridBlock(block) ? (
          <div className="sidebar-metadata-grid" key={`grid-${index}`}>
            {block.grid.map((item, itemIndex) => (
              <SidebarMetadataRow
                key={getSidebarMetadataItemKey(item, `grid-${index}-${itemIndex}`)}
                item={item}
              />
            ))}
          </div>
        ) : (
          <SidebarMetadataRow key={getSidebarMetadataItemKey(block, `row-${index}`)} item={block} />
        ),
      )}
    </dl>
  );
}
