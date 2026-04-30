export declare const TEXT_FILE_EXTENSIONS: readonly ["md", "mdx", "txt", "json", "json5", "yaml", "yml", "toml", "js", "cjs", "mjs", "ts", "tsx", "jsx", "py", "sh", "r", "rb", "go", "rs", "swift", "kt", "java", "cs", "cpp", "c", "h", "hpp", "sql", "csv", "ini", "cfg", "env", "xml", "html", "css", "scss", "sass", "svg"];
export declare const TEXT_FILE_EXTENSION_SET: Set<string>;
export declare const TEXT_CONTENT_TYPES: readonly ["application/json", "application/xml", "application/yaml", "application/x-yaml", "application/toml", "application/javascript", "application/typescript", "application/markdown", "image/svg+xml"];
export declare const TEXT_CONTENT_TYPE_SET: Set<string>;
export declare function isTextContentType(contentType: string): boolean;
export declare function guessTextContentType(path: string): string | undefined;
export declare function normalizeTextContentType(path: string, contentType?: string | null): string | undefined;
