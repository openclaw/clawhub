import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import {
  hasMalformedBrowseTopicSearch,
  parseBrowseTopicFromSearchInput,
  parseBrowseTopicFromSearchString,
  sanitizeBrowseTopicSearch,
} from "./browseTopicSearch";

type BrowseTopicSearch = {
  topic?: string;
};

type BrowseTopicNavigate<T extends BrowseTopicSearch> = (options: {
  search: (prev: T) => T;
  replace?: boolean;
}) => void | Promise<void>;

export function useBrowseTopicSearch<T extends BrowseTopicSearch>(
  search: T,
  navigate?: BrowseTopicNavigate<T>,
) {
  const searchStr = useRouterState({
    select: (state) => state.location.searchStr ?? "",
  });

  const resolved = useMemo(() => {
    const routeTopic = parseBrowseTopicFromSearchInput(search);
    const urlTopic = parseBrowseTopicFromSearchString(searchStr);
    const activeTopic = routeTopic ?? urlTopic;

    if (!activeTopic) {
      return { search, activeTopic: undefined as string | undefined };
    }

    return {
      search: sanitizeBrowseTopicSearch(search, activeTopic),
      activeTopic,
    };
  }, [search, searchStr]);

  useEffect(() => {
    if (!navigate) return;

    if (!resolved.activeTopic) {
      if (hasMalformedBrowseTopicSearch(search, searchStr)) {
        void navigate({
          search: (prev) => sanitizeBrowseTopicSearch(prev),
          replace: true,
        });
      }
      return;
    }

    const needsCanonical =
      hasMalformedBrowseTopicSearch(search, searchStr) || search.topic !== resolved.activeTopic;
    if (!needsCanonical) return;

    void navigate({
      search: (prev) => sanitizeBrowseTopicSearch(prev, resolved.activeTopic),
      replace: true,
    });
  }, [navigate, resolved.activeTopic, search, searchStr]);

  return resolved;
}
