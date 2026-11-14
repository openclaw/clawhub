export function writeJsonIfRequested(json: boolean | undefined, value: unknown) {
  if (!json) return false;
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  return true;
}
