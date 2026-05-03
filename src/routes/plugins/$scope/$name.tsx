import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

function scopedPluginPath(scope: string, name: string, suffix = "") {
  if (!scope.startsWith("@") || !name) {
    throw notFound();
  }
  return `/plugins/${encodeURIComponent(`${scope}/${name}`)}${suffix}`;
}

function scopedPluginSuffix(pathname: string, scope: string, name: string) {
  const prefix = `/plugins/${scope}/${name}`;
  if (!pathname.startsWith(`${prefix}/`)) {
    return "";
  }
  return pathname.slice(prefix.length);
}

export const Route = createFileRoute("/plugins/$scope/$name")({
  beforeLoad: ({ location, params }) => {
    throw redirect({
      href: scopedPluginPath(
        params.scope,
        params.name,
        scopedPluginSuffix(location.pathname, params.scope, params.name),
      ),
      statusCode: 308,
    });
  },
});
