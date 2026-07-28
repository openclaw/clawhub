const PRESENTATION_EMOJI_PATTERN =
  /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200D|\uFE0F|\u20E3/gu;

export function presentationTitle(value: string, fallback = "") {
  const title = value.replace(PRESENTATION_EMOJI_PATTERN, " ").replace(/\s+/g, " ").trim();
  return title || fallback;
}
