export type TranslationMap = { [key: string]: string | TranslationMap };
export type Locale = "en" | "zh-CN";

/**
 * Recursively flatten a nested translation object into dot-path union keys.
 * e.g. { header: { skills: "Skills" } } → "header.skills"
 */
export type FlattenKeys<
  T,
  Prefix extends string = "",
> = T extends string
  ? Prefix
  : {
      [K in keyof T & string]: FlattenKeys<
        T[K],
        Prefix extends "" ? K : `${Prefix}.${K}`
      >;
    }[keyof T & string];
