import { Link } from "@tanstack/react-router";
import { DatabaseZap, Gauge, ListChecks, ShieldCheck, UploadCloud, UserCog } from "lucide-react";
import type React from "react";
import { Badge } from "./ui/badge";

type OperationKey = "publish" | "plugins" | "moderation" | "storepacks" | "migrations" | "users";

const pluginPublishSearch = {
  ownerHandle: undefined,
  name: undefined,
  displayName: undefined,
  family: undefined,
  nextVersion: undefined,
  sourceRepo: undefined,
};

export function PluginOperationsNav({ current }: { current?: OperationKey }) {
  return (
    <section className="mb-5">
      <div className="mb-3 flex flex-col gap-1">
        <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
          Plugin operations
        </h2>
        <p className="section-subtitle m-0">
          Publisher, moderation, artifact, and migration surfaces for the ClawHub plugin platform.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <OperationLink
          current={current === "publish"}
          icon={<UploadCloud className="h-4 w-4" aria-hidden="true" />}
          title="Publish plugin"
          path="/publish-plugin"
          description="Upload a folder, zip, or StorePack archive and review the generated contract."
        >
          <Link to="/publish-plugin" search={pluginPublishSearch}>
            Open publish
          </Link>
        </OperationLink>
        <OperationLink
          current={current === "plugins"}
          icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
          title="Plugin management"
          path="/management/plugins"
          description="Open package drilldowns with release, StorePack, badge, and verdict controls."
        >
          <Link to="/management/plugins" search={{ skill: undefined, plugin: undefined }}>
            Open plugins
          </Link>
        </OperationLink>
        <OperationLink
          current={current === "moderation"}
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          title="Plugin moderation"
          path="/management/moderation"
          description="Review code and bundle plugins by scan state, StorePack status, and release risk."
        >
          <Link to="/management/moderation" search={{ skill: undefined, plugin: undefined }}>
            Open queue
          </Link>
        </OperationLink>
        <OperationLink
          current={current === "storepacks"}
          icon={<DatabaseZap className="h-4 w-4" aria-hidden="true" />}
          title="StorePack ops"
          path="/management/storepacks"
          description="Dry-run migration samples, build artifacts, retry failures, and rebuild lookup rows."
        >
          <Link to="/management/storepacks" search={{ skill: undefined, plugin: undefined }}>
            Open StorePack ops
          </Link>
        </OperationLink>
        <OperationLink
          current={current === "migrations"}
          icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
          title="Migration readiness"
          path="/management/migrations"
          description="Track ClawHub gates for future OpenClaw bundled-plugin externalization."
        >
          <Link to="/management/migrations" search={{ skill: undefined, plugin: undefined }}>
            Open readiness
          </Link>
        </OperationLink>
        <OperationLink
          current={current === "users"}
          icon={<UserCog className="h-4 w-4" aria-hidden="true" />}
          title="User roles"
          path="/management/users"
          description="Find users, grant moderator/admin roles, and manage account bans."
        >
          <Link to="/management/users" search={{ skill: undefined, plugin: undefined }}>
            Open users
          </Link>
        </OperationLink>
      </div>
    </section>
  );
}

function OperationLink({
  children,
  current,
  description,
  icon,
  path,
  title,
}: {
  children: React.ReactNode;
  current: boolean;
  description: string;
  icon: React.ReactNode;
  path: string;
  title: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold text-[color:var(--ink)]">
          {icon}
          {title}
        </div>
        {current ? <Badge variant="compact">current</Badge> : null}
      </div>
      <div className="mono mb-2 text-xs text-[color:var(--ink-soft)]">{path}</div>
      <p className="section-subtitle m-0 mb-3">{description}</p>
      <div className="text-sm font-semibold text-[color:var(--accent)]">{children}</div>
    </div>
  );
}
