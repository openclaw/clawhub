import { MarketplaceIcon } from "./MarketplaceIcon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type PublisherOwnerMembership = {
  publisher: {
    _id: string;
    handle: string;
    displayName: string;
    kind: "user" | "org";
    image?: string | null;
  };
  role: "owner" | "admin" | "publisher";
};

type PublisherOwnerSelectProps = {
  id: string;
  value: string;
  memberships: PublisherOwnerMembership[] | undefined;
  disabled?: boolean;
  onValueChange: (value: string) => void;
};

export function PublisherOwnerSelect({
  id,
  value,
  memberships,
  disabled,
  onValueChange,
}: PublisherOwnerSelectProps) {
  const availableMemberships = memberships ?? [];
  const selected = availableMemberships.find((entry) => entry.publisher.handle === value) ?? null;

  if (availableMemberships.length === 0) {
    return (
      <button
        id={id}
        type="button"
        aria-label="Owner"
        disabled
        className="flex w-full min-h-[44px] items-center justify-between rounded-[var(--radius-sm)] border border-input-border bg-input-bg px-3.5 py-space-3 text-sm text-[color:var(--ink)] opacity-60"
      >
        <span className="truncate">{value ? `@${value}` : "Select owner"}</span>
      </button>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label="Owner">
        {selected ? (
          <PublisherOwnerOption membership={selected} />
        ) : value ? (
          <span className="truncate">@{value}</span>
        ) : (
          <SelectValue placeholder="Select owner" />
        )}
      </SelectTrigger>
      <SelectContent>
        {availableMemberships.map((entry) => (
          <SelectItem key={entry.publisher._id} value={entry.publisher.handle}>
            <PublisherOwnerOption membership={entry} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function formatPublisherRole(role: PublisherOwnerMembership["role"]) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function PublisherOwnerOptionLabel({ membership }: { membership: PublisherOwnerMembership }) {
  const { publisher, role } = membership;
  return (
    <span className="min-w-0 truncate">
      <span className="text-[color:var(--ink-soft)]">@{publisher.handle}</span>
      <span className="text-[color:var(--ink-soft)]" aria-hidden="true">
        {" "}
        ·{" "}
      </span>
      <span className="font-medium text-[color:var(--ink)]">{publisher.displayName}</span>
      <span className="text-[color:var(--ink-soft)]" aria-hidden="true">
        {" "}
        ·{" "}
      </span>
      <span className="text-[color:var(--ink-soft)]">{formatPublisherRole(role)}</span>
    </span>
  );
}

function PublisherOwnerOption({ membership }: { membership: PublisherOwnerMembership }) {
  const { publisher } = membership;
  return (
    <span className="flex min-w-0 items-center gap-2 leading-none">
      <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full">
        <MarketplaceIcon
          kind={publisher.kind}
          label={publisher.displayName || publisher.handle}
          imageUrl={publisher.image}
          size="xs"
        />
      </span>
      <PublisherOwnerOptionLabel membership={membership} />
    </span>
  );
}
