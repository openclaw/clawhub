type CatalogTopicListProps = {
  topics?: string[] | null;
  limit?: number;
  ariaLabel?: string;
};

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
          {topic}
        </span>
      ))}
    </div>
  );
}
