import { Button } from "./ui/button";

type InstallFamily = "plugins" | "skills" | "templates";

// The receiving app resolves and reviews this identity; the website grants no authority.
export function OpenClawInstall({ family, name }: { family: InstallFamily; name: string }) {
  const href = `openclaw://${family}/install?${new URLSearchParams({ name })}`;

  return (
    <div className="openclaw-install">
      <Button asChild variant="primary" className="openclaw-install-button">
        <a href={href}>Install in OpenClaw</a>
      </Button>
    </div>
  );
}
