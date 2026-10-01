import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const workflowPath = ".github/workflows/clawhub-cli-npm-release.yml";
const shaPattern = /^[0-9a-f]{40}$/;

function collectActionReferences(value, path = "$", references = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectActionReferences(item, `${path}[${index}]`, references));
  } else if (value && typeof value === "object") {
    if (typeof value.uses === "string") {
      references.push({ path: `${path}.uses`, uses: value.uses });
    }
    for (const [key, child] of Object.entries(value)) {
      collectActionReferences(child, `${path}.${key}`, references);
    }
  }
  return references;
}

const workflow = parseYaml(readFileSync(workflowPath, "utf8"));
const invalidReferences = collectActionReferences(workflow).filter(({ uses }) => {
  const atIndex = uses.lastIndexOf("@");
  return atIndex !== -1 && !shaPattern.test(uses.slice(atIndex + 1));
});

if (invalidReferences.length > 0) {
  for (const { path, uses } of invalidReferences) {
    console.error(`${workflowPath} ${path} uses a non-SHA action reference: ${uses}`);
  }
  process.exit(1);
}
