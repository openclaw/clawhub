import { useState, type ReactNode } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
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

type PromotionPageStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

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
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}`;
}

function escapeModelField(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function parseModelLine(line: string) {
  const fields = [""];
  let escaped = false;

  for (const character of line) {
    const fieldIndex = fields.length - 1;
    if (escaped) {
      fields[fieldIndex] += character === "\\" || character === "|" ? character : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      fields.push("");
    } else {
      fields[fieldIndex] += character;
    }
  }
  if (escaped) fields[fields.length - 1] += "\\";

  return fields.map((field) => field.trim());
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
        const modelRef = escapeModelField(model.modelRef);
        const alias = model.alias ? escapeModelField(model.alias) : "";
        if (model.suggestedDefault) {
          return `${modelRef} | ${alias} | default`;
        }
        return alias ? `${modelRef} | ${alias}` : modelRef;
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
    const fields = parseModelLine(trimmed);
    if (fields.length > 3) {
      return { error: "Model lines may contain at most three fields." };
    }
    const [modelRef = "", alias = "", flag = ""] = fields;
    if (!modelRef) continue;
    if (flag && flag.toLowerCase() !== "default") {
      return { error: 'The third model field must be "default" when provided.' };
    }
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
  pageStatus = promotions === undefined ? "LoadingFirstPage" : "Exhausted",
  onCreate,
  onLoadMore,
  onUpdate,
  onSetStatus,
}: {
  promotions: PromotionEntry[] | undefined;
  pageStatus?: PromotionPageStatus;
  onCreate: (input: PromotionInput) => Promise<boolean>;
  onLoadMore?: () => void;
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
                {promotion.status === "draft" ? (
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
              </div>
            </div>
          ))
        )}
      </div>
      {onLoadMore && (pageStatus === "CanLoadMore" || pageStatus === "LoadingMore") ? (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={pageStatus === "LoadingMore"}
            onClick={onLoadMore}
          >
            {pageStatus === "LoadingMore" ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}

      <h3 className="section-title text-[1.05rem] m-0 mt-6">
        {editingSlug ? `Edit "${editingSlug}"` : "Create promotion"}
      </h3>
      <div className="promotion-form-grid">
        <PromotionField id="promotion-slug" label="Slug *">
          <Input
            id="promotion-slug"
            value={form.slug}
            placeholder="spring-models-launch"
            onChange={(event) => setField("slug")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-title" label="Title *">
          <Input
            id="promotion-title"
            value={form.title}
            placeholder="Free models from Acme"
            onChange={(event) => setField("title")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-sponsor" label="Sponsor">
          <Input
            id="promotion-sponsor"
            value={form.sponsor}
            placeholder="Acme"
            onChange={(event) => setField("sponsor")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-blurb" label="Blurb *" className="promotion-form-field-wide">
          <Textarea
            id="promotion-blurb"
            rows={2}
            className="min-h-[64px]"
            value={form.blurb}
            placeholder="A limited-time free model offer."
            onChange={(event) => setField("blurb")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-starts" label="Starts *">
          <Input
            id="promotion-starts"
            type="datetime-local"
            step="0.001"
            value={form.startsAt}
            onChange={(event) => setField("startsAt")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-ends" label="Ends *">
          <Input
            id="promotion-ends"
            type="datetime-local"
            step="0.001"
            value={form.endsAt}
            onChange={(event) => setField("endsAt")(event.target.value)}
          />
        </PromotionField>
        <PromotionField
          id="promotion-models"
          label="Models *"
          hint="One per line: modelRef | alias | default — alias is a typed identifier (letters, digits, . _ : - only, no spaces)"
          className="promotion-form-field-wide"
        >
          <Textarea
            id="promotion-models"
            rows={3}
            className="mono min-h-[84px]"
            value={form.models}
            placeholder="provider/org/model-name | model-alias | default"
            onChange={(event) => setField("models")(event.target.value)}
          />
        </PromotionField>
        <PromotionField
          id="promotion-provider"
          label="Provider"
          hint="Provider id the CLI resolves locally"
        >
          <Input
            id="promotion-provider"
            value={form.provider}
            placeholder="provider-id"
            onChange={(event) => setField("provider")(event.target.value)}
          />
        </PromotionField>
        <PromotionField
          id="promotion-auth-choice"
          label="Auth choice"
          hint="Onboarding auth choice id"
        >
          <Input
            id="promotion-auth-choice"
            value={form.authChoiceId}
            placeholder="provider-api-key"
            onChange={(event) => setField("authChoiceId")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-plugins" label="Plugins" hint="Comma-separated package names">
          <Input
            id="promotion-plugins"
            value={form.pluginNames}
            placeholder="plugin-name, another-plugin"
            onChange={(event) => setField("pluginNames")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-signup-url" label="Signup URL">
          <Input
            id="promotion-signup-url"
            value={form.signupUrl}
            placeholder="https://…"
            onChange={(event) => setField("signupUrl")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-docs-url" label="Docs URL">
          <Input
            id="promotion-docs-url"
            value={form.docsUrl}
            placeholder="https://…"
            onChange={(event) => setField("docsUrl")(event.target.value)}
          />
        </PromotionField>
        <PromotionField id="promotion-launch-url" label="Launch page URL">
          <Input
            id="promotion-launch-url"
            value={form.launchPageUrl}
            placeholder="https://…"
            onChange={(event) => setField("launchPageUrl")(event.target.value)}
          />
        </PromotionField>
      </div>
      {formError ? <p className="section-subtitle m-0 mt-3 text-red-500">{formError}</p> : null}
      <div className="mt-4 flex items-center gap-2">
        <Button type="button" onClick={submit} disabled={submitting}>
          {editingSlug ? "Save changes" : "Create draft"}
        </Button>
        {editingSlug ? (
          <Button type="button" variant="outline" onClick={resetForm} disabled={submitting}>
            Cancel edit
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PromotionField({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `promotion-form-field ${className}` : "promotion-form-field"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="promotion-form-hint">{hint}</p> : null}
    </div>
  );
}
