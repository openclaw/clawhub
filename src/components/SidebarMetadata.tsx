import type { ReactNode } from "react";
import { cn } from "../lib/utils";

type SidebarMetadataItem = {
  label: string;
  value: ReactNode;
  large?: boolean;
};

type SidebarMetadataBlock =
  | SidebarMetadataItem
  | {
      grid: SidebarMetadataItem[];
    };

function isGridBlock(block: SidebarMetadataBlock): block is { grid: SidebarMetadataItem[] } {
  return "grid" in block;
}

function SidebarMetadataRow({ item }: { item: SidebarMetadataItem }) {
  if (item.value === null || item.value === undefined || item.value === "") return null;
  return (
    <div className={cn("sidebar-metadata-row", item.large && "sidebar-metadata-row-large")}>
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
            {block.grid.map((item) => (
              <SidebarMetadataRow key={item.label} item={item} />
            ))}
          </div>
        ) : (
          <SidebarMetadataRow key={block.label} item={block} />
        ),
      )}
    </dl>
  );
}
