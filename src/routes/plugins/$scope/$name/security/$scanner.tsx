import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

function scopedPluginSecurityPath(scope: string, name: string, scanner: string) {
  if (!scope.startsWith("@") || !name) {
    throw notFound();
  }
  return `/plugins/${encodeURIComponent(`${scope}/${name}`)}/security/${encodeURIComponent(scanner)}`;
}

export const Route = createFileRoute("/plugins/$scope/$name/security/$scanner")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: scopedPluginSecurityPath(params.scope, params.name, params.scanner),
      statusCode: 308,
    });
  },
});
