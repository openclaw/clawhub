import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, Plug, Unplug } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { getUserFacingConvexError } from "../../lib/convexError";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type ConnectionsOverview = NonNullable<FunctionReturnType<typeof api.connections.getMine>>;
type ConnectionApp = ConnectionsOverview["apps"][number];
type ConnectionTool = FunctionReturnType<typeof api.connections.listTools>[number];

/** Query parameters present when the browser returns from a provider sign-in. */
export type ConnectionReturn = {
  app?: string;
  attempt?: string;
  status?: string;
};

type ReturnResult = "connected" | "pending" | "failed";

// While a sign-in is open in another tab, ask the server to re-check with the
// provider service this often. The server, not this page, decides the outcome.
const PENDING_CHECK_INTERVAL_MS = 4_000;
const SERVICE_ERROR = "Could not reach the connection service. Try again in a moment.";

const LAST_ERROR_COPY: Record<NonNullable<ConnectionApp["lastError"]>, (name: string) => string> = {
  failed: (name) => `${name} sign-in failed. Nothing was connected.`,
  cancelled: (name) => `${name} sign-in was cancelled or did not finish. Nothing was connected.`,
  expired: (name) => `${name} sign-in was not finished in time. Nothing was connected.`,
  lost: (name) => `${name} is no longer connected. Connect again to restore access.`,
};

export function ConnectionsPanel({
  overview,
  returned,
  onReturnHandled,
}: {
  overview: ConnectionsOverview;
  returned: ConnectionReturn | null;
  onReturnHandled: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-sm leading-6 text-[color:var(--ink-soft)]">
        Connect an app so your OpenClaw chats can read from it. Sign-in happens with the app itself;
        ClawHub never sees your password.
      </p>
      {overview.apps.map((app) => (
        <ConnectionAppCard
          key={app.id}
          app={app}
          returned={returned?.app === app.id ? returned : null}
          onReturnHandled={onReturnHandled}
        />
      ))}
    </div>
  );
}

function ConnectionAppCard({
  app,
  returned,
  onReturnHandled,
}: {
  app: ConnectionApp;
  returned: ConnectionReturn | null;
  onReturnHandled: () => void;
}) {
  const startConnect = useAction(api.connections.startConnect);
  const verify = useAction(api.connections.verify);
  const cancelConnect = useAction(api.connections.cancelConnect);
  const disconnect = useAction(api.connections.disconnect);
  const headingId = useId();
  const [busy, setBusy] = useState<"connect" | "cancel" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [tabBlocked, setTabBlocked] = useState(false);
  const [returnResult, setReturnResult] = useState<ReturnResult | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const checking = useRef(false);
  const checkedOnOpen = useRef(false);

  const check = useCallback(
    async (hint?: { attemptId: string; outcome?: "failed" }) => {
      if (checking.current) return null;
      checking.current = true;
      try {
        const result = await verify({ app: app.id, ...hint });
        setCheckFailed(false);
        return result.status;
      } catch {
        setCheckFailed(true);
        return null;
      } finally {
        checking.current = false;
      }
    },
    [app.id, verify],
  );

  // On open, ask the server what the provider service says. This confirms a
  // sign-in the browser just returned from, and also catches an account that
  // was connected or revoked somewhere else.
  useEffect(() => {
    if (checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    const attemptId = returned?.attempt;
    void check(
      attemptId
        ? { attemptId, ...(returned?.status === "failed" ? { outcome: "failed" as const } : {}) }
        : undefined,
    ).then((status) => {
      if (!attemptId) return;
      if (status) setReturnResult(status === "disconnected" ? "failed" : status);
      onReturnHandled();
    });
  }, [check, onReturnHandled, returned]);

  const pending = app.status === "pending";
  useEffect(() => {
    if (!pending) return undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void check();
    };
    const interval = window.setInterval(tick, PENDING_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [check, pending]);

  async function onConnect() {
    // Opened before any await so the browser ties the new tab to this click.
    const tab = window.open("", "_blank");
    setBusy("connect");
    setError(null);
    setTabBlocked(false);
    setReturnResult(null);
    try {
      const result = await startConnect({ app: app.id });
      if (result.status !== "pending") {
        tab?.close();
        return;
      }
      setSignInUrl(result.redirectUrl);
      if (tab) {
        tab.opener = null;
        tab.location.href = result.redirectUrl;
      } else {
        setTabBlocked(true);
      }
    } catch (caught) {
      tab?.close();
      setError(getUserFacingConvexError(caught, SERVICE_ERROR));
    } finally {
      setBusy(null);
    }
  }

  async function onCancel() {
    setBusy("cancel");
    setError(null);
    try {
      await cancelConnect({ app: app.id });
      setSignInUrl(null);
      setTabBlocked(false);
    } catch (caught) {
      setError(getUserFacingConvexError(caught, SERVICE_ERROR));
    } finally {
      setBusy(null);
    }
  }

  async function onDisconnect() {
    setBusy("disconnect");
    setError(null);
    setReturnResult(null);
    try {
      await disconnect({ app: app.id });
      setConfirmingDisconnect(false);
    } catch (caught) {
      setConfirmingDisconnect(false);
      setError(getUserFacingConvexError(caught, SERVICE_ERROR));
    } finally {
      setBusy(null);
    }
  }

  const connected = app.status === "connected";
  return (
    <article
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
            <Plug size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={headingId} className="text-sm font-bold text-[color:var(--ink)]">
                {app.name}
              </h3>
              <StatusBadge status={app.status} />
            </div>
            <p className="text-sm leading-6 text-[color:var(--ink-soft)]">{app.description}</p>
            {connected ? (
              <p className="mt-1 text-sm text-[color:var(--ink)]">
                {app.accountLabel ? (
                  <>
                    Connected as <span className="font-semibold">{app.accountLabel}</span>
                  </>
                ) : (
                  "Connected"
                )}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {connected ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setConfirmingDisconnect(true)}
            >
              <Unplug size={16} aria-hidden="true" />
              Disconnect
            </Button>
          ) : pending ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void onCancel()}
            >
              {busy === "cancel" ? "Cancelling..." : "Cancel"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null}
              onClick={() => void onConnect()}
            >
              <Plug size={16} aria-hidden="true" />
              {busy === "connect" ? "Starting..." : `Connect ${app.name}`}
            </Button>
          )}
        </div>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        {pending ? (
          <Alert variant="info">
            <AlertDescription>
              Finish signing in to {app.name} in the tab that opened. This page updates once the
              connection is confirmed.{" "}
              {signInUrl ? (
                <SignInLink href={signInUrl}>
                  {tabBlocked ? `Open ${app.name} sign-in` : "Open sign-in again"}
                </SignInLink>
              ) : (
                "If you closed that tab, cancel and connect again."
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        {pending && tabBlocked ? (
          <Alert variant="warn">
            <AlertDescription>
              Your browser blocked the sign-in tab. Use the link above to open it.
            </AlertDescription>
          </Alert>
        ) : null}
        {returnResult === "connected" && connected ? (
          <Alert variant="default">
            <AlertDescription>{app.name} is connected. You can close this tab.</AlertDescription>
          </Alert>
        ) : null}
        {returnResult === "pending" && pending ? (
          <Alert variant="default">
            <AlertDescription>
              Still waiting for {app.name} to confirm the sign-in.
            </AlertDescription>
          </Alert>
        ) : null}
        {app.status === "disconnected" && app.lastError ? (
          <Alert variant={app.lastError === "lost" ? "warn" : "destructive"}>
            <AlertDescription>{LAST_ERROR_COPY[app.lastError](app.name)}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {checkFailed && !error ? (
          <Alert variant="warn">
            <AlertDescription>
              Could not check this connection right now. What you see may be out of date.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <ConnectionTools app={app} />

      <Dialog
        open={confirmingDisconnect}
        onOpenChange={(open) => {
          if (!open && busy !== "disconnect") setConfirmingDisconnect(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {app.name}</DialogTitle>
            <DialogDescription>
              Your OpenClaw chats lose access to {app.name} right away. You can connect again at any
              time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy === "disconnect"}
              onClick={() => setConfirmingDisconnect(false)}
            >
              Keep connected
            </Button>
            <Button
              variant="destructive"
              disabled={busy === "disconnect"}
              onClick={() => void onDisconnect()}
            >
              <Unplug size={16} aria-hidden="true" />
              {busy === "disconnect" ? "Disconnecting..." : `Disconnect ${app.name}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function StatusBadge({ status }: { status: ConnectionApp["status"] }) {
  if (status === "connected") {
    return (
      <Badge variant="success" size="sm">
        Connected
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="pending" size="sm">
        Waiting for sign-in
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      Not connected
    </Badge>
  );
}

function SignInLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
    >
      {children}
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

function ConnectionTools({ app }: { app: ConnectionApp }) {
  const listTools = useAction(api.connections.listTools);
  const [tools, setTools] = useState<ConnectionTool[] | null>(null);
  const [failed, setFailed] = useState(false);
  const headingId = useId();

  useEffect(() => {
    let current = true;
    listTools({ app: app.id })
      .then((loaded) => {
        if (current) setTools(loaded);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [app.id, listTools]);

  // Until Composio's descriptions arrive (or if they cannot be read), the
  // list still shows exactly which tools are exposed.
  const rows: Array<{ slug: string; name: string; description: string }> =
    tools ?? app.tools.map((slug) => ({ slug, name: slug, description: "" }));

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 id={headingId} className="text-sm font-bold text-[color:var(--ink)]">
          What your chats can do
        </h4>
        <span className="text-sm text-[color:var(--ink-soft)]">
          {rows.length} read-only {rows.length === 1 ? "tool" : "tools"}. Nothing here can change
          your {app.name} data.
        </span>
      </div>
      {failed ? (
        <p className="text-sm text-[color:var(--ink-soft)]">
          Tool descriptions are unavailable right now.
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col divide-y divide-[color:var(--line)] rounded-[var(--radius-sm)] border border-[color:var(--line)] p-0">
        {rows.map((tool) => (
          <ConnectionToolRow key={tool.slug} tool={tool} />
        ))}
      </ul>
    </section>
  );
}

// Provider descriptions are written for agents and run long, so each one
// starts clamped to a couple of lines.
const LONG_DESCRIPTION_LENGTH = 180;

function ConnectionToolRow({
  tool,
}: {
  tool: { slug: string; name: string; description: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  const long = tool.description.length > LONG_DESCRIPTION_LENGTH;
  return (
    <li className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {tool.name !== tool.slug ? (
          <span className="text-sm font-semibold text-[color:var(--ink)]">{tool.name}</span>
        ) : null}
        <code className="break-all font-mono text-xs text-[color:var(--ink-soft)]">
          {tool.slug}
        </code>
      </div>
      {tool.description ? (
        <p
          id={descriptionId}
          className={`m-0 text-sm leading-6 text-[color:var(--ink-soft)] ${
            expanded ? "whitespace-pre-line" : "line-clamp-2"
          }`}
        >
          {tool.description}
        </p>
      ) : null}
      {long ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={descriptionId}
          onClick={() => setExpanded((value) => !value)}
          className="self-start text-xs font-semibold text-[color:var(--ink-soft)] underline underline-offset-4 hover:text-[color:var(--ink)]"
        >
          {expanded ? "Show less" : "Show full description"}
          <span className="sr-only"> for {tool.name}</span>
        </button>
      ) : null}
    </li>
  );
}
