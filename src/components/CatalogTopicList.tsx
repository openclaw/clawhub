import { normalizeCatalogTopic } from "clawhub-schema";

type CatalogTopicListProps = {
  topics?: string[] | null;
  limit?: number;
  ariaLabel?: string;
};

function formatCatalogTopicChip(value: string) {
  const normalized = normalizeCatalogTopic(value);
  return `#${normalized ?? value.trim().normalize("NFKC").toLocaleLowerCase("en-US")}`;
}

export function CatalogTopicList({
  topics,
  limit = 4,
  ariaLabel = "Topics",
}: CatalogTopicListProps) {
  const visibleTopics = (topics ?? []).slice(0, limit);
  if (visibleTopics.length === 0) return null;

  return (
    <div className="catalog-topics" aria-label={ariaLabel}>
      {visibleTopics.map((topic) => (
        <span key={topic} className="catalog-topic">
          {formatCatalogTopicChip(topic)}
        </span>
      ))}
    </div>
  );
}
