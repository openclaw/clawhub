import type { Doc } from "../../convex/_generated/dataModel";

type User = Doc<"users"> | null | undefined;

type Skill = Pick<Doc<"skills">, "ownerUserId"> | null | undefined;

export function isAdmin(user: User) {
  return user?.role === "admin";
}

export function isModerator(user: User) {
  return user?.role === "admin" || user?.role === "moderator";
}

export function canManageSkill(user: User, skill: Skill) {
  if (!user || !skill) return false;
  return user._id === skill.ownerUserId || isModerator(user);
}
