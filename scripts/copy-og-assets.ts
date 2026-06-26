import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OG_FONT_PATHS } from "../server/og/ogAssets";

async function resolveExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(`Missing required asset. Tried: ${candidates.join(", ")}`);
}

function nodeModuleCandidates(relativePath: string) {
  return [
    path.resolve(`node_modules/${relativePath}`),
    path.resolve(`../../node_modules/${relativePath}`),
  ];
}

export async function copyOgAssets() {
  const resvgWasmSource = await resolveExistingPath(
    nodeModuleCandidates("@resvg/resvg-wasm/index_bg.wasm"),
  );
  const fontCopies = await Promise.all(
    OG_FONT_PATHS.map(async (runtimePath) => {
      const modulePath = runtimePath.replace(/^node_modules\//, "");
      const source = await resolveExistingPath(nodeModuleCandidates(modulePath));
      return {
        source,
        targets: [
          path.resolve(".output/server", runtimePath),
          path.resolve(".vercel/output/functions/__server.func", runtimePath),
        ],
      };
    }),
  );

  const copies = [
    {
      source: path.resolve("public/clawd-logo.png"),
      targets: [
        path.resolve(".output/server/clawd-logo.png"),
        path.resolve(".output/server/public/clawd-logo.png"),
        path.resolve(".vercel/output/functions/__server.func/clawd-logo.png"),
        path.resolve(".vercel/output/functions/__server.func/public/clawd-logo.png"),
      ],
    },
    {
      source: path.resolve("public/og-clawhub-watermark.png"),
      targets: [
        path.resolve(".output/server/og-clawhub-watermark.png"),
        path.resolve(".output/server/public/og-clawhub-watermark.png"),
        path.resolve(".vercel/output/functions/__server.func/og-clawhub-watermark.png"),
        path.resolve(".vercel/output/functions/__server.func/public/og-clawhub-watermark.png"),
      ],
    },
    {
      source: path.resolve("public/clawd-mark.png"),
      targets: [
        path.resolve(".output/server/clawd-mark.png"),
        path.resolve(".output/server/public/clawd-mark.png"),
        path.resolve(".vercel/output/functions/__server.func/clawd-mark.png"),
        path.resolve(".vercel/output/functions/__server.func/public/clawd-mark.png"),
      ],
    },
    {
      source: resvgWasmSource,
      targets: [
        path.resolve(".output/server/node_modules/@resvg/resvg-wasm/index_bg.wasm"),
        path.resolve(
          ".vercel/output/functions/__server.func/node_modules/@resvg/resvg-wasm/index_bg.wasm",
        ),
      ],
    },
    ...fontCopies,
  ];

  for (const { source, targets } of copies) {
    for (const target of targets) {
      const parent = path.dirname(target);
      await mkdir(parent, { recursive: true });
      await copyFile(source, target);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await copyOgAssets();
}
