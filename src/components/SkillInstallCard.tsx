import type { ClawdisSkillMetadata } from "clawhub-schema";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_SUMMARY,
  PLATFORM_SKILL_LICENSE_URL,
} from "clawhub-schema/licenseConstants";
import { formatInstallCommand, formatInstallLabel } from "./skillDetailUtils";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";

type SkillInstallCardProps = {
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
};

export function SkillInstallCard({ clawdis, osLabels }: SkillInstallCardProps) {
  const requirements = clawdis?.requires;
  const installSpecs = clawdis?.install ?? [];
  const envVars = clawdis?.envVars ?? [];
  const dependencies = clawdis?.dependencies ?? [];
  const links = clawdis?.links;
  const hasRuntimeRequirements = Boolean(
    clawdis?.emoji ||
    osLabels.length ||
    requirements?.bins?.length ||
    requirements?.anyBins?.length ||
    requirements?.env?.length ||
    requirements?.config?.length ||
    clawdis?.primaryEnv ||
    envVars.length,
  );
  const hasInstallSpecs = installSpecs.length > 0;
  const hasDependencies = dependencies.length > 0;
  const hasLinks = Boolean(links?.homepage || links?.repository || links?.documentation);
  const hasLicense = true;

  if (!hasRuntimeRequirements && !hasInstallSpecs && !hasDependencies && !hasLinks && !hasLicense) {
    return null;
  }

  return (
    <div className="border-t border-[color:var(--line)] pt-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4">
          <CardContent className="gap-2">
            <h3 className="m-0 font-display text-base font-bold text-[color:var(--ink)]">
              License
            </h3>
            <div className="flex flex-col gap-2">
              <Badge variant="accent">{PLATFORM_SKILL_LICENSE}</Badge>
              <div className="text-sm text-[color:var(--ink-soft)]">
                <span>{PLATFORM_SKILL_LICENSE_SUMMARY}</span>
              </div>
              <div className="text-sm text-[color:var(--ink-soft)]">
                <strong>Terms</strong>
                <a
                  href={PLATFORM_SKILL_LICENSE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1"
                >
                  {PLATFORM_SKILL_LICENSE_URL}
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
        {hasRuntimeRequirements ? (
          <Card className="p-4">
            <CardContent className="gap-2">
              <h3 className="m-0 font-display text-base font-bold text-[color:var(--ink)]">
                Runtime requirements
              </h3>
              <div className="flex flex-col gap-2">
                {clawdis?.emoji ? <Badge>{clawdis.emoji} Clawdis</Badge> : null}
                {osLabels.length ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>OS</strong>
                    <span className="ml-1">{osLabels.join(" · ")}</span>
                  </div>
                ) : null}
                {requirements?.bins?.length ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Bins</strong>
                    <span className="ml-1">{requirements.bins.join(", ")}</span>
                  </div>
                ) : null}
                {requirements?.anyBins?.length ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Any bin</strong>
                    <span className="ml-1">{requirements.anyBins.join(", ")}</span>
                  </div>
                ) : null}
                {requirements?.env?.length ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Env</strong>
                    <span className="ml-1">{requirements.env.join(", ")}</span>
                  </div>
                ) : null}
                {requirements?.config?.length ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Config</strong>
                    <span className="ml-1">{requirements.config.join(", ")}</span>
                  </div>
                ) : null}
                {clawdis?.primaryEnv ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Primary env</strong>
                    <span className="ml-1">{clawdis.primaryEnv}</span>
                  </div>
                ) : null}
                {envVars.length > 0 ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Environment variables</strong>
                    <div className="mt-1 flex flex-col gap-1">
                      {envVars.map((env, index) => (
                        <div key={`${env.name}-${index}`} className="flex items-baseline gap-2">
                          <code className="text-[0.85rem]">{env.name}</code>
                          {env.required === false ? (
                            <span className="text-xs text-[color:var(--ink-soft)]">optional</span>
                          ) : env.required === true ? (
                            <span className="text-xs text-[color:var(--accent)]">required</span>
                          ) : null}
                          {env.description ? (
                            <span className="text-[0.8rem] text-[color:var(--ink-soft)]">
                              — {env.description}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
        {hasDependencies ? (
          <Card className="p-4">
            <CardContent className="gap-2">
              <h3 className="m-0 font-display text-base font-bold text-[color:var(--ink)]">
                Dependencies
              </h3>
              <div className="flex flex-col gap-2">
                {dependencies.map((dep, index) => (
                  <div
                    key={`${dep.name}-${index}`}
                    className="text-sm text-[color:var(--ink-soft)]"
                  >
                    <div>
                      <strong>{dep.name}</strong>
                      <span className="ml-2 text-[0.85rem] text-[color:var(--ink-soft)]">
                        {dep.type}
                        {dep.version ? ` ${dep.version}` : ""}
                      </span>
                      {dep.url ? (
                        <div className="break-all text-[0.8rem]">
                          <a href={dep.url} target="_blank" rel="noopener noreferrer">
                            {dep.url}
                          </a>
                        </div>
                      ) : null}
                      {dep.repository && dep.repository !== dep.url ? (
                        <div className="text-[0.8rem]">
                          <a href={dep.repository} target="_blank" rel="noopener noreferrer">
                            Source
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
        {hasInstallSpecs ? (
          <Card className="p-4">
            <CardContent className="gap-2">
              <h3 className="m-0 font-display text-base font-bold text-[color:var(--ink)]">
                Install
              </h3>
              <div className="flex flex-col gap-2">
                {installSpecs.map((spec, index) => {
                  const command = formatInstallCommand(spec);
                  return (
                    <div
                      key={`${spec.id ?? spec.kind}-${index}`}
                      className="text-sm text-[color:var(--ink-soft)]"
                    >
                      <div>
                        <strong>{spec.label ?? formatInstallLabel(spec)}</strong>
                        {spec.bins?.length ? (
                          <div className="text-[0.85rem] text-[color:var(--ink-soft)]">
                            Bins: {spec.bins.join(", ")}
                          </div>
                        ) : null}
                        {command ? (
                          <code className="mt-0.5 block font-mono text-xs">{command}</code>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : null}
        {hasLinks ? (
          <Card className="p-4">
            <CardContent className="gap-2">
              <h3 className="m-0 font-display text-base font-bold text-[color:var(--ink)]">
                Links
              </h3>
              <div className="flex flex-col gap-2">
                {links?.homepage ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Homepage</strong>
                    <a
                      href={links.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 break-all"
                    >
                      {links.homepage}
                    </a>
                  </div>
                ) : null}
                {links?.repository ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Repository</strong>
                    <a
                      href={links.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 break-all"
                    >
                      {links.repository}
                    </a>
                  </div>
                ) : null}
                {links?.documentation ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <strong>Docs</strong>
                    <a
                      href={links.documentation}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1"
                    >
                      {links.documentation}
                    </a>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
