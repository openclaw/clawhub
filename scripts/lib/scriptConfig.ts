export function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function optionalNumberFrom(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function numberFrom(value: string | undefined, fallback: number) {
  return optionalNumberFrom(value) ?? fallback;
}
