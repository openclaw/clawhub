type VersionChangelogProps = {
  text: string | null | undefined;
};

export function VersionChangelog({ text }: VersionChangelogProps) {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const lines = trimmed
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const isBulletList = lines.length > 1 && lines.every((line) => /^[-*]\s+/.test(line));

  if (isBulletList) {
    return (
      <ul className="version-changelog-list">
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>{line.replace(/^[-*]\s+/, "")}</li>
        ))}
      </ul>
    );
  }

  return (
    <div className="version-changelog-text">
      {trimmed.split(/\n{2,}/).map((paragraph, index) => (
        <p key={`${index}-${paragraph}`}>{paragraph}</p>
      ))}
    </div>
  );
}
