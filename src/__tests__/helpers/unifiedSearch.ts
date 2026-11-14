export function createEmptySearchResult() {
  return {
    results: [],
    skillResults: [],
    pluginResults: [],
    creatorResults: [],
    skillCount: 0,
    pluginCount: 0,
    creatorCount: 0,
    skillHasMore: false,
    pluginHasMore: false,
    creatorHasMore: false,
    isSearching: false,
  };
}
