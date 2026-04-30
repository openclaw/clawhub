import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { fetchPluginCatalog, type PackageListItem } from "./packageApi";

export type UnifiedSearchType = "all" | "skills" | "plugins";

export type UnifiedSkillResult = {
  type: "skill";
  skill: {
    _id: string;
    slug: string;
    displayName: string;
    summary?: string | null;
    ownerUserId: string;
    ownerPublisherId?: string | null;
    stats: { downloads: number; stars: number; versions?: number };
    updatedAt: number;
    createdAt: number;
  };
  ownerHandle: string | null;
  score: number;
};

export type UnifiedPluginResult = {
  type: "plugin";
  plugin: PackageListItem;
};

export type UnifiedResult = UnifiedSkillResult | UnifiedPluginResult;

type UnifiedSearchOptions = {
  debounceMs?: number;
  enabled?: boolean;
  limits?: {
    skills?: number;
    plugins?: number;
  };
};

export function useUnifiedSearch(
  query: string,
  activeType: UnifiedSearchType,
  options: UnifiedSearchOptions = {},
) {
  const searchSkills = useAction(api.search.searchSkills);
  const [results, setResults] = useState<UnifiedResult[]>([]);
  const [skillResults, setSkillResults] = useState<UnifiedSkillResult[]>([]);
  const [pluginResults, setPluginResults] = useState<UnifiedPluginResult[]>([]);
  const [skillCount, setSkillCount] = useState(0);
  const [pluginCount, setPluginCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const requestRef = useRef(0);
  const debounceMs = options.debounceMs ?? 300;
  const enabled = options.enabled ?? true;
  const skillLimit = options.limits?.skills ?? 25;
  const pluginLimit = options.limits?.plugins ?? 25;

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !trimmed) {
      requestRef.current += 1;
      setResults([]);
      setSkillResults([]);
      setPluginResults([]);
      setSkillCount(0);
      setPluginCount(0);
      setIsSearching(false);
      return () => {};
    }

    requestRef.current += 1;
    const requestId = requestRef.current;
    setIsSearching(true);

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const promises: [Promise<unknown> | null, Promise<{ items: PackageListItem[] }> | null] =
            [null, null];

          if (activeType === "all" || activeType === "skills") {
            promises[0] = searchSkills({
              query: trimmed,
              limit: skillLimit,
              nonSuspiciousOnly: true,
            });
          }

          if (activeType === "all" || activeType === "plugins") {
            promises[1] = fetchPluginCatalog({ q: trimmed, limit: pluginLimit });
          }

          const settled = await Promise.allSettled(promises.map((p) => p ?? Promise.resolve(null)));

          if (requestId !== requestRef.current) return;

          const skillsRaw = settled[0].status === "fulfilled" ? settled[0].value : null;
          const pluginsRaw = settled[1].status === "fulfilled" ? settled[1].value : null;

          const nextSkillResults: UnifiedSkillResult[] = (
            (skillsRaw as Array<{
              skill: UnifiedSkillResult["skill"];
              ownerHandle: string | null;
              score: number;
            }>) ?? []
          ).map((entry) => ({
            type: "skill" as const,
            skill: entry.skill,
            ownerHandle: entry.ownerHandle,
            score: entry.score,
          }));

          const nextPluginResults: UnifiedPluginResult[] = (
            (pluginsRaw as { items: PackageListItem[] })?.items ?? []
          ).map((item) => ({
            type: "plugin" as const,
            plugin: item,
          }));

          setSkillCount(nextSkillResults.length);
          setPluginCount(nextPluginResults.length);
          setSkillResults(nextSkillResults);
          setPluginResults(nextPluginResults);

          const merged: UnifiedResult[] = [];
          if (activeType === "all") {
            merged.push(...nextSkillResults, ...nextPluginResults);
          } else if (activeType === "skills") {
            merged.push(...nextSkillResults);
          } else {
            merged.push(...nextPluginResults);
          }

          setResults(merged);
        } catch (error) {
          console.error("Unified search failed:", error);
          if (requestId === requestRef.current) {
            setResults([]);
            setSkillResults([]);
            setPluginResults([]);
            setSkillCount(0);
            setPluginCount(0);
          }
        } finally {
          if (requestId === requestRef.current) {
            setIsSearching(false);
          }
        }
      })();
    }, debounceMs);

    return () => window.clearTimeout(handle);
  }, [query, activeType, searchSkills, debounceMs, enabled, skillLimit, pluginLimit]);

  return { results, skillResults, pluginResults, skillCount, pluginCount, isSearching };
}
