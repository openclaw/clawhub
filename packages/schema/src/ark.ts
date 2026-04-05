import { ArkErrors } from "arktype";

export type ArkValidator<T> = (data: unknown) => T | ArkErrors;

export function parseArk<T>(schema: ArkValidator<T>, data: unknown, label: string) {
  const result = schema(data);
  if (result instanceof ArkErrors) {
    throw new Error(`${label}: ${formatArkErrors(result)}`);
  }
  return result;
}

export function formatArkErrors(errors: ArkErrors) {
  const parts: string[] = [];
  for (const error of errors) {
    if (parts.length >= 3) break;
    const path = Array.isArray(error.path) ? error.path.join(".") : "";
    const location = path ? `${path}: ` : "";
    const description =
      typeof (error as { description?: unknown }).description === "string"
        ? ((error as { description: string }).description as string)
        : "invalid value";
    parts.push(`${location}${description}`);
  }
  if (errors.count > parts.length) {
    parts.push(`+${errors.count - parts.length} more`);
  }
  return parts.join("; ");
}
