import { useRef } from "react";
import { formatCompactStat } from "../../lib/numberFormat";
import {
  BrowseActions,
  BrowseChipTabs,
  BrowseControls,
  BrowseControlsDivider,
  BrowseControlsRow,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  BrowseSortSelect,
  BrowseViewToggle,
  useBrowseSearchDisclosure,
} from "../BrowseControls";
import type { DashboardAggregateStats } from "./dashboardCatalog";
import type { DashboardKindFilter, DashboardSortKey, DashboardView } from "./types";

type DashboardToolbarProps = {
  kind: DashboardKindFilter;
  query: string;
  sort: DashboardSortKey;
  view: DashboardView;
  stats: DashboardAggregateStats;
  onKindChange: (kind: DashboardKindFilter) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: DashboardSortKey) => void;
  onViewChange: (view: DashboardView) => void;
};

const KIND_OPTIONS = [
  { value: "all", label: "All" },
  { value: "skill", label: "Skills" },
  { value: "plugin", label: "Plugins" },
] as const;

const SORT_OPTIONS = [
  { value: "updated", label: "Recently updated" },
  { value: "installs", label: "Most installs" },
  { value: "name", label: "Name (A–Z)" },
] as const;

export function DashboardToolbar({
  kind,
  query,
  sort,
  view,
  stats,
  onKindChange,
  onQueryChange,
  onSortChange,
  onViewChange,
}: DashboardToolbarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const browseSearch = useBrowseSearchDisclosure({
    value: query,
    onClear: () => onQueryChange(""),
    inputRef: searchInputRef,
  });

  const counts = {
    all: formatCompactStat(stats.skillsCount + stats.pluginsCount),
    skill: formatCompactStat(stats.skillsCount),
    plugin: formatCompactStat(stats.pluginsCount),
  } as const;

  return (
    <BrowseControls>
      <BrowseControlsRow>
        <BrowseChipTabs
          ariaLabel="Filter catalog by type"
          options={KIND_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            count: counts[option.value],
          }))}
          value={kind}
          onChange={(value) => {
            if (value === "all" || value === "skill" || value === "plugin") {
              onKindChange(value);
            }
          }}
        />
        <BrowseControlsDivider />
        <BrowseSortSelect
          options={SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          value={sort}
          onChange={(value) => {
            if (value === "updated" || value === "installs" || value === "name") {
              onSortChange(value);
            }
          }}
        />
        <BrowseActions>
          <BrowseSearchTrigger
            open={browseSearch.open}
            onOpen={browseSearch.openSearch}
            label="Search catalog"
          />
          <BrowseViewToggle
            view={view}
            onToggle={() => onViewChange(view === "list" ? "grid" : "list")}
          />
        </BrowseActions>
        <BrowseSearchPanel open={browseSearch.open}>
          <BrowseSearchInput
            inputRef={searchInputRef}
            label="Search catalog"
            placeholder="Search by name…"
            value={query}
            onChange={onQueryChange}
            onClear={browseSearch.closeSearch}
            closeLabel="Close search"
          />
        </BrowseSearchPanel>
      </BrowseControlsRow>
    </BrowseControls>
  );
}
