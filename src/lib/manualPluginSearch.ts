import type { ManualPluginSearch } from "./useUnifiedSearch";

let pendingNavigation: ManualPluginSearch | null = null;

// Carry a control's one-shot intent across client navigation, never in a URL,
// browser history, storage, or a request identifier. A reload starts empty.
export function navigateWithManualPluginSearch(
  intent: ManualPluginSearch | null,
  navigate: () => Promise<void> | void,
) {
  pendingNavigation = intent;
  return Promise.resolve(navigate()).finally(() => {
    if (pendingNavigation === intent) pendingNavigation = null;
  });
}

export function takeManualPluginSearch(query: string | undefined) {
  const intent = pendingNavigation;
  pendingNavigation = null;
  return intent?.query === query?.trim() ? intent : null;
}
