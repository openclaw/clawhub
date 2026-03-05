import type { Locale, TranslationMap } from "./types";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

const locales: Record<Locale, TranslationMap> = {
  en,
  "zh-CN": zhCN,
};

type Subscriber = () => void;

class I18nManager {
  private locale: Locale;
  private subscribers: Set<Subscriber> = new Set();

  constructor() {
    this.locale = this.detectLocale();
  }

  private detectLocale(): Locale {
    const stored = localStorage.getItem("clawhub.locale");
    if (stored === "en" || stored === "zh-CN") return stored;
    const nav = navigator.language;
    return nav.startsWith("zh") ? "zh-CN" : "en";
  }

  getLocale(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale) {
    if (this.locale === locale) return;
    this.locale = locale;
    localStorage.setItem("clawhub.locale", locale);
    this.subscribers.forEach((fn) => fn());
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  t(key: string, params?: Record<string, string | number>): string {
    let value = this.resolve(locales[this.locale], key);
    if (value === undefined) {
      value = this.resolve(locales.en, key);
    }
    if (value === undefined) return key;
    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, k) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`,
      );
    }
    return value;
  }

  private resolve(map: TranslationMap, key: string): string | undefined {
    const parts = key.split(".");
    let current: string | TranslationMap = map;
    for (const part of parts) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as TranslationMap)[part];
    }
    return typeof current === "string" ? current : undefined;
  }
}

export const i18n = new I18nManager();
export const t = (key: string, params?: Record<string, string | number>) =>
  i18n.t(key, params);
