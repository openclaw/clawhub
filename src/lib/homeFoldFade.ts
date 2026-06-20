/** Show the fixed fold fade while the listing still extends below the viewport bottom. */
export function shouldShowHomeV2FoldBottomFade(
  listingBottom: number,
  viewportHeight: number,
): boolean {
  return listingBottom > viewportHeight;
}

export function readHomeViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}
