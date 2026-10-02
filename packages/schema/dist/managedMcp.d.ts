import { type inferred } from "arktype";
declare const definitionSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    id: string;
    name: string;
    company: string;
    description: string;
    category: string;
    version: string;
    setup?: string | undefined;
    icon: {
        pngBase64: string;
        license: string;
        attribution: string;
        sourceUrl?: string | undefined;
        licenseUrl?: string | undefined;
    };
    connection: {
        url: string;
        transport: "sse" | "streamable-http";
        auth: {
            kind: "none";
        } | {
            kind: "oauth";
            scope?: string | undefined;
        } | {
            kind: "api-key";
            header: string;
            placeholder: string;
        };
    };
}, {}>;
export type ManagedMcpDefinition = (typeof definitionSchema)[inferred];
export declare const MANAGED_MCP_DEFINITION_PATH = "clawhub-mcp.json";
/** Validate without reflecting potentially secret input in errors or logs. */
export declare function parseManagedMcpDefinition(raw: unknown): ManagedMcpDefinition;
/** Syntactic authoring restriction; network callers must additionally pin public DNS addresses. */
export declare function assertManagedMcpUrl(raw: string): void;
export {};
