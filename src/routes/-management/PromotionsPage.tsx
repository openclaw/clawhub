import { useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  formatTimestamp,
  type PromotionEntry,
  type PromotionInput,
  type PromotionStatus,
} from "./managementShared";

type PromotionFormState = {
  slug: string;
  title: string;
  blurb: string;
  sponsor: string;
  provider: string;
  authChoiceId: string;
  startsAt: string;
  endsAt: string;
  pluginNames: string;
  models: string;
  signupUrl: string;
  docsUrl: string;
  launchPageUrl: string;
};

const EMPTY_FORM: PromotionFormState = {
  slug: "",
  title: "",
  blurb: "",
  sponsor: "",
  provider: "",
  authChoiceId: "",
  startsAt: "",
  endsAt: "",
  pluginNames: "",
  models: "",
  signupUrl: "",
  docsUrl: "",
  launchPageUrl: "",
};

function toDatetimeLocal(value: number) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function promotionToForm(promotion: PromotionEntry): PromotionFormState {
  return {
    slug: promotion.slug,
    title: promotion.title,
    blurb: promotion.blurb,
    sponsor: promotion.sponsor ?? "",
    provider: promotion.provider ?? "",
    authChoiceId: promotion.authChoiceId ?? "",
    startsAt: toDatetimeLocal(promotion.startsAt),
    endsAt: toDatetimeLocal(promotion.endsAt),
    pluginNames: (promotion.pluginNames ?? []).join(", "),
    models: promotion.models
      .map((model) => {
        if (model.suggestedDefault) {
          return `${model.modelRef} | ${model.alias ?? ""} | default`;
        }
        return model.alias ? `${model.modelRef} | ${model.alias}` : model.modelRef;
      })
      .join("\n"),
    signupUrl: promotion.signupUrl ?? "",
    docsUrl: promotion.docsUrl ?? "",
    launchPageUrl: promotion.launchPageUrl ?? "",
  };
}

function parseForm(form: PromotionFormState): { input: PromotionInput } | { error: string } {
  const startsAt = form.startsAt ? new Date(form.startsAt).getTime() : Number.NaN;
  const endsAt = form.endsAt ? new Date(form.endsAt).getTime() : Number.NaN;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return { error: "Start and end times are required." };
  }

  const models: PromotionInput["models"] = [];
  for (const line of form.models.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [modelRef = "", alias = "", flag = ""] = trimmed.split("|").map((part) => part.trim());
    if (!modelRef) continue;
    models.push({
      modelRef,
      ...(alias ? { alias } : {}),
      ...(flag.toLowerCase() === "default" ? { suggestedDefault: true } : {}),
    });
  }
  if (models.length === 0) {
    return { error: "At least one model line is required (modelRef | alias | default)." };
  }

  const pluginNames = form.pluginNames
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    input: {
      slug: form.slug.trim().toLowerCase(),
      title: form.title.trim(),
      blurb: form.blurb.trim(),
      ...(form.sponsor.trim() ? { sponsor: form.sponsor.trim() } : {}),
      startsAt,
      endsAt,
      ...(form.provider.trim() ? { provider: form.provider.trim() } : {}),
      ...(form.authChoiceId.trim() ? { authChoiceId: form.authChoiceId.trim() } : {}),
      ...(pluginNames.length > 0 ? { pluginNames } : {}),
      models,
      ...(form.signupUrl.trim() ? { signupUrl: form.signupUrl.trim() } : {}),
      ...(form.docsUrl.trim() ? { docsUrl: form.docsUrl.trim() } : {}),
      ...(form.launchPageUrl.trim() ? { launchPageUrl: form.launchPageUrl.trim() } : {}),
    },
  };
}

function statusBadgeLabel(promotion: PromotionEntry, now: number) {
  if (promotion.status !== "active") return promotion.status;
  if (now < promotion.startsAt) return "active (starts soon)";
  if (now > promotion.endsAt) return "active (window over)";
  return "active";
}

export function PromotionsPage({
  promotions,
  onCreate,
  onUpdate,
  onSetStatus,
}: {
  promotions: PromotionEntry[] | undefined;
  onCreate: (input: PromotionInput) => Promise<boolean>;
  onUpdate: (targetSlug: string, input: PromotionInput) => Promise<boolean>;
  onSetStatus: (slug: string, status: PromotionStatus) => void;
}) {
  const [form, setForm] = useState<PromotionFormState>(EMPTY_FORM);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const now = Date.now();

  const setField = (field: keyof PromotionFormState) => (value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingSlug(null);
    setFormError(null);
  };

  const submit = () => {
    const parsed = parseForm(form);
    if ("error" in parsed) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    const request = editingSlug ? onUpdate(editingSlug, parsed.input) : onCreate(parsed.input);
    void request
      .then((ok) => {
        if (ok) resetForm();
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">Promotions</h2>
      <p className="section-subtitle m-0 mt-1">
        Promotional offers surfaced to the OpenClaw CLI at runtime. New promotions start as drafts;
        only active promotions inside their window are visible publicly.
      </p>

      <div className="management-list">
        {promotions === undefined ? (
          <div className="management-empty">Loading promotions…</div>
        ) : promotions.length === 0 ? (
          <div className="management-empty">No promotions yet. Create the first one below.</div>
        ) : (
          promotions.map((promotion) => (
            <div key={promotion._id} className="management-item">
              <div className="management-item-main">
                <strong>{promotion.title}</strong>
                <div className="section-subtitle m-0">
                  {promotion.slug}
                  {promotion.sponsor ? ` · ${promotion.sponsor}` : ""}
                  {promotion.provider ? ` · via ${promotion.provider}` : ""} ·{" "}
                  {formatTimestamp(promotion.startsAt)} → {formatTimestamp(promotion.endsAt)}
                </div>
                <div className="management-tags">
                  <Badge>{statusBadgeLabel(promotion, now)}</Badge>
                  {promotion.models.map((model) => (
                    <Badge key={model.modelRef}>
                      {model.modelRef}
                      {model.suggestedDefault ? " ★" : ""}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="management-actions management-action-grid">
                <Button
                  className="management-action-btn"
                  type="button"
                  onClick={() => {
                    setForm(promotionToForm(promotion));
                    setEditingSlug(promotion.slug);
                    setFormError(null);
                  }}
                >
                  Edit
                </Button>
                {promotion.status !== "active" ? (
                  <Button
                    className="management-action-btn"
                    type="button"
                    onClick={() => onSetStatus(promotion.slug, "active")}
                  >
                    Activate
                  </Button>
                ) : null}
                {promotion.status === "active" ? (
                  <Button
                    className="management-action-btn"
                    type="button"
                    onClick={() => onSetStatus(promotion.slug, "ended")}
                  >
                    End
                  </Button>
                ) : null}
                {promotion.status === "ended" ? (
                  <Button
                    className="management-action-btn"
                    type="button"
                    onClick={() => onSetStatus(promotion.slug, "draft")}
                  >
                    Back to draft
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <h3 className="section-title text-[1.05rem] m-0 mt-4">
        {editingSlug ? `Edit "${editingSlug}"` : "Create promotion"}
      </h3>
      <div className="management-controls" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <PromotionField
          label="Slug"
          value={form.slug}
          onChange={setField("slug")}
          placeholder="tencent-openrouter-launch"
        />
        <PromotionField
          label="Title"
          value={form.title}
          onChange={setField("title")}
          placeholder="Free Tencent models via OpenRouter"
        />
        <PromotionField
          label="Sponsor"
          value={form.sponsor}
          onChange={setField("sponsor")}
          placeholder="Tencent"
        />
        <PromotionField
          label="Provider"
          value={form.provider}
          onChange={setField("provider")}
          placeholder="openrouter"
        />
        <PromotionField
          label="Auth choice"
          value={form.authChoiceId}
          onChange={setField("authChoiceId")}
          placeholder="openrouter-api-key"
        />
        <PromotionField
          label="Starts"
          type="datetime-local"
          value={form.startsAt}
          onChange={setField("startsAt")}
        />
        <PromotionField
          label="Ends"
          type="datetime-local"
          value={form.endsAt}
          onChange={setField("endsAt")}
        />
        <PromotionField
          label="Signup URL"
          value={form.signupUrl}
          onChange={setField("signupUrl")}
          placeholder="https://…"
        />
        <PromotionField
          label="Docs URL"
          value={form.docsUrl}
          onChange={setField("docsUrl")}
          placeholder="https://…"
        />
        <PromotionField
          label="Launch page URL"
          value={form.launchPageUrl}
          onChange={setField("launchPageUrl")}
          placeholder="https://…"
        />
        <PromotionField
          label="Plugins (comma-sep)"
          value={form.pluginNames}
          onChange={setField("pluginNames")}
          placeholder="openrouter"
        />
      </div>
      <label className="section-subtitle m-0 mt-2" htmlFor="promotion-blurb">
        Blurb
      </label>
      <textarea
        id="promotion-blurb"
        rows={2}
        value={form.blurb}
        onChange={(event) => setField("blurb")(event.target.value)}
        placeholder="Two weeks of free Tencent Hunyuan inference served through OpenRouter."
      />
      <label className="section-subtitle m-0 mt-2" htmlFor="promotion-models">
        Models — one per line: modelRef | alias | default
      </label>
      <textarea
        id="promotion-models"
        rows={3}
        className="mono"
        value={form.models}
        onChange={(event) => setField("models")(event.target.value)}
        placeholder="openrouter/tencent/hunyuan-a13b | Hunyuan A13B | default"
      />
      {formError ? <p className="section-subtitle m-0 mt-2 text-red-500">{formError}</p> : null}
      <div className="management-controls mt-2">
        <Button type="button" onClick={submit} disabled={submitting}>
          {editingSlug ? "Save changes" : "Create draft"}
        </Button>
        {editingSlug ? (
          <Button type="button" onClick={resetForm} disabled={submitting}>
            Cancel edit
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PromotionField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="management-control">
      <span className="mono">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
