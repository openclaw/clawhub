import { franc } from "franc-min";

// Trending uses the language of its public listing, never publisher identity or locale.
// Unidentified text is ineligible; Latin characters alone do not establish English.
export function isEnglishTrendingText(displayName: string, summary: string | null | undefined) {
  return franc([displayName, summary].filter(Boolean).join("\n")) === "eng";
}
