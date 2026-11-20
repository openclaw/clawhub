export function normalizeBundlePathForComparison(path: string) {
  return path
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/")
    .toLowerCase();
}
