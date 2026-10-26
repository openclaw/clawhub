export declare const THEME_COLOR_KEYS: readonly ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "border", "input", "ring"];
declare const THEME_FONT_KEYS: readonly ["font-sans", "font-mono"];
declare const THEME_MASCOT_VALUES: readonly ["claw", "none"];
type ThemeMascot = (typeof THEME_MASCOT_VALUES)[number];
declare const THEME_WORKING_INDICATOR_VALUES: readonly ["claw", "dots", "brand", "none"];
type ThemeWorkingIndicator = (typeof THEME_WORKING_INDICATOR_VALUES)[number];
export type ThemePalette = Record<(typeof THEME_COLOR_KEYS)[number], string> & Partial<Record<(typeof THEME_FONT_KEYS)[number], string>>;
export type ThemeDefinition = {
    name: string;
    description: string;
    light?: ThemePalette;
    dark?: ThemePalette;
    mascot?: ThemeMascot;
    brandName?: string;
    brandIcon?: string;
    workingIndicator?: ThemeWorkingIndicator;
    lobsterdex?: boolean;
    communityLinks?: boolean;
    workingPhrases?: string[];
    critters?: string[];
    avatarHat?: string;
};
export type ThemeSummary = {
    id: string;
    name: string;
    description: string;
    version: string;
    category: "themes";
    author: {
        handle: string;
    };
    updatedAt: number;
};
export type ThemeRelease = ThemeSummary & {
    definition: ThemeDefinition;
    sha256: string;
};
/** Rejects executable CSS and incomplete palettes before they reach storage or a stylesheet. */
export declare function normalizeThemeDefinition(input: unknown, options?: {
    iconIds?: readonly string[];
    hatIds?: readonly string[];
    critterIds?: readonly string[];
}): ThemeDefinition;
export {};
