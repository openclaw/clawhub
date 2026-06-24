import { CATALOG_TOPIC_LIMIT, normalizeCatalogTopic } from "clawhub-schema";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../lib/utils";

type CatalogTopicInputProps = {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

function formatCatalogTopicChip(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function parseCatalogTopicsInput(value: string) {
  const topics: string[] = [];
  let current = "";
  let quoted = false;

  // Parse one CSV-style record so quoted topic labels can contain commas.
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
      } else if (!current.trim()) {
        quoted = true;
      } else {
        current += character;
      }
    } else if (character === "," && !quoted) {
      topics.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  topics.push(current.trim());
  return topics.filter(Boolean);
}

export function formatCatalogTopicsInput(values: readonly string[]) {
  return values
    .map((topic) => (/[,"]/.test(topic) ? `"${topic.replaceAll('"', '""')}"` : topic))
    .join(", ");
}

export function CatalogTopicInput({ id, value, disabled, onChange }: CatalogTopicInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const topics = parseCatalogTopicsInput(value);
  const limitReached = topics.length >= CATALOG_TOPIC_LIMIT;

  function commitDraft() {
    const topic = draft.trim();
    if (!topic || limitReached) return;

    const topicSlug = normalizeCatalogTopic(topic);
    const duplicate = topics.some(
      (existingTopic) => normalizeCatalogTopic(existingTopic) === topicSlug,
    );
    if (!duplicate) {
      onChange(formatCatalogTopicsInput([...topics, topicSlug ?? topic]));
    }
    setDraft("");
  }

  function removeTopic(index: number) {
    onChange(formatCatalogTopicsInput(topics.filter((_, topicIndex) => topicIndex !== index)));
    inputRef.current?.focus();
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex min-h-[44px] w-full flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-input-border bg-input-bg px-3 py-2 text-[color:var(--ink)] transition-all duration-[180ms] ease-out focus-within:border-input-focus-border focus-within:shadow-[0_0_0_3px_var(--input-focus-ring)]",
        disabled && "cursor-not-allowed opacity-60",
      )}
      aria-disabled={disabled}
      onBlur={(event) => {
        if (event.relatedTarget && containerRef.current?.contains(event.relatedTarget as Node)) {
          return;
        }
        commitDraft();
      }}
      onClick={() => {
        if (!disabled) inputRef.current?.focus();
      }}
    >
      {topics.map((topic, index) => (
        <span
          key={`${normalizeCatalogTopic(topic) ?? topic}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-pill)] border border-line bg-hover-bg py-1 pr-1 pl-2.5 text-xs font-semibold text-ink-soft"
        >
          <span className="truncate">#{formatCatalogTopicChip(topic)}</span>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-ink-soft transition-colors hover:bg-active-bg hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            aria-label={`Remove ${topic} topic`}
            title={`Remove ${topic}`}
            onClick={(event) => {
              event.stopPropagation();
              removeTopic(index);
            }}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        className="catalog-topic-input min-w-[9rem] flex-1 bg-transparent py-1 text-[color:var(--ink)] outline-none placeholder:text-input-placeholder disabled:cursor-not-allowed disabled:opacity-60"
        value={draft}
        disabled={disabled}
        aria-label="Topics"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={limitReached ? "Maximum 5 topics" : "Add a topic"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            if (!draft.trim()) return;
            event.preventDefault();
            commitDraft();
            return;
          }
          if (event.key === "Backspace" && !draft && topics.length) {
            event.preventDefault();
            removeTopic(topics.length - 1);
          }
        }}
      />
    </div>
  );
}
