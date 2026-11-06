export type IntermediaryDisclosure = {
    requiresIntermediary: boolean | null;
    intermediaryDetails: string | null;
};
export type IntermediaryAnalysis = IntermediaryDisclosure & {
    checkedAt: number;
    recipe: string;
    model: string;
    evidence: Array<{
        path: string;
        snippet: string;
    }>;
};
/** Missing inspection is unknown, never an implicit claim of direct access. */
export declare function toIntermediaryDisclosure(analysis?: IntermediaryDisclosure | null): IntermediaryDisclosure;
