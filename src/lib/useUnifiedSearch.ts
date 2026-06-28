import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { fetchPluginCatalog, type PackageListItem } from "./packageApi";
import type { PublicPublisher, PublicPublisherListItem } from "./publicUser";

export type UnifiedSearchType = "all" | "skills" | "plugins" | "creators";
const MAX_UNIFIED_SEARCH_LIMIT = 100;
const MAX_CREATOR_SEARCH_LIMIT = 50;

export type UnifiedSkillResult = {
  type: "skill";
  skill: {
    _id: string;
    slug: string;
    displayName: string;
    summary?: string | null;
    categories?: string[] | null;
    inferredCategories?: string[] | null;
    latestVersionId?: string | null;
    inferredFromVersionId?: string | null;
    ownerUserId: string;
    ownerPublisherId?: string | null;
    stats: { downloads: number; stars: number; versions?: number };
    updatedAt: number;
    createdAt: number;
  };
  ownerHandle: string | null;
  owner?: PublicPublisher | null;
  score: number;
};

export type UnifiedPluginResult = {
  type: "plugin";
  plugin: PackageListItem;
};

export type UnifiedCreatorResult = {
  type: "creator";
  creator: PublicPublisherListItem;
};

type UnifiedResult = UnifiedSkillResult | UnifiedPluginResult | UnifiedCreatorResult;

export type UnifiedSearchInitialData = {
  query: string;
  activeType: UnifiedSearchType;
  limits: {
    skills: number;
    plugins: number;
    creators: number;
  };
  skillResults: UnifiedSkillResult[];
  pluginResults: UnifiedPluginResult[];
  creatorResults: UnifiedCreatorResult[];
  skillHasMore: boolean;
  pluginHasMore: boolean;
  creatorHasMore: boolean;
};

type UnifiedSearchOptions = {
  debounceMs?: number;
  enabled?: boolean;
  initialData?: UnifiedSearchInitialData | null;
  limits?: {
    skills?: number;
    plugins?: number;
    creators?: number;
  };
};

function mergeUnifiedResults(
  activeType: UnifiedSearchType,
  skillResults: UnifiedSkillResult[],
  pluginResults: UnifiedPluginResult[],
  creatorResults: UnifiedCreatorResult[],
) {
  const merged: UnifiedResult[] = [];
  if (activeType === "all") {
    merged.push(...skillResults, ...pluginResults, ...creatorResults);
  } else if (activeType === "skills") {
    merged.push(...skillResults);
  } else if (activeType === "plugins") {
    merged.push(...pluginResults);
  } else {
    merged.push(...creatorResults);
  }
  return merged;
}

export function useUnifiedSearch(
  query: string,
  activeType: UnifiedSearchType,
  options: UnifiedSearchOptions = {},
) {
  const searchSkills = useAction(api.search.searchSkills);
  const requestRef = useRef(0);
  const debounceMs = options.debounceMs ?? 300;
  const enabled = options.enabled ?? true;
  const initialData = options.initialData ?? null;
  const skillLimit = Math.max(0, Math.min(options.limits?.skills ?? 25, MAX_UNIFIED_SEARCH_LIMIT));
  const pluginLimit = Math.max(
    0,
    Math.min(options.limits?.plugins ?? 25, MAX_UNIFIED_SEARCH_LIMIT),
  );
  const creatorLimit = Math.max(
    0,
    Math.min(options.limits?.creators ?? 25, MAX_CREATOR_SEARCH_LIMIT),
  );
  const creatorRequestLimit = Math.min(creatorLimit + 1, MAX_CREATOR_SEARCH_LIMIT);
  const trimmedQuery = query.trim();
  const matchedInitialData =
    initialData &&
    initialData.query === trimmedQuery &&
    initialData.activeType === activeType &&
    initialData.limits.skills === skillLimit &&
    initialData.limits.plugins === pluginLimit &&
    initialData.limits.creators === creatorLimit
      ? initialData
      : null;
  const [results, setResults] = useState<UnifiedResult[]>(() =>
    matchedInitialData
      ? mergeUnifiedResults(
          activeType,
          matchedInitialData.skillResults,
          matchedInitialData.pluginResults,
          matchedInitialData.creatorResults,
        )
      : [],
  );
  const [skillResults, setSkillResults] = useState<UnifiedSkillResult[]>(
    () => matchedInitialData?.skillResults ?? [],
  );
  const [pluginResults, setPluginResults] = useState<UnifiedPluginResult[]>(
    () => matchedInitialData?.pluginResults ?? [],
  );
  const [creatorResults, setCreatorResults] = useState<UnifiedCreatorResult[]>(
    () => matchedInitialData?.creatorResults ?? [],
  );
  const [skillCount, setSkillCount] = useState(() => matchedInitialData?.skillResults.length ?? 0);
  const [pluginCount, setPluginCount] = useState(
    () => matchedInitialData?.pluginResults.length ?? 0,
  );
  const [creatorCount, setCreatorCount] = useState(
    () => matchedInitialData?.creatorResults.length ?? 0,
  );
  const [skillHasMore, setSkillHasMore] = useState(() => matchedInitialData?.skillHasMore ?? false);
  const [pluginHasMore, setPluginHasMore] = useState(
    () => matchedInitialData?.pluginHasMore ?? false,
  );
  const [creatorHasMore, setCreatorHasMore] = useState(
    () => matchedInitialData?.creatorHasMore ?? false,
  );
  const [isSearching, setIsSearching] = useState(
    () => enabled && trimmedQuery.length > 0 && !matchedInitialData,
  );

  useEffect(() => {
    if (!matchedInitialData) return;
    setSkillResults(matchedInitialData.skillResults);
    setPluginResults(matchedInitialData.pluginResults);
    setCreatorResults(matchedInitialData.creatorResults);
    setSkillCount(matchedInitialData.skillResults.length);
    setPluginCount(matchedInitialData.pluginResults.length);
    setCreatorCount(matchedInitialData.creatorResults.length);
    setSkillHasMore(matchedInitialData.skillHasMore);
    setPluginHasMore(matchedInitialData.pluginHasMore);
    setCreatorHasMore(matchedInitialData.creatorHasMore);
    setResults(
      mergeUnifiedResults(
        activeType,
        matchedInitialData.skillResults,
        matchedInitialData.pluginResults,
        matchedInitialData.creatorResults,
      ),
    );
    setIsSearching(false);
  }, [activeType, matchedInitialData]);

  useEffect(() => {
    if (!enabled || !trimmedQuery) {
      requestRef.current += 1;
      setResults([]);
      setSkillResults([]);
      setPluginResults([]);
      setCreatorResults([]);
      setSkillCount(0);
      setPluginCount(0);
      setCreatorCount(0);
      setSkillHasMore(false);
      setPluginHasMore(false);
      setCreatorHasMore(false);
      setIsSearching(false);
      return () => {};
    }

    requestRef.current += 1;
    const requestId = requestRef.current;
    const controller = new AbortController();
    setIsSearching(true);

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const promises: [
            Promise<unknown> | null,
            Promise<{ items: PackageListItem[] }> | null,
            Promise<{ page: PublicPublisherListItem[]; isDone?: boolean }> | null,
          ] = [null, null, null];

          if (activeType === "all" || activeType === "skills") {
            promises[0] = searchSkills({
              query: trimmedQuery,
              limit: skillLimit + 1,
            });
          }

          if (activeType === "all" || activeType === "plugins") {
            promises[1] = fetchPluginCatalog({
              q: trimmedQuery,
              limit: pluginLimit + 1,
              signal: controller.signal,
            });
          }

          if (activeType === "all" || activeType === "creators") {
            promises[2] = convexHttp.query(api.publishers.listPublicPage, {
              query: trimmedQuery,
              paginationOpts: { cursor: null, numItems: creatorRequestLimit },
            });
          }

          const settled = await Promise.allSettled(promises.map((p) => p ?? Promise.resolve(null)));

          if (requestId !== requestRef.current) return;

          const skillsRaw = settled[0].status === "fulfilled" ? settled[0].value : null;
          const pluginsRaw = settled[1].status === "fulfilled" ? settled[1].value : null;
          const creatorsRaw = settled[2].status === "fulfilled" ? settled[2].value : null;

          const skillMatches: UnifiedSkillResult[] = (
            (skillsRaw as Array<{
              skill: UnifiedSkillResult["skill"];
              ownerHandle: string | null;
              owner?: PublicPublisher | null;
              score: number;
            }>) ?? []
          ).map((entry) => ({
            type: "skill" as const,
            skill: entry.skill,
            ownerHandle: entry.ownerHandle,
            owner: entry.owner ?? null,
            score: entry.score,
          }));
          const nextSkillResults = skillMatches.slice(0, skillLimit);

          const pluginMatches: UnifiedPluginResult[] = (
            (pluginsRaw as { items: PackageListItem[] })?.items ?? []
          ).map((item) => ({
            type: "plugin" as const,
            plugin: item,
          }));
          const nextPluginResults = pluginMatches.slice(0, pluginLimit);

          const creatorMatches: UnifiedCreatorResult[] = (
            (creatorsRaw as { page: PublicPublisherListItem[] } | null)?.page ?? []
          ).map((item) => ({
            type: "creator" as const,
            creator: item,
          }));
          const nextCreatorResults = creatorMatches.slice(0, creatorLimit);

          setSkillCount(nextSkillResults.length);
          setPluginCount(nextPluginResults.length);
          setCreatorCount(nextCreatorResults.length);
          setSkillHasMore(skillMatches.length > skillLimit);
          setPluginHasMore(pluginMatches.length > pluginLimit);
          setCreatorHasMore(
            creatorLimit < MAX_CREATOR_SEARCH_LIMIT &&
              (creatorMatches.length > creatorLimit ||
                (creatorsRaw as { isDone?: boolean } | null)?.isDone === false),
          );
          setSkillResults(nextSkillResults);
          setPluginResults(nextPluginResults);
          setCreatorResults(nextCreatorResults);

          setResults(
            mergeUnifiedResults(
              activeType,
              nextSkillResults,
              nextPluginResults,
              nextCreatorResults,
            ),
          );
        } catch (error) {
          console.error("Unified search failed:", error);
          if (requestId === requestRef.current) {
            setResults([]);
            setSkillResults([]);
            setPluginResults([]);
            setCreatorResults([]);
            setSkillCount(0);
            setPluginCount(0);
            setCreatorCount(0);
            setSkillHasMore(false);
            setPluginHasMore(false);
            setCreatorHasMore(false);
          }
        } finally {
          if (requestId === requestRef.current) {
            setIsSearching(false);
          }
        }
      })();
    }, debounceMs);

    return () => {
      requestRef.current += 1;
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [
    trimmedQuery,
    activeType,
    searchSkills,
    debounceMs,
    enabled,
    skillLimit,
    pluginLimit,
    creatorLimit,
    creatorRequestLimit,
  ]);

  return {
    results,
    skillResults,
    pluginResults,
    creatorResults,
    skillCount,
    pluginCount,
    creatorCount,
    skillHasMore,
    pluginHasMore,
    creatorHasMore,
    isSearching,
  };
}
