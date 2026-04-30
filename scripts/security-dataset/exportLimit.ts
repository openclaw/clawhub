export type ExportLimitState = {
	sourceArtifacts: number;
};

export function reserveExportInputs<T>(inputs: T[], state: ExportLimitState, limit: number | null) {
	const remaining = limit === null ? inputs.length : Math.max(0, limit - state.sourceArtifacts);
	const reserved = inputs.slice(0, remaining);
	state.sourceArtifacts += reserved.length;
	return reserved;
}
