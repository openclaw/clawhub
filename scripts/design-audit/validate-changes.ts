import { validateCurrentSafeChanges } from "./finalize";

const changedFiles = validateCurrentSafeChanges();
console.log(
  changedFiles.length === 0
    ? "audit proposed no source changes"
    : `audit proposed ${changedFiles.length} safe frontend change(s): ${changedFiles.join(", ")}`,
);
