import { caseFold } from "unicode-case-folding";

const WINDOWS_INVALID_PATH_CHARS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNICODE_CONTROL_CHARACTER = /\p{Cc}/u;

export function hasPortablePathSegments(normalized: string): boolean {
  return normalized
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !WINDOWS_INVALID_PATH_CHARS.test(segment) &&
        !UNICODE_CONTROL_CHARACTER.test(segment) &&
        !segment.endsWith(".") &&
        !segment.endsWith(" ") &&
        !WINDOWS_RESERVED_PATH_SEGMENT.test(segment),
    );
}

export function portablePathKey(value: string): string {
  return caseFold(value.replaceAll("\\", "/").normalize("NFC"));
}
