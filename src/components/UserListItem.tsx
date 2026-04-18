import { Link } from "@tanstack/react-router";
import { MarketplaceIcon } from "./MarketplaceIcon";
import type { PublicUser } from "../lib/publicUser";

type UserListItemProps = {
  user: PublicUser;
};

export function UserListItem({ user }: UserListItemProps) {
  const handle = user.handle?.trim();
  if (!handle) return null;

  const displayName = user.displayName ?? user.name ?? handle;

  return (
    <Link to="/u/$handle" params={{ handle }} className="skill-list-item user-list-item" aria-label={`User: ${displayName}`}>
      <MarketplaceIcon kind="user" label={displayName} imageUrl={user.image} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-name">{displayName}</span>
          <span className="skill-list-item-owner">@{handle}</span>
        </div>
        <p className="skill-list-item-summary">{user.bio?.trim() || "Builder on ClawHub."}</p>
        <div className="skill-list-item-meta">
          <span className="skill-list-item-meta-item">User</span>
          <span className="skill-list-item-meta-item">Profile</span>
        </div>
      </div>
    </Link>
  );
}
