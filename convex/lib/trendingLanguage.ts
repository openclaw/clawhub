import { franc } from "franc-min";

// Trending uses the language of its public listing, never publisher identity or locale.
// Unidentified text is ineligible; Latin characters alone do not establish English.
export function isEnglishTrendingText(displayName: string, summary: string | null | undefined) {
  // An English description must not mask a title written in another script.
  // Latin names (including accents), punctuation, numbers, and symbols remain valid.
  const titleLetters = displayName.match(/\p{Letter}/gu) ?? [];
  if (titleLetters.some((letter) => !/\p{Script_Extensions=Latin}/u.test(letter))) return false;
  return franc([displayName, summary].filter(Boolean).join("\n")) === "eng";
}
