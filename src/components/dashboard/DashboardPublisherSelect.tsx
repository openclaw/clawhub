import { ChevronsUpDown } from "lucide-react";
import { MarketplaceIcon } from "../MarketplaceIcon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { DashboardPublisherEntry } from "./types";

type DashboardPublisherSelectProps = {
  publishers: DashboardPublisherEntry[];
  value: string;
  onValueChange: (publisherId: string) => void;
};

export function DashboardPublisherSelect({
  publishers,
  value,
  onValueChange,
}: DashboardPublisherSelectProps) {
  const selected = publishers.find((entry) => entry.publisher?._id === value) ?? null;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label="Dashboard publisher"
        size="sm"
        icon={<ChevronsUpDown className="h-4 w-4 opacity-50" />}
        className="dashboard-welcome-publisher-trigger"
      >
        {selected?.publisher ? (
          <PublisherOption publisher={selected.publisher} />
        ) : (
          <SelectValue placeholder="Select publisher" />
        )}
      </SelectTrigger>
      <SelectContent className="dashboard-publisher-select-content">
        {publishers
          .filter((entry) => entry.publisher)
          .map((entry) => (
            <SelectItem
              key={entry.publisher!._id}
              value={entry.publisher!._id}
              className="dashboard-publisher-select-item"
            >
              <PublisherOption publisher={entry.publisher!} />
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
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
      <span className="truncate">{publisher.displayName || publisher.handle}</span>
    </span>
  );
}
