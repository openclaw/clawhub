import { ArkErrors } from "arktype";
export function parseArk(schema, data, label) {
    const result = schema(data);
    if (result instanceof ArkErrors) {
        throw new Error(`${label}: ${formatArkErrors(result)}`);
    }
    return result;
}
export function formatArkErrors(errors) {
    const parts = [];
    for (const error of errors) {
        if (parts.length >= 3)
            break;
        const path = Array.isArray(error.path) ? error.path.join(".") : "";
        const location = path ? `${path}: ` : "";
        const description = typeof error.description === "string"
            ? error.description
            : "invalid value";
        parts.push(`${location}${description}`);
    }
    if (errors.count > parts.length) {
        parts.push(`+${errors.count - parts.length} more`);
    }
    return parts.join("; ");
}
//# sourceMappingURL=ark.js.map