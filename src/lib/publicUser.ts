import type { Doc } from "../../convex/_generated/dataModel";

export type PublicUser = Pick<
  Doc<"users">,
  "_id" | "_creationTime" | "handle" | "name" | "displayName" | "image" | "bio"
>;

export type PublicPublisher = Pick<
  Doc<"publishers">,
  "_id" | "_creationTime" | "kind" | "handle" | "displayName" | "image" | "bio" | "linkedUserId"
>;

export type PublicSkill = Pick<
  Doc<"skills">,
  | "_id"
  | "_creationTime"
  | "slug"
  | "displayName"
  | "summary"
  | "ownerUserId"
  | "ownerPublisherId"
  | "canonicalSkillId"
  | "forkOf"
  | "latestVersionId"
  | "tags"
  | "badges"
  | "stats"
  | "createdAt"
  | "updatedAt"
>;

export type PublicSoul = Pick<
  Doc<"souls">,
  | "_id"
  | "_creationTime"
  | "slug"
  | "displayName"
  | "summary"
  | "ownerUserId"
  | "ownerPublisherId"
  | "latestVersionId"
  | "tags"
  | "stats"
  | "createdAt"
  | "updatedAt"
>;
