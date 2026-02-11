import type { Doc } from '../../convex/_generated/dataModel'

export type PublicUser = Pick<
  Doc<'users'>,
  '_id' | '_creationTime' | 'handle' | 'name' | 'displayName' | 'image' | 'bio'
>

export type PublicSkill = Pick<
  Doc<'skills'>,
  | '_id'
  | '_creationTime'
  | 'slug'
  | 'displayName'
  | 'summary'
  | 'ownerUserId'
  | 'thirdPartyServiceOverride'
  | 'canonicalSkillId'
  | 'forkOf'
  | 'latestVersionId'
  | 'tags'
  | 'badges'
  | 'stats'
  | 'createdAt'
  | 'updatedAt'
>

export type PublicSoul = Pick<
  Doc<'souls'>,
  | '_id'
  | '_creationTime'
  | 'slug'
  | 'displayName'
  | 'summary'
  | 'ownerUserId'
  | 'latestVersionId'
  | 'tags'
  | 'stats'
  | 'createdAt'
  | 'updatedAt'
>
