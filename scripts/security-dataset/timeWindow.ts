export type CreatedTimeWindow = {
	createdAtGte: number | null;
	createdAtLt: number | null;
};

export type CreatedBounds<TSourceKind extends string = string> = {
	sourceKind: TSourceKind;
	minCreatedAt: number | null;
	maxCreatedAt: number | null;
};

export function emptyCreatedTimeWindow(): CreatedTimeWindow {
	return { createdAtGte: null, createdAtLt: null };
}

export function parseCreatedTimestamp(value: string, flag: string) {
	if (/^\d+$/.test(value)) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isSafeInteger(parsed)) return parsed;
	}

	const parsed = Date.parse(value);
	if (Number.isFinite(parsed)) return parsed;
	throw new Error(`Expected ${flag} to be a millisecond timestamp or ISO date.`);
}

export function assertCreatedTimeWindow(window: CreatedTimeWindow) {
	if (
		window.createdAtGte !== null &&
		window.createdAtLt !== null &&
		window.createdAtGte >= window.createdAtLt
	) {
		throw new Error("--created-after must be earlier than --created-before.");
	}
}

export function clampCreatedBounds<TSourceKind extends string>(
	bounds: CreatedBounds<TSourceKind>,
	window: CreatedTimeWindow,
): CreatedBounds<TSourceKind> {
	if (bounds.minCreatedAt === null || bounds.maxCreatedAt === null) return bounds;

	const minCreatedAt =
		window.createdAtGte === null
			? bounds.minCreatedAt
			: Math.max(bounds.minCreatedAt, window.createdAtGte);
	const maxCreatedExclusive =
		window.createdAtLt === null
			? bounds.maxCreatedAt + 1
			: Math.min(bounds.maxCreatedAt + 1, window.createdAtLt);

	if (minCreatedAt >= maxCreatedExclusive) {
		return { ...bounds, minCreatedAt: null, maxCreatedAt: null };
	}

	return { ...bounds, minCreatedAt, maxCreatedAt: maxCreatedExclusive - 1 };
}
