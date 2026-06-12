#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const generatedDocsDir = path.resolve("public", "docs");

if (fs.existsSync(generatedDocsDir)) {
  console.error(
    "public/docs exists, but ClawHub docs are served by Mintlify. Remove the ignored generated docs directory before building.",
  );
  process.exit(1);
}
