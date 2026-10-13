import { PLUGIN_CATEGORY_DEFINITIONS, type ManagedMcpDefinition } from "clawhub-schema";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { buildPluginDetailHref } from "../../lib/pluginRoutes";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

type PublicationReceipt = Pick<
  FunctionReturnType<typeof api.managedMcp.publish>,
  "releaseId" | "attemptId" | "publicationStatus"
> & { name: string; version: string };

export function ManagedMcpTools({ packageName }: { packageName?: string }) {
  const getDefinition = useAction(api.managedMcp.getDefinition);
  const unpublish = useAction(api.managedMcp.unpublish);
  const [editor, setEditor] = useState<{ definition?: ManagedMcpDefinition } | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [publication, setPublication] = useState<PublicationReceipt | null>(null);
  const [managedId, setManagedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const id = packageName?.startsWith("@openclaw/") ? packageName.slice("@openclaw/".length) : null;

  useEffect(() => {
    let current = true;
    setManagedId(null);
    if (id) {
      // The scope alone does not establish ownership or a managed bundle's eligibility.
      void getDefinition({ id }).then(
        (definition) => {
          if (current && definition) setManagedId(id);
        },
        () => {
          // Ordinary packages and failed verification must not expose managed actions.
        },
      );
    }
    return () => {
      current = false;
    };
  }, [getDefinition, id]);

  async function edit() {
    if (!id || managedId !== id) return;
    setBusy(true);
    setError("");
    setStatus("");
    setPublication(null);
    try {
      const definition = await getDefinition({ id });
      if (!definition) throw new Error("Managed integration not found.");
      setEditor({ definition });
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || managedId !== id) return;
    setBusy(true);
    setError("");
    try {
      await unpublish({ id });
      setConfirmUnpublish(false);
      setPublication(null);
      setStatus("Unpublished. Existing installations have not been changed.");
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="my-4 grid gap-3" aria-label="Managed MCP integrations">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            setError("");
            setStatus("");
            setPublication(null);
            setEditor({});
          }}
        >
          Add MCP integration
        </Button>
        {id && managedId === id ? (
          <>
            <Button variant="outline" disabled={busy} onClick={() => void edit()}>
              Edit MCP integration
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError("");
                setConfirmUnpublish(true);
              }}
            >
              Unpublish MCP integration
            </Button>
          </>
        ) : null}
      </div>
      {status ? (
        <p role="status" className="section-subtitle m-0">
          {status}
        </p>
      ) : null}
      {publication ? (
        <div className="grid gap-2">
          <p className="section-subtitle m-0">
            Submission receipt · Release: {publication.releaseId}
            {publication.attemptId ? ` · Publish attempt: ${publication.attemptId}` : ""}
          </p>
          {publication.publicationStatus === "published" ? (
            <a href={buildPluginDetailHref(publication.name, { ownerHandle: "openclaw" })}>
              View published package
            </a>
          ) : null}
        </div>
      ) : null}
      {error && !confirmUnpublish ? <p role="alert">{error}</p> : null}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editor?.definition ? "Publish an updated MCP integration" : "Add MCP integration"}
            </DialogTitle>
            <DialogDescription>
              Publish a remote service connection under OpenClaw. Changes create a new version;
              installed connections keep their existing settings until updated.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <ManagedMcpForm
              initial={editor.definition}
              onPublished={(receipt) => {
                setEditor(null);
                setPublication(receipt);
                setStatus(
                  `${receipt.name}@${receipt.version} ${receipt.publicationStatus === "published" ? "published." : "submitted for security checks. It was pending publication at submission and is not yet confirmed available for installation."}`,
                );
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish {packageName}?</DialogTitle>
            <DialogDescription>
              This stops new availability through ClawHub. It does not remove or change existing
              installations.
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmUnpublish(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void remove()}>
              {busy ? "Unpublishing…" : "Unpublish"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ManagedMcpForm({
  initial,
  onPublished,
}: {
  initial?: ManagedMcpDefinition;
  onPublished: (receipt: PublicationReceipt) => void;
}) {
  const publish = useAction(api.managedMcp.publish);
  const [auth, setAuth] = useState<string>(initial?.connection.auth.kind ?? "oauth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [iconPreview, setIconPreview] = useState(initial?.icon.pngBase64 ?? "");
  const [iconReading, setIconReading] = useState(false);
  const [iconError, setIconError] = useState("");
  const [iconLicense, setIconLicense] = useState(initial?.icon.license ?? "");
  const [iconAttribution, setIconAttribution] = useState(initial?.icon.attribution ?? "");
  const [iconSourceUrl, setIconSourceUrl] = useState(initial?.icon.sourceUrl ?? "");
  const [iconLicenseUrl, setIconLicenseUrl] = useState(initial?.icon.licenseUrl ?? "");
  const iconReader = useRef<FileReader | null>(null);
  useEffect(() => () => iconReader.current?.abort(), []);
  const nextVersion = initial
    ? initial.version.replace(/\d+$/, (patch) => String(Number(patch) + 1))
    : "1.0.0";

  function selectIcon(file?: File) {
    iconReader.current?.abort();
    setIconError("");
    setIconReading(false);
    if (!file) {
      setIconPreview(initial?.icon.pngBase64 ?? "");
      setIconLicense(initial?.icon.license ?? "");
      setIconAttribution(initial?.icon.attribution ?? "");
      setIconSourceUrl(initial?.icon.sourceUrl ?? "");
      setIconLicenseUrl(initial?.icon.licenseUrl ?? "");
      return;
    }
    setIconPreview("");
    // A replacement asset does not inherit the previous image's license or attribution.
    setIconLicense("");
    setIconAttribution("");
    setIconSourceUrl("");
    setIconLicenseUrl("");
    if (file.size > 512 * 1024 || file.type !== "image/png") {
      setIconError("Choose a PNG icon no larger than 512KB.");
      return;
    }
    setIconReading(true);
    const reader = new FileReader();
    iconReader.current = reader;
    reader.addEventListener("load", () => {
      if (iconReader.current !== reader) return;
      setIconPreview(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
      setIconReading(false);
    });
    reader.addEventListener("error", () => {
      if (iconReader.current !== reader) return;
      setIconError("Could not read icon.");
      setIconReading(false);
    });
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (iconReading || iconError) return;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    try {
      const definition = {
        id: text("id"),
        name: text("name"),
        company: text("company"),
        description: text("description"),
        category: text("category"),
        version: text("version"),
        ...(text("setup") ? { setup: text("setup") } : {}),
        icon: {
          pngBase64: iconPreview,
          license: iconLicense,
          attribution: iconAttribution,
          ...(iconSourceUrl ? { sourceUrl: iconSourceUrl } : {}),
          ...(iconLicenseUrl ? { licenseUrl: iconLicenseUrl } : {}),
        },
        connection: {
          url: text("url"),
          transport: text("transport"),
          auth:
            auth === "oauth"
              ? { kind: auth, ...(text("scope") ? { scope: text("scope") } : {}) }
              : auth === "api-key"
                ? { kind: auth, header: text("header"), placeholder: text("placeholder") }
                : { kind: "none" },
        },
      };
      const result = await publish({ definition });
      const name = `@openclaw/${definition.id}`;
      onPublished({
        name,
        version: definition.version,
        releaseId: result.releaseId,
        attemptId: result.attemptId,
        publicationStatus: result.publicationStatus,
      });
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4">
      <fieldset disabled={busy} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Integration id"
            name="id"
            defaultValue={initial?.id}
            readOnly={Boolean(initial)}
            placeholder="linear"
          />
          <Field label="Version" name="version" defaultValue={nextVersion} />
          <Field label="Display name" name="name" defaultValue={initial?.name} />
          <Field label="Service company" name="company" defaultValue={initial?.company} />
        </div>
        <Field
          label="Brief description"
          name="description"
          defaultValue={initial?.description}
          maxLength={300}
        />
        <SelectField
          label="Category"
          name="category"
          defaultValue={initial?.category ?? "integrations"}
          items={PLUGIN_CATEGORY_DEFINITIONS.map((item) => ({
            value: item.slug,
            label: item.label,
          }))}
        />
        <Field
          label="MCP endpoint"
          name="url"
          defaultValue={initial?.connection.url}
          type="url"
          placeholder="https://mcp.example.com/mcp"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Transport"
            name="transport"
            defaultValue={initial?.connection.transport ?? "streamable-http"}
            items={[
              { value: "streamable-http", label: "Streamable HTTP" },
              { value: "sse", label: "SSE" },
            ]}
          />
          <SelectField
            label="Authentication"
            name="auth"
            defaultValue={auth}
            onValueChange={setAuth}
            items={[
              { value: "oauth", label: "OAuth" },
              { value: "api-key", label: "API key" },
              { value: "none", label: "No authentication" },
            ]}
          />
        </div>
        {auth === "oauth" ? (
          <Field
            label="OAuth scopes (optional)"
            name="scope"
            required={false}
            defaultValue={
              initial?.connection.auth.kind === "oauth" ? initial.connection.auth.scope : ""
            }
          />
        ) : null}
        {auth === "api-key" ? (
          <>
            <Field
              label="Credential header"
              name="header"
              defaultValue={
                initial?.connection.auth.kind === "api-key"
                  ? initial.connection.auth.header
                  : "Authorization"
              }
            />
            <Field
              label="Credential placeholder"
              name="placeholder"
              defaultValue={
                initial?.connection.auth.kind === "api-key"
                  ? initial.connection.auth.placeholder
                  : ""
              }
              placeholder="Bearer ${SERVICE_API_KEY}"
            />
            <p className="section-subtitle m-0">
              Use an environment placeholder. Never enter an API key or token.
            </p>
          </>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="mcp-setup">Essential setup notes (optional)</Label>
          <Textarea id="mcp-setup" name="setup" maxLength={2000} defaultValue={initial?.setup} />
        </div>
        <Field
          label={initial ? "Replace icon (PNG, optional)" : "Icon (PNG)"}
          name="icon"
          type="file"
          accept="image/png"
          required={!initial}
          onChange={(event) => selectIcon(event.currentTarget.files?.[0])}
        />
        {iconReading ? <p role="status">Reading icon…</p> : null}
        {iconError ? <p role="alert">{iconError}</p> : null}
        {iconPreview ? (
          <figure className="m-0 flex items-center gap-3">
            <img
              src={`data:image/png;base64,${iconPreview}`}
              width="64"
              height="64"
              className="object-contain"
              alt="Icon for this version"
              onError={() => setIconError("This image could not be displayed. Choose a valid PNG.")}
            />
            <figcaption className="section-subtitle m-0">Icon for this version</figcaption>
          </figure>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Icon license or rights"
            name="iconLicense"
            value={iconLicense}
            onChange={(event) => setIconLicense(event.currentTarget.value)}
            placeholder="MIT or provider brand terms"
          />
          <Field
            label="Icon attribution"
            name="iconAttribution"
            value={iconAttribution}
            onChange={(event) => setIconAttribution(event.currentTarget.value)}
          />
          <Field
            label="Official icon source URL"
            name="iconSourceUrl"
            type="url"
            value={iconSourceUrl}
            required={iconLicense !== "MIT"}
            onChange={(event) => setIconSourceUrl(event.currentTarget.value)}
          />
          <Field
            label="Icon license or brand terms URL"
            name="iconLicenseUrl"
            type="url"
            value={iconLicenseUrl}
            required={iconLicense !== "MIT"}
            onChange={(event) => setIconLicenseUrl(event.currentTarget.value)}
          />
        </div>
        <p className="section-subtitle m-0">
          Company logos keep their own rights and attribution. The wrapper’s MIT license does not
          license the logo.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-1" type="checkbox" required />I have the rights to publish this
          wrapper and icon under their stated licenses.
        </label>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <p className="section-subtitle m-0">
        Normal publication checks apply. Scanning the package does not certify the remote service or
        its future tools.
      </p>
      <Button type="submit" disabled={busy || iconReading || Boolean(iconError)}>
        {busy ? "Submitting…" : "Publish version"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  ...props
}: { label: string; name: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`mcp-${name}`}>{label}</Label>
      <Input id={`mcp-${name}`} name={name} required {...props} />
    </div>
  );
}

function SelectField({
  label,
  name,
  items,
  ...props
}: {
  label: string;
  name: string;
  items: Array<{ value: string; label: string }>;
  defaultValue: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`mcp-${name}`}>{label}</Label>
      <Select name={name} {...props}>
        <SelectTrigger id={`mcp-${name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
