import { ConvexError } from "convex/values";
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

// The Gateway accepts 4096 characters; a compressed list of public canonical
// names freezes order without server writes or a per-query result cache. It is
// a continuation, NOT a credential. The reader must recheck every name.
const PREFIX = "tr1.";
const MAX_WIRE = 4096;
const MAX_RAW = 65536;
export const MAX_TEMPLATE_CANDIDATES = 500;
export type RankedFilters = { q: string; category: string; limit: number };
export function badPage(): never {
  throw new ConvexError({
    code: "invalid_template_page",
    message: "Invalid Template page parameters or cursor",
  });
}
export function tooBroad(): never {
  throw new ConvexError({
    code: "template_page_capacity",
    message: "Ranked Template traversal exceeds the bounded snapshot capacity",
  });
}
function encodeBytes(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
export function encodeRankedCursor(names: string[], { q, category, limit }: RankedFilters) {
  if (!names.length) return null;
  const raw = strToU8(JSON.stringify([q, category, limit, names]));
  if (raw.length >= MAX_RAW) return tooBroad();
  const token = PREFIX + encodeBytes(deflateSync(raw, { level: 1 }));
  if (token.length > MAX_WIRE) return tooBroad();
  return token;
}
export function decodeRankedCursor(raw: string, { q, category, limit }: RankedFilters): string[] {
  if (!raw.startsWith(PREFIX) || raw.length > MAX_WIRE) return badPage();
  try {
    const wire = raw.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/u.test(wire)) return badPage();
    const packed = Uint8Array.from(atob(wire.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
    const bytes = inflateSync(packed, { out: new Uint8Array(MAX_RAW) });
    if (bytes.length >= MAX_RAW) return badPage();
    const state: unknown = JSON.parse(strFromU8(bytes));
    if (
      !Array.isArray(state) ||
      state.length !== 4 ||
      state[0] !== q ||
      state[1] !== category ||
      state[2] !== limit
    )
      return badPage();
    const names: unknown = state[3];
    if (
      !Array.isArray(names) ||
      !names.length ||
      names.length > MAX_TEMPLATE_CANDIDATES ||
      !names.every((n): n is string => typeof n === "string" && n.length > 0 && n.length <= 214) ||
      new Set(names).size !== names.length
    )
      return badPage();
    return names;
  } catch {
    return badPage();
  }
}
