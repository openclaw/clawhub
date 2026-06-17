type CatalogTopicListProps = {
  topics?: string[] | null;
  limit?: number;
};

export function CatalogTopicList({ topics, limit = 4 }: CatalogTopicListProps) {
  const visibleTopics = (topics ?? []).slice(0, limit);
  if (visibleTopics.length === 0) return null;

  return (
    <div className="catalog-topics" aria-label="Topics">
      {visibleTopics.map((topic) => (
        <span key={topic} className="catalog-topic">
          {topic}
        </span>
      ))}
    </div>
  );
}
