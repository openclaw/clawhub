import { flushSync } from "react-dom";

export type ThemeValue = "light" | "dark" | "system" | (string & {});

export type ThemeTransitionContext = {
  element?: HTMLElement | null;
  pointerClientX?: number;
  pointerClientY?: number;
};

export type ThemeTransitionOptions = {
  nextTheme: ThemeValue;
  setTheme: (theme: ThemeValue) => void;
  context?: ThemeTransitionContext | undefined;
  onBeforeThemeChange?: () => void;
  onAfterThemeChange?: () => void;
  currentTheme?: ThemeValue | null;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>;
  };
};

type WindowWithMatchMedia = Window & {
  matchMedia: (query: string) => MediaQueryList;
};

const clamp01 = (value: number) => {
  if (Number.isNaN(value)) return 0.5;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const resolveWindow = (): WindowWithMatchMedia | undefined =>
  globalThis.window as WindowWithMatchMedia | undefined;

const hasReducedMotionPreference = (): boolean => {
  const currentWindow = resolveWindow();
  if (!currentWindow || typeof currentWindow.matchMedia !== "function") return false;
  return currentWindow.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
};

const cleanupThemeTransition = (root: HTMLElement) => {
  root.classList.remove("theme-transition");
  root.style.removeProperty("--theme-switch-x");
  root.style.removeProperty("--theme-switch-y");
};

export const startThemeTransition = ({
  nextTheme,
  setTheme,
  context,
  onBeforeThemeChange,
  onAfterThemeChange,
  currentTheme,
}: ThemeTransitionOptions) => {
  if (currentTheme === nextTheme) return;

  const documentReference = globalThis.document ?? null;
  if (!documentReference) {
    onBeforeThemeChange?.();
    setTheme(nextTheme);
    onAfterThemeChange?.();
    return;
  }

  const root = documentReference.documentElement;
  const document_ = documentReference as DocumentWithViewTransition;
  const prefersReducedMotion = hasReducedMotionPreference();

  const applyTheme = () => {
    onBeforeThemeChange?.();
    flushSync(() => {
      setTheme(nextTheme);
    });
    onAfterThemeChange?.();
  };

  const canUseViewTransition = Boolean(document_.startViewTransition) && !prefersReducedMotion;
  if (canUseViewTransition) {
    let xPercent = 0.5;
    let yPercent = 0.5;

    const currentWindow = resolveWindow();
    if (
      context?.pointerClientX !== undefined &&
      context?.pointerClientY !== undefined &&
      currentWindow
    ) {
      xPercent = clamp01(context.pointerClientX / currentWindow.innerWidth);
      yPercent = clamp01(context.pointerClientY / currentWindow.innerHeight);
    } else if (context?.element) {
      const rect = context.element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && currentWindow) {
        xPercent = clamp01((rect.left + rect.width / 2) / currentWindow.innerWidth);
        yPercent = clamp01((rect.top + rect.height / 2) / currentWindow.innerHeight);
      }
    }

    root.style.setProperty("--theme-switch-x", `${xPercent * 100}%`);
    root.style.setProperty("--theme-switch-y", `${yPercent * 100}%`);
    root.classList.add("theme-transition");

    try {
      const transition = document_.startViewTransition?.(() => {
        applyTheme();
      });
      if (transition?.finished === undefined) {
        cleanupThemeTransition(root);
      } else {
        const handleTransitionFinish = async () => {
          try {
            await transition.finished;
          } catch {
            // swallow transition cancellation errors
          } finally {
            cleanupThemeTransition(root);
          }
        };
        void handleTransitionFinish();
      }
    } catch {
      cleanupThemeTransition(root);
      applyTheme();
    }
    return;
  }

  applyTheme();
  cleanupThemeTransition(root);
};
