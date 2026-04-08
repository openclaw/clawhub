import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);

const convexEntry = require.resolve("convex");
const convexRoot = dirname(dirname(dirname(convexEntry)));
const convexReactPath = join(convexRoot, "dist/esm/react/index.js");
const convexBrowserPath = join(convexRoot, "dist/esm/browser/index.js");
const convexValuesPath = join(convexRoot, "dist/esm/values/index.js");
const convexAuthReactPath = require.resolve("@convex-dev/auth/react");

function handleRollupWarning(
  warning: { code?: string; message: string; id?: string },
  warn: (warning: { code?: string; message: string; id?: string }) => void,
) {
  if (
    warning.code === "MODULE_LEVEL_DIRECTIVE" &&
    warning.id?.includes("node_modules") &&
    /use client/i.test(warning.message)
  ) {
    return;
  }
  if (
    warning.code === "UNUSED_EXTERNAL_IMPORT" &&
    /@tanstack\/start-|@tanstack\/router-core\/ssr\/(client|server)/.test(warning.message)
  ) {
    return;
  }
  if (warning.code === "EMPTY_BUNDLE" || /Generated an empty chunk/i.test(warning.message)) {
    return;
  }
  warn(warning);
}

type SourceReplacement = readonly [from: string, to: string];

const reflectHas = (target: string, key: string) => `Reflect.has(${target}, ${JSON.stringify(key)})`;

const arkSafariInOperatorFixes = [
  {
    suffix: "/node_modules/.vite/deps/arktype.js",
    replacements: [
      ['"expression" in value', reflectHas("value", "expression")],
      ['"toJSON" in o', reflectHas("o", "toJSON")],
      ['"morphs" in schema', reflectHas("schema", "morphs")],
      ['"branches" in schema', reflectHas("schema", "branches")],
      ['"unit" in schema', reflectHas("schema", "unit")],
      ['"reference" in schema', reflectHas("schema", "reference")],
      ['"proto" in schema', reflectHas("schema", "proto")],
      ['"domain" in schema', reflectHas("schema", "domain")],
      ['"value" in transformedInner', reflectHas("transformedInner", "value")],
      ['"default" in this.inner', reflectHas("this.inner", "default")],
      ['"variadic" in schema', reflectHas("schema", "variadic")],
      ['"prefix" in schema', reflectHas("schema", "prefix")],
      ['"defaultables" in schema', reflectHas("schema", "defaultables")],
      ['"optionals" in schema', reflectHas("schema", "optionals")],
      ['"postfix" in schema', reflectHas("schema", "postfix")],
      ['"minVariadicLength" in schema', reflectHas("schema", "minVariadicLength")],
      ['"description" in ctx', reflectHas("ctx", "description")],
      ['"data" in input', reflectHas("input", "data")],
      ['"get" in desc', reflectHas("desc", "get")],
      ['"set" in desc', reflectHas("desc", "set")],
    ] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/util/out/serialize.js",
    replacements: [
      ['"expression" in value', reflectHas("value", "expression")],
      ['"toJSON" in o', reflectHas("o", "toJSON")],
    ],
  },
  {
    suffix: "/node_modules/@ark/schema/out/parse.js",
    replacements: [
      ['"morphs" in schema', reflectHas("schema", "morphs")],
      ['"branches" in schema', reflectHas("schema", "branches")],
      ['"unit" in schema', reflectHas("schema", "unit")],
      ['"reference" in schema', reflectHas("schema", "reference")],
      ['"proto" in schema', reflectHas("schema", "proto")],
      ['"domain" in schema', reflectHas("schema", "domain")],
    ] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/schema/out/node.js",
    replacements: [['"value" in transformedInner', reflectHas("transformedInner", "value")]] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/schema/out/scope.js",
    replacements: [['"branches" in schema', reflectHas("schema", "branches")]] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/schema/out/structure/optional.js",
    replacements: [['"default" in this.inner', reflectHas("this.inner", "default")]] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/schema/out/structure/sequence.js",
    replacements: [
      ['"variadic" in schema', reflectHas("schema", "variadic")],
      ['"prefix" in schema', reflectHas("schema", "prefix")],
      ['"defaultables" in schema', reflectHas("schema", "defaultables")],
      ['"optionals" in schema', reflectHas("schema", "optionals")],
      ['"postfix" in schema', reflectHas("schema", "postfix")],
      ['"minVariadicLength" in schema', reflectHas("schema", "minVariadicLength")],
    ] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/schema/out/structure/prop.js",
    replacements: [['"default" in this.inner', reflectHas("this.inner", "default")]] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/schema/out/shared/implement.js",
    replacements: [['"description" in ctx', reflectHas("ctx", "description")]] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/schema/out/shared/errors.js",
    replacements: [['"data" in input', reflectHas("input", "data")]] satisfies SourceReplacement[],
  },
  {
    suffix: "/node_modules/@ark/util/out/clone.js",
    replacements: [
      ['"get" in desc', reflectHas("desc", "get")],
      ['"set" in desc', reflectHas("desc", "set")],
    ] satisfies SourceReplacement[],
  },
] as const;

function patchArkSafariInOperator(): Plugin {
  return {
    name: "patch-ark-safari-in-operator",
    enforce: "pre",
    transform(code, id) {
      const normalizedId = id.split("?")[0].replace(/\\/g, "/");
      const fix = arkSafariInOperatorFixes.find((entry) => normalizedId.endsWith(entry.suffix));
      if (!fix) return null;

      let nextCode = code;
      for (const [from, to] of fix.replacements) {
        if (!nextCode.includes(from)) {
          this.error(`Expected to patch ${from} in ${normalizedId}`);
        }
        nextCode = nextCode.replaceAll(from, to);
      }

      return {
        code: nextCode,
        map: null,
      };
    },
  };
}

const config = defineConfig({
  resolve: {
    dedupe: ["convex", "@convex-dev/auth", "react", "react-dom"],
    alias: {
      "convex/react": convexReactPath,
      "convex/browser": convexBrowserPath,
      "convex/values": convexValuesPath,
      "@convex-dev/auth/react": convexAuthReactPath,
    },
  },
  optimizeDeps: {
    include: ["convex/react", "convex/browser"],
  },
  plugins: [
    patchArkSafariInOperator(),
    devtools(),
    nitro({
      serverDir: "server",
      rollupConfig: {
        onwarn: handleRollupWarning,
      },
    }),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  build: {
    // Keep the shipped client bundle parseable in Safari/WebKit.
    target: "safari15",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      onwarn: handleRollupWarning,
    },
  },
});

export default config;
