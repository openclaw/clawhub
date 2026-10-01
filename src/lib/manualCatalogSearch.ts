export type ManualCatalogSearch = {
  query: string;
  consumed: Partial<Record<"plugin" | "skill", boolean>>;
  kinds?: Array<"plugin" | "skill">;
};

export function consumeManualCatalogSearch(
  intent: ManualCatalogSearch | null | undefined,
  kind: "plugin" | "skill",
  query: string,
) {
  if (
    !intent ||
    intent.query !== query ||
    intent.consumed[kind] ||
    (intent.kinds && !intent.kinds.includes(kind))
  )
    return false;
  intent.consumed[kind] = true;
  return true;
}

let pendingNavigation: ManualCatalogSearch | null = null;

// Carry a control's one-shot intent across client navigation, never in a URL,
// browser history, storage, or a request identifier. A reload starts empty.
export function navigateWithManualCatalogSearch(
  intent: ManualCatalogSearch | null,
  navigate: () => Promise<void> | void,
) {
  pendingNavigation = intent;
  return Promise.resolve(navigate()).finally(() => {
    if (pendingNavigation === intent) pendingNavigation = null;
  });
}

export function takeManualCatalogSearch(query: string | undefined) {
  const intent = pendingNavigation;
  pendingNavigation = null;
  return intent?.query === query?.trim() ? intent : null;
}
