import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  FEATURED_EDITORIAL_SLOTS,
  type EditorialSelection,
} from "../../../convex/lib/featuredSelections";
import { Button } from "../../components/ui/button";
import { insightTime as date } from "./insightTime";

export function FeaturedEditorial({
  artifactKind,
  reportRevision,
}: {
  artifactKind: "plugin" | "skill";
  reportRevision?: number;
}) {
  const state = useQuery(api.featuredSelections.get, { artifactKind });
  const save = useMutation(api.featuredSelections.saveEditorial);
  const [draft, setDraft] = useState<{ revision: number; items: EditorialSelection[] } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!state) return <p role="status">Loading saved Featured selections…</p>;
  const published = state.published;
  const editing = artifactKind === "plugin" && draft !== null;
  const stale = editing && draft.revision !== state.revision;
  function update(index: number, field: "name" | "displayName" | "reason", value: string) {
    setDraft(
      (current) =>
        current && {
          ...current,
          items: current.items.map((item, i) =>
            i === index
              ? { ...item, [field]: value, ...(field === "name" ? { id: `plugin:${value}` } : {}) }
              : item,
          ),
        },
    );
  }
  function move(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return null;
      const items = [...current.items];
      [items[index], items[index + direction]] = [items[index + direction], items[index]];
      return { ...current, items };
    });
  }
  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await save({ expectedRevision: draft.revision, items: draft.items });
      setDraft(null);
      setMessage(
        "Editorial choices saved. Refresh the recommendation report to use this revision. Public Featured has not changed.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Editorial choices could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="featured-editorial" aria-label="Saved Featured selections">
      <div className="search-insights-header">
        <div>
          <h2>Saved Featured selections</h2>
          <p>
            {published
              ? `${published.items.length} published ${artifactKind === "plugin" ? "plugins" : "skills"} · ${date(published.at)}`
              : "No approved selection has been published through this workflow yet."}
          </p>
        </div>
        {artifactKind === "plugin" && !editing ? (
          <Button
            variant="outline"
            onClick={() => {
              setDraft({
                revision: state.revision,
                items: state.editorial.map((item) => ({ ...item })),
              });
              setError(null);
              setMessage(null);
            }}
          >
            Edit editorial choices
          </Button>
        ) : null}
      </div>
      {artifactKind === "plugin" &&
      reportRevision !== undefined &&
      reportRevision !== state.revision ? (
        <p role="alert">
          The report uses editorial revision {reportRevision}; saved choices are revision{" "}
          {state.revision}. Refresh before approving publication.
        </p>
      ) : null}
      {artifactKind === "plugin" ? (
        <p>
          Eight editorial slots stay reserved, followed by eight distinct install-ranked plugins.
          Saving choices does not publish them.
        </p>
      ) : (
        <p>
          Sixteen eligible native ClawHub skills, ranked by recorded installs. No editorial slots.
        </p>
      )}
      {published ? (
        <details>
          <summary>Published order and evidence</summary>
          <p>
            {date(published.periodStart)} inclusive to {date(published.periodEnd)} exclusive.
            Published by staff {published.byUserId}.
          </p>
          <ol>
            {published.items.map((item) => (
              <li key={item.id}>
                <strong>{item.id}</strong> · {item.version} ·{" "}
                {item.selectionBasis === "editorial" ? "Editorial" : "Recorded installs"}
                {item.installs30d === undefined
                  ? null
                  : ` · ${item.installs30d.toLocaleString()} installs / 30 days · ${item.installs7d?.toLocaleString() ?? "Unknown"} / final 7 days`}
                <p>{item.reason}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveDraft();
          }}
        >
          <p>Editing revision {draft.revision}. Order determines editorial positions.</p>
          {stale ? (
            <p role="alert">
              The saved editorial choices changed while you were editing. Cancel and reload before
              saving.
            </p>
          ) : null}
          <ol className="featured-editorial-list">
            {draft.items.map((item, index) => (
              <li key={index}>
                <fieldset disabled={saving} className="featured-editorial-row">
                  <legend>Editorial slot {index + 1}</legend>
                  <label>
                    Plugin name
                    <input
                      required
                      maxLength={200}
                      value={item.name}
                      onChange={(event) =>
                        update(index, "name", event.target.value.trim().toLowerCase())
                      }
                      placeholder="@publisher/plugin"
                    />
                  </label>
                  <label>
                    Display name
                    <input
                      required
                      maxLength={120}
                      value={item.displayName}
                      onChange={(event) => update(index, "displayName", event.target.value)}
                    />
                  </label>
                  <label className="featured-editorial-reason">
                    Editorial reason
                    <textarea
                      required
                      maxLength={500}
                      value={item.reason}
                      onChange={(event) => update(index, "reason", event.target.value)}
                    />
                  </label>
                  <div className="featured-editorial-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move slot ${index + 1} up`}
                    >
                      Move up
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={index === draft.items.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move slot ${index + 1} down`}
                    >
                      Move down
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              items: current.items.filter((_, i) => i !== index),
                            },
                        )
                      }
                    >
                      Clear slot {index + 1}
                    </Button>
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>
          <div className="featured-editorial-actions">
            {draft.items.length < FEATURED_EDITORIAL_SLOTS ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() =>
                  setDraft(
                    (current) =>
                      current && {
                        ...current,
                        items: [
                          ...current.items,
                          { id: "plugin:", name: "", displayName: "", reason: "" },
                        ],
                      },
                  )
                }
              >
                Add editorial choice
              </Button>
            ) : null}
            <Button type="submit" disabled={saving || stale}>
              {saving ? "Saving…" : "Save editorial choices"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : artifactKind === "plugin" ? (
        <details>
          <summary>Current editorial reservations · revision {state.revision}</summary>
          <ol>
            {Array.from({ length: FEATURED_EDITORIAL_SLOTS }, (_, index) => {
              const reservation = state.reservations[index];
              const pending = !reservation?.currentArtifact?.eligibleForFeatured;
              return (
                <li key={index}>
                  <strong>{reservation?.displayName ?? "Unassigned editorial slot"}</strong>
                  {reservation ? ` · ${reservation.name}` : ""} ·{" "}
                  {pending ? "Pending" : "Ready for review"}
                  <p>
                    {reservation?.reason ?? "This slot stays reserved for an editorial choice."}
                  </p>
                  {pending ? (
                    <p>
                      {reservation?.pendingReasons.join(", ") || "No plugin selected"}. Not shown as
                      a public card.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </details>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
