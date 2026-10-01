#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function sanitizeStepName(name) {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "step";
}

function uniqueSlug(base, used) {
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(slug);
  return slug;
}

export function createProofContext({ lane, outputDir, page }) {
  const steps = [];
  const used = new Set();
  return {
    get steps() {
      return steps;
    },
    async step(name, fn) {
      const slug = uniqueSlug(sanitizeStepName(name), used);
      const screenshot = path.join("screenshots", `${slug}.png`);
      const screenshotPath = path.join(outputDir, screenshot);
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      const entry = {
        lane,
        name,
        screenshot,
        slug,
        status: "pass",
      };
      try {
        await fn();
        await page.screenshot({ fullPage: true, path: screenshotPath });
      } catch (error) {
        entry.status = "fail";
        entry.error = error instanceof Error ? error.message : String(error);
        try {
          await page.screenshot({ fullPage: true, path: screenshotPath });
        } catch {
          // Keep the original failure. Missing screenshots are obvious in the manifest.
        }
        steps.push(entry);
        throw error;
      }
      steps.push(entry);
    },
  };
}

function parseRuntimeArgs(argv) {
  const opts = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "run-scenario") {
      continue;
    }
    if (arg === "--base-url") {
      opts.baseURL = next;
      index += 1;
    } else if (arg === "--lane") {
      opts.lane = next;
      index += 1;
    } else if (arg === "--output-dir") {
      opts.outputDir = next;
      index += 1;
    } else if (arg === "--scenario") {
      opts.scenario = next;
      index += 1;
    } else {
      throw new Error(`Unknown ui-proof-runtime argument: ${arg}`);
    }
  }
  return opts;
}

export async function runUiProofScenario({ baseURL, lane, outputDir, scenario }) {
  if (!baseURL || !lane || !outputDir || !scenario) {
    throw new Error("run-scenario requires --base-url, --lane, --output-dir, and --scenario");
  }
  const { chromium, expect } = await import("@playwright/test");
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    args: ["--window-position=0,0", "--window-size=1280,900"],
    headless: false,
  });
  const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
  const proof = createProofContext({ lane, outputDir, page });
  let status = "pass";
  let error;
  try {
    const imported = await import(pathToFileURL(path.resolve(scenario)).href);
    const scenarioFn = imported.default ?? imported.run;
    if (typeof scenarioFn !== "function") {
      throw new Error("Proof scenario must export a default function or named run function.");
    }
    await scenarioFn({ baseURL, expect, lane, page, proof });
  } catch (caught) {
    status = "fail";
    error = caught instanceof Error ? caught.message : String(caught);
    throw caught;
  } finally {
    await browser.close().catch(() => {});
    const summary = {
      baseURL,
      error,
      lane,
      scenario: path.resolve(scenario),
      status,
      steps: proof.steps,
    };
    await fs.writeFile(
      path.join(outputDir, "proof-steps.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }
}

if (process.argv[2] === "run-scenario") {
  runUiProofScenario(parseRuntimeArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
