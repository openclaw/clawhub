import { useRef } from "react";
import {
  BrowseActions,
  BrowseControls,
  BrowseControlsDivider,
  BrowseControlsRow,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  BrowseSegmentedTabs,
  BrowseSortSelect,
  BrowseViewToggle,
  useBrowseSearchDisclosure,
} from "../BrowseControls";
import type { DashboardKindFilter, DashboardSortKey, DashboardView } from "./types";

type DashboardToolbarProps = {
  kind: DashboardKindFilter;
  query: string;
  sort?: DashboardSortKey;
  view: DashboardView;
  onKindChange: (kind: DashboardKindFilter) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: DashboardSortKey | undefined) => void;
  onViewChange: (view: DashboardView) => void;
};

const KIND_OPTIONS = [
  { value: "all", label: "All" },
  { value: "skill", label: "Skills" },
  { value: "plugin", label: "Plugins" },
] as const;

const SORT_OPTIONS = [
  { value: "updated", label: "Recently updated" },
  { value: "downloads", label: "Most downloaded" },
  { value: "name", label: "Name (A–Z)" },
] as const;

export function DashboardToolbar({
  kind,
  query,
  sort,
  view,
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

  return (
    <BrowseControls>
      <BrowseControlsRow>
        <BrowseSegmentedTabs
          ariaLabel="Filter catalog by type"
          options={KIND_OPTIONS}
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
            if (
              value === undefined ||
              value === "updated" ||
              value === "downloads" ||
              value === "name"
            ) {
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
