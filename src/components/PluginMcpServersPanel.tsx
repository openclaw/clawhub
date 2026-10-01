import type { PluginManifestSummary } from "clawhub-schema";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { McpPublicInspection } from "../../convex/lib/mcpPublicInspection";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type Server = PluginManifestSummary["mcpServers"][number];

export function PluginMcpServersPanel({
  servers,
  packageName,
  version,
}: {
  servers: Server[];
  packageName: string;
  version: string | null;
}) {
  const inspect = useAction(api.mcpInspectionNode.inspectPackageServer);
  const [selected, setSelected] = useState<Server | null>(null);
  const [observation, setObservation] = useState<McpPublicInspection | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setObservation(null);
    if (!selected?.url || !version) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    void inspect({ name: packageName, version, server: selected.name })
      .then((result) => {
        if (active) setObservation(result);
      })
      .catch(() => {
        if (active) setObservation({ status: "unavailable", observedAt: Date.now() });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inspect, packageName, selected, version]);

  return (
    <div className="plugin-manifest-capabilities">
      <section className="plugin-manifest-section">
        <div className="plugin-manifest-chip-list">
          {servers.map((server) => (
            <Button
              key={server.name}
              variant="outline"
              size="sm"
              onClick={() => setSelected(server)}
            >
              {server.name}
            </Button>
          ))}
        </div>
      </section>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected?.name ?? "MCP server"}</DialogTitle>
            <DialogDescription>
              Connection settings saved in {packageName}
              {version ? ` v${version}` : ""}.
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="grid gap-4">
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="font-semibold">Endpoint</dt>
                  <dd className="break-all">
                    {selected.url ??
                      (selected.endpointRedacted
                        ? "URL omitted because it contains private or unsupported connection settings."
                        : "No public remote endpoint recorded.")}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Transport</dt>
                  <dd>
                    {selected.transport === "streamable-http"
                      ? "Streamable HTTP"
                      : selected.transport === "sse"
                        ? "SSE"
                        : selected.transport === "stdio"
                          ? "Local process"
                          : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Authentication</dt>
                  <dd>
                    {selected.auth === "oauth"
                      ? "OAuth — connect in OpenClaw"
                      : selected.auth === "api-key"
                        ? "API key — configure in OpenClaw"
                        : selected.auth === "none"
                          ? "No authentication configured"
                          : "Not recorded"}
                  </dd>
                </div>
                {selected.scope ? (
                  <div>
                    <dt className="font-semibold">Requested scopes</dt>
                    <dd className="break-words">{selected.scope}</dd>
                  </div>
                ) : null}
              </dl>
              {selected.setup ? (
                <div>
                  <h3 className="text-sm font-semibold">Setup</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">{selected.setup}</p>
                </div>
              ) : null}
              {selected.url ? (
                <div className="grid gap-2 border-t pt-4" aria-live="polite">
                  <h3 className="text-sm font-semibold">Public server information</h3>
                  {loading ? (
                    <p className="section-subtitle m-0">Checking public metadata…</p>
                  ) : observation?.status === "authentication-required" ? (
                    <p className="section-subtitle m-0">
                      This service requires authentication. Connect in OpenClaw to access it.
                    </p>
                  ) : observation?.status === "available" ? (
                    <>
                      <p className="text-sm">
                        {observation.name ?? "Endpoint responded"}
                        {observation.version ? ` · ${observation.version}` : ""}
                      </p>
                      {observation.protocolVersion ? (
                        <p className="section-subtitle m-0">MCP {observation.protocolVersion}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="section-subtitle m-0">
                      Public metadata is currently unavailable. The saved connection settings remain
                      available above.
                    </p>
                  )}
                  <p className="section-subtitle m-0">
                    A point-in-time, unauthenticated observation. Package checks cover the published
                    files, not the remote service or its future tools.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
