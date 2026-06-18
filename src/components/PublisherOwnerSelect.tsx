import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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

export function PublisherContextStrip({
  ownerHandle,
  memberships,
  onSwitchPublisher,
  validation,
}: {
  ownerHandle: string;
  memberships: PublisherOwnerMembership[] | undefined;
  onSwitchPublisher: (publisherId: string) => void;
  validation?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label="Publishing as"
      className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 bg-[color:var(--surface-muted)] px-space-5 py-space-3 text-sm text-[color:var(--ink)]"
    >
      <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-center lg:gap-2">
        <span className="text-xs font-medium text-[color:var(--ink-soft)]">Publishing as</span>
        <span className="publishing-context-owner min-w-0">
          <PublisherOwnerDisplay value={ownerHandle} memberships={memberships} compact />
        </span>
      </div>
      {(memberships?.length ?? 0) > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="Switch publisher"
            >
              <span className="lg:hidden">Switch</span>
              <span className="hidden lg:inline">Switch publisher</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="publishing-context-switcher user-dropdown-subcontent user-dropdown-switcher-subcontent"
          >
            <div className="user-dropdown-section-label">Switch publisher</div>
            <div className="user-dropdown-publisher-list" aria-label="Switch publisher">
              {memberships?.map((entry) => {
                const publisherIdentity = (
                  <>
                    <span className="user-dropdown-publisher-icon" aria-hidden="true">
                      <MarketplaceIcon
                        kind={entry.publisher.kind}
                        label={entry.publisher.displayName || entry.publisher.handle}
                        imageUrl={entry.publisher.image}
                        size="xs"
                      />
                    </span>
                    <span className="user-dropdown-publisher-copy">
                      <span className="user-dropdown-publisher-title">
                        @{entry.publisher.handle}
                      </span>
                      <span className="user-dropdown-publisher-meta">
                        {entry.publisher.kind === "org" ? "Organization" : "Personal"}
                      </span>
                    </span>
                  </>
                );

                return entry.publisher.handle === ownerHandle ? (
                  <div
                    key={entry.publisher._id}
                    aria-label={`Selected publisher @${entry.publisher.handle}`}
                    className="user-dropdown-publisher-item user-dropdown-publisher-item-current"
                  >
                    {publisherIdentity}
                    <Check
                      className="user-dropdown-publisher-check"
                      size={16}
                      aria-label="Selected publisher"
                    />
                  </div>
                ) : (
                  <DropdownMenuItem
                    key={entry.publisher._id}
                    aria-label={`Switch to @${entry.publisher.handle}`}
                    className="user-dropdown-publisher-item"
                    onSelect={() => onSwitchPublisher(entry.publisher._id)}
                  >
                    {publisherIdentity}
                  </DropdownMenuItem>
                );
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {validation ? <div className="col-span-full">{validation}</div> : null}
    </div>
  );
}

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

function PublisherOwnerOption({ membership }: { membership: PublisherOwnerMembership }) {
  const { publisher, role } = membership;
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
      <span className="min-w-0 truncate">
        @{publisher.handle} · {publisher.displayName} · {role}
      </span>
    </span>
  );
}

export function PublisherOwnerDisplay({
  value,
  memberships,
  compact = false,
}: {
  value: string;
  memberships: PublisherOwnerMembership[] | undefined;
  compact?: boolean;
}) {
  const selected = (memberships ?? []).find((entry) => entry.publisher.handle === value) ?? null;
  if (selected && compact) {
    const { publisher } = selected;
    return (
      <span className="flex min-w-0 items-center gap-2 leading-snug">
        <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full">
          <MarketplaceIcon
            kind={publisher.kind}
            label={publisher.displayName || publisher.handle}
            imageUrl={publisher.image}
            size="xs"
          />
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-[color:var(--ink)]">
          {publisher.displayName || publisher.handle}
          <span className="text-[13px] font-normal text-[color:var(--ink-soft)]">
            {" "}
            / @{publisher.handle}
          </span>
        </span>
      </span>
    );
  }

  return selected ? (
    <PublisherOwnerOption membership={selected} />
  ) : (
    <span className="truncate">{value ? `@${value}` : "No publisher selected"}</span>
  );
}
