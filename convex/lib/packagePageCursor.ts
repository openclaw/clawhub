type PublicPageCursorState = {
  cursor: string | null;
  offset: number;
  pageSize: number | null;
  done: boolean;
  mode?: "packages" | "digest";
  sort?: "updated" | "downloads" | "recommended" | "installs" | "trending";
  packageIndex?: "family-official-downloads";
};
const PUBLIC_PAGE_CURSOR_PREFIX = "pkgpage:";

export function encodePublicPageCursor(state: PublicPageCursorState) {
  if (state.done && state.offset === 0) return "";
  return `${PUBLIC_PAGE_CURSOR_PREFIX}${JSON.stringify(state)}`;
}

export function decodePublicPageCursor(raw: string | null | undefined): PublicPageCursorState {
  if (!raw) return { cursor: null, offset: 0, pageSize: null, done: false };
  if (!raw.startsWith(PUBLIC_PAGE_CURSOR_PREFIX)) {
    return { cursor: raw, offset: 0, pageSize: null, done: false };
  }
  try {
    const parsed = JSON.parse(
      raw.slice(PUBLIC_PAGE_CURSOR_PREFIX.length),
    ) as Partial<PublicPageCursorState>;
    return {
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      offset: typeof parsed.offset === "number" && parsed.offset > 0 ? parsed.offset : 0,
      pageSize: typeof parsed.pageSize === "number" && parsed.pageSize > 0 ? parsed.pageSize : null,
      done: parsed.done === true,
      mode: parsed.mode === "packages" || parsed.mode === "digest" ? parsed.mode : undefined,
      sort:
        parsed.sort === "updated" ||
        parsed.sort === "downloads" ||
        parsed.sort === "recommended" ||
        parsed.sort === "installs" ||
        parsed.sort === "trending"
          ? parsed.sort
          : undefined,
      packageIndex:
        parsed.packageIndex === "family-official-downloads" ? parsed.packageIndex : undefined,
    };
  } catch {
    return { cursor: null, offset: 0, pageSize: null, done: false };
  }
}
