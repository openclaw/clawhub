import { useSyncExternalStore, useCallback } from "react";
import { i18n } from "./translate";
import type { Locale } from "./types";

export function useI18n() {
  const locale = useSyncExternalStore(
    (cb) => i18n.subscribe(cb),
    () => i18n.getLocale(),
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      i18n.t(key, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const setLocale = useCallback((l: Locale) => i18n.setLocale(l), []);

  return { t, locale, setLocale };
}
