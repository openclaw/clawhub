export type EmbeddingVisibility =
  | 'latest'
  | 'latest-approved'
  | 'archived'
  | 'archived-approved'
  | 'deleted'

export function embeddingVisibilityFor(isLatest: boolean, isApproved: boolean): Exclude<
  EmbeddingVisibility,
  'deleted'
> {
  if (isLatest && isApproved) return 'latest-approved'
  if (isLatest) return 'latest'
  if (isApproved) return 'archived-approved'
  return 'archived'
}

