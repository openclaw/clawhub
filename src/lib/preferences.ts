import { useCallback, useEffect, useSyncExternalStore } from 'react';

const PREFERENCES_KEY = 'clawhub-preferences';

export type LayoutDensity = 'comfortable' | 'compact';
export type ListViewMode = 'grid' | 'list';
export type SidebarPosition = 'left' | 'right';
export type CodeFontSize = 'small' | 'medium' | 'large';
export type AnimationLevel = 'full' | 'reduced' | 'none';

export interface UserPreferences {
  layoutDensity: LayoutDensity;
  listViewMode: ListViewMode;
  showDescriptions: boolean;
  showStats: boolean;
  showTags: boolean;
  advancedMode: boolean;
  sidebarPosition: SidebarPosition;
  stickyHeader: boolean;
  codeFontSize: CodeFontSize;
  lineNumbers: boolean;
  wordWrap: boolean;
  animationLevel: AnimationLevel;
  reducedMotion: boolean;
  highContrast: boolean;
  emailNotifications: boolean;
  browserNotifications: boolean;
  experimentalFeatures: boolean;
}

const defaultPreferences: UserPreferences = {
  layoutDensity: 'comfortable',
  listViewMode: 'grid',
  showDescriptions: true,
  showStats: true,
  showTags: true,
  advancedMode: false,
  sidebarPosition: 'right',
  stickyHeader: true,
  codeFontSize: 'medium',
  lineNumbers: true,
  wordWrap: true,
  animationLevel: 'full',
  reducedMotion: false,
  highContrast: false,
  emailNotifications: true,
  browserNotifications: false,
  experimentalFeatures: false,
};

const listeners = new Set<() => void>();
let cachedStoredPreferences: string | null = null;
let cachedSnapshot = defaultPreferences;

function readPreferencesSnapshot(stored: string | null): UserPreferences {
  if (!stored) return defaultPreferences;
  try {
    const parsed = JSON.parse(stored) as Partial<UserPreferences>;
    return { ...defaultPreferences, ...parsed };
  } catch {
    return defaultPreferences;
  }
}

function getStoredPreferences(): UserPreferences {
  if (typeof window === 'undefined') return defaultPreferences;
  const stored = window.localStorage.getItem(PREFERENCES_KEY);
  if (stored === cachedStoredPreferences) {
    return cachedSnapshot;
  }
  cachedStoredPreferences = stored;
  cachedSnapshot = readPreferencesSnapshot(stored);
  return cachedSnapshot;
}

function notifyListeners() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== PREFERENCES_KEY) return;
    cachedStoredPreferences = event.newValue;
    cachedSnapshot = readPreferencesSnapshot(event.newValue);
    listener();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

function savePreferences(prefs: UserPreferences) {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(prefs);
    window.localStorage.setItem(PREFERENCES_KEY, serialized);
    cachedStoredPreferences = serialized;
    cachedSnapshot = prefs;
    notifyListeners();
  } catch {
    // Storage might be full or disabled.
  }
}

function getServerSnapshot(): UserPreferences {
  return defaultPreferences;
}

export function usePreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    getStoredPreferences,
    getServerSnapshot,
  );

  const updatePreference = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => {
    const current = getStoredPreferences();
    const updated = { ...current, [key]: value };
    savePreferences(updated);
  }, []);

  const updatePreferences = useCallback((updates: Partial<UserPreferences>) => {
    const current = getStoredPreferences();
    const updated = { ...current, ...updates };
    savePreferences(updated);
  }, []);

  const resetPreferences = useCallback(() => {
    savePreferences(defaultPreferences);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    root.dataset.density = preferences.layoutDensity;
    root.dataset.animation = preferences.animationLevel;
    root.classList.toggle('high-contrast', preferences.highContrast);
    root.classList.toggle(
      'reduce-motion',
      preferences.reducedMotion || preferences.animationLevel === 'none',
    );
    root.style.setProperty(
      '--code-font-size',
      preferences.codeFontSize === 'small'
        ? '12px'
        : preferences.codeFontSize === 'large'
          ? '16px'
          : '14px',
    );
  }, [preferences]);

  return {
    preferences,
    updatePreference,
    updatePreferences,
    resetPreferences,
    isAdvancedMode: preferences.advancedMode,
  };
}

export { defaultPreferences };
