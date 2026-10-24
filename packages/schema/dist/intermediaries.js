/** Missing inspection is unknown, never an implicit claim of direct access. */
export function toIntermediaryDisclosure(analysis) {
    return {
        requiresIntermediary: analysis?.requiresIntermediary ?? null,
        intermediaryDetails: analysis?.intermediaryDetails ?? null,
    };
}
//# sourceMappingURL=intermediaries.js.map