import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const PREFERENCES_KEY = "clawhub-preferences";

export type LayoutDensity = "comfortable" | "compact";
export type ListViewMode = "grid" | "list";
export type SidebarPosition = "left" | "right";
export type CodeFontSize = "small" | "medium" | "large";
export type AnimationLevel = "full" | "reduced" | "none";

export interface UserPreferences {
  // Display preferences
  layoutDensity: LayoutDensity;
  listViewMode: ListViewMode;
  showDescriptions: boolean;
  showStats: boolean;
  showTags: boolean;
  
  // Advanced layout options
  advancedMode: boolean;
  sidebarPosition: SidebarPosition;
  stickyHeader: boolean;
  
  // Code & content preferences
  codeFontSize: CodeFontSize;
  lineNumbers: boolean;
  wordWrap: boolean;
  
  // Accessibility & motion
  animationLevel: AnimationLevel;
  reducedMotion: boolean;
  highContrast: boolean;
  
  // Notification preferences
  emailNotifications: boolean;
  browserNotifications: boolean;
  
  // Experimental features
  experimentalFeatures: boolean;
}

const defaultPreferences: UserPreferences = {
  layoutDensity: "comfortable",
  listViewMode: "grid",
  showDescriptions: true,
  showStats: true,
  showTags: true,
  
  advancedMode: false,
  sidebarPosition: "right",
  stickyHeader: true,
  
  codeFontSize: "medium",
  lineNumbers: true,
  wordWrap: true,
  
  animationLevel: "full",
  reducedMotion: false,
  highContrast: false,
  
  emailNotifications: true,
  browserNotifications: false,
  
  experimentalFeatures: false,
};

// Simple event emitter for cross-tab sync
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function getStoredPreferences(): UserPreferences {
  if (typeof window === "undefined") return defaultPreferences;
  try {
    const stored = window.localStorage.getItem(PREFERENCES_KEY);
    if (!stored) return defaultPreferences;
    const parsed = JSON.parse(stored) as Partial<UserPreferences>;
    return { ...defaultPreferences, ...parsed };
  } catch {
    return defaultPreferences;
  }
}

function savePreferences(prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    notifyListeners();
  } catch {
    // Storage might be full or disabled
  }
}

// Server snapshot for SSR
function getServerSnapshot(): UserPreferences {
  return defaultPreferences;
}

export function usePreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    getStoredPreferences,
    getServerSnapshot
  );

  const updatePreference = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
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

  // Apply preferences as CSS variables/classes
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    
    // Layout density
    root.dataset.density = preferences.layoutDensity;
    
    // Animation level
    root.dataset.animation = preferences.animationLevel;
    
    // High contrast mode
    root.classList.toggle("high-contrast", preferences.highContrast);
    
    // Reduced motion
    root.classList.toggle("reduce-motion", preferences.reducedMotion || preferences.animationLevel === "none");
    
    // Code font size
    root.style.setProperty("--code-font-size", 
      preferences.codeFontSize === "small" ? "12px" : 
      preferences.codeFontSize === "large" ? "16px" : "14px"
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
