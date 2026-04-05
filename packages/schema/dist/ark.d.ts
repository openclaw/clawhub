import { ArkErrors } from "arktype";
export type ArkValidator<T> = (data: unknown) => T | ArkErrors;
export declare function parseArk<T>(schema: ArkValidator<T>, data: unknown, label: string): T;
export declare function formatArkErrors(errors: ArkErrors): string;
