export function stringifyJsonlRow(row: unknown) {
  // Some line readers treat these Unicode characters as record boundaries.
  // JSON escapes preserve their values without splitting a serialized row.
  return JSON.stringify(row).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
