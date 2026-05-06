import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

function scopedPluginPath(scope: string, name: string) {
  if (!scope.startsWith("@") || !name) {
    throw notFound();
  }
  return `/plugins/${encodeURIComponent(`${scope}/${name}`)}`;
}

export const Route = createFileRoute("/packages/$scope/$name")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: scopedPluginPath(params.scope, params.name),
      statusCode: 308,
    });
  },
});
