import { MarketplaceIcon } from "../MarketplaceIcon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { DashboardPublisherEntry } from "./types";

type DashboardPublisherSelectProps = {
  publishers: DashboardPublisherEntry[];
  value: string;
  onValueChange: (publisherId: string) => void;
  triggerClassName?: string;
  size?: "sm" | "default";
  variant?: "default" | "identity";
};

export function DashboardPublisherSelect({
  publishers,
  value,
  onValueChange,
  triggerClassName,
  size = "sm",
  variant = "default",
}: DashboardPublisherSelectProps) {
  const selected = publishers.find((entry) => entry.publisher?._id === value) ?? null;
  const isIdentity = variant === "identity";

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label="Dashboard publisher"
        size={isIdentity ? "sm" : size}
        className={
          triggerClassName ?? (isIdentity ? "dashboard-header-publisher-trigger" : "min-w-[160px]")
        }
      >
        {selected?.publisher ? (
          isIdentity ? (
            <IdentityPublisherLabel publisher={selected.publisher} />
          ) : (
            <PublisherOption publisher={selected.publisher} />
          )
        ) : (
          <SelectValue placeholder="Select publisher" />
        )}
      </SelectTrigger>
      <SelectContent>
        {publishers
          .filter((entry) => entry.publisher)
          .map((entry) => (
            <SelectItem key={entry.publisher!._id} value={entry.publisher!._id}>
              <PublisherOption publisher={entry.publisher!} />
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function IdentityPublisherLabel({
  publisher,
}: {
  publisher: NonNullable<DashboardPublisherEntry["publisher"]>;
}) {
  return (
    <span className="dashboard-header-publisher-label">
      <span className="dashboard-header-handle">@{publisher.handle}</span>
    </span>
  );
}

function PublisherOption({ publisher }: { publisher: DashboardPublisherEntry["publisher"] }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full">
        <MarketplaceIcon
          kind={publisher.kind === "org" ? "org" : "user"}
          label={publisher.displayName || publisher.handle}
          imageUrl={publisher.image}
          size="xs"
        />
      </span>
      <span className="truncate">
        @{publisher.handle} · {publisher.kind === "org" ? "Org" : "Personal"}
      </span>
    </span>
  );
}
