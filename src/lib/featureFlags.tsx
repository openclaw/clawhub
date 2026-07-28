import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { getRuntimeEnv } from "./runtimeEnv";

const DEFAULT_KRILLSWITCH_BASE_URL = "https://flags.openclaw.ai";
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const ANONYMOUS_CONTEXT_STORAGE_KEY = "clawhub.featureFlags.anonymousContext";

export const FEATURE_FLAG_DEFAULTS = {
  souls: false,
};

export type FeatureFlagValues = {
  souls: boolean;
};

type FeatureFlagEvaluation =
  | { kind: "not-modified" }
  | { kind: "updated"; etag: string | null; values: FeatureFlagValues };

type EvaluateFeatureFlagsOptions = {
  baseUrl: string;
  contextKey: string;
  etag?: string | null;
  evalKey: string;
  signal?: AbortSignal;
};

type FeatureFlagProviderProps = {
  baseUrl?: string;
  children: ReactNode;
  contextKey?: string;
  evalKey?: string;
  pollIntervalMs?: number;
};

const evalResponseSchema = z.object({
  flags: z.record(
    z.string(),
    z.object({
      value: z.unknown(),
    }),
  ),
});

const cachedFlagsSchema = z.object({
  souls: z.boolean(),
});

const FeatureFlagsContext = createContext<FeatureFlagValues>(FEATURE_FLAG_DEFAULTS);

function evaluationUrl(baseUrl: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("v1/eval", normalizedBaseUrl);
}

function valuesFromResponse(payload: unknown): FeatureFlagValues {
  const parsed = evalResponseSchema.safeParse(payload);
  if (!parsed.success) return FEATURE_FLAG_DEFAULTS;

  const souls = parsed.data.flags.souls?.value;
  return {
    souls: typeof souls === "boolean" ? souls : FEATURE_FLAG_DEFAULTS.souls,
  };
}

export async function evaluateFeatureFlags({
  baseUrl,
  contextKey,
  etag,
  evalKey,
  signal,
}: EvaluateFeatureFlagsOptions): Promise<FeatureFlagEvaluation> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${evalKey}`,
    "content-type": "application/json",
  };
  if (etag) headers["if-none-match"] = etag;

  const response = await fetch(evaluationUrl(baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ context: { key: contextKey } }),
    signal,
  });

  if (response.status === 304) return { kind: "not-modified" };
  if (!response.ok) {
    throw new Error(`Krill Switch evaluation failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  return {
    kind: "updated",
    etag: response.headers.get("etag"),
    values: valuesFromResponse(payload),
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function storedValue(key: string): string | null {
  try {
    return safeLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    safeLocalStorage()?.setItem(key, value);
  } catch {
    // Flags remain a progressive enhancement when storage is unavailable.
  }
}

function anonymousContextKey(): string {
  const stored = storedValue(ANONYMOUS_CONTEXT_STORAGE_KEY);
  if (stored) return stored;

  const generatedId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
  const generated = `anon-${generatedId}`;
  storeValue(ANONYMOUS_CONTEXT_STORAGE_KEY, generated);
  return generated;
}

function flagStorageKey(evalKey: string, contextKey: string): string {
  return `clawhub.featureFlags.${evalKey}.${encodeURIComponent(contextKey)}`;
}

function readCachedFlags(storageKey: string): FeatureFlagValues {
  const raw = storedValue(storageKey);
  if (!raw) return FEATURE_FLAG_DEFAULTS;

  try {
    const parsed: unknown = JSON.parse(raw);
    const cached = cachedFlagsSchema.safeParse(parsed);
    return cached.success ? cached.data : FEATURE_FLAG_DEFAULTS;
  } catch {
    return FEATURE_FLAG_DEFAULTS;
  }
}

export function FeatureFlagProvider({
  baseUrl,
  children,
  contextKey,
  evalKey,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: FeatureFlagProviderProps) {
  const resolvedEvalKey = evalKey ?? getRuntimeEnv("VITE_KRILLSWITCH_EVAL_KEY");
  const resolvedBaseUrl =
    baseUrl ?? getRuntimeEnv("VITE_KRILLSWITCH_BASE_URL") ?? DEFAULT_KRILLSWITCH_BASE_URL;
  const anonymousKeyRef = useRef<string | null>(null);
  if (!contextKey && anonymousKeyRef.current === null) {
    anonymousKeyRef.current = typeof window === "undefined" ? "anonymous" : anonymousContextKey();
  }
  const resolvedContextKey = contextKey ?? anonymousKeyRef.current ?? "anonymous";
  const storageKey = resolvedEvalKey ? flagStorageKey(resolvedEvalKey, resolvedContextKey) : null;
  const [state, setState] = useState<{
    storageKey: string | null;
    values: FeatureFlagValues;
  }>({ storageKey: null, values: FEATURE_FLAG_DEFAULTS });
  const values = state.storageKey === storageKey ? state.values : FEATURE_FLAG_DEFAULTS;

  useEffect(() => {
    if (!resolvedEvalKey || !storageKey) {
      setState({ storageKey: null, values: FEATURE_FLAG_DEFAULTS });
      return undefined;
    }

    const activeEvalKey = resolvedEvalKey;
    const activeStorageKey = storageKey;
    let disposed = false;
    let activeController: AbortController | null = null;
    let etag: string | null = null;
    setState({ storageKey: activeStorageKey, values: readCachedFlags(activeStorageKey) });

    async function refresh(): Promise<void> {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const result = await evaluateFeatureFlags({
          baseUrl: resolvedBaseUrl,
          contextKey: resolvedContextKey,
          etag,
          evalKey: activeEvalKey,
          signal: controller.signal,
        });
        if (disposed || controller.signal.aborted || result.kind === "not-modified") return;

        etag = result.etag;
        setState({ storageKey: activeStorageKey, values: result.values });
        storeValue(activeStorageKey, JSON.stringify(result.values));
      } catch {
        // Preserve code defaults or last-known values when evaluation is unavailable.
      } finally {
        if (activeController === controller) activeController = null;
      }
    }

    void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const pollTimer = window.setInterval(() => void refresh(), pollIntervalMs);

    return () => {
      disposed = true;
      activeController?.abort();
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pollIntervalMs, resolvedBaseUrl, resolvedContextKey, resolvedEvalKey, storageKey]);

  return <FeatureFlagsContext.Provider value={values}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlag<Key extends keyof FeatureFlagValues>(
  key: Key,
): FeatureFlagValues[Key] {
  return useContext(FeatureFlagsContext)[key];
}
