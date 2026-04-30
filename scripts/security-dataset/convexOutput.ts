export function parseConvexJson(output: string): unknown {
	return parseConvexJsonMatching(output, isJsonValue);
}

export function parseConvexJsonMatching<T>(
	output: string,
	validate: (value: unknown) => value is T,
): T {
	for (let index = 0; index < output.length; index += 1) {
		const char = output[index];
		if (char !== "{" && char !== "[") continue;

		const end = findJsonValueEnd(output, index);
		if (end === null) continue;

		try {
			const parsed: unknown = JSON.parse(output.slice(index, end));
			if (validate(parsed)) return parsed;
		} catch {
			continue;
		}
	}

	throw new Error(`Unable to parse matching Convex JSON output (${output.length} bytes)`);
}

function isJsonValue(value: unknown): value is unknown {
	return value !== undefined;
}

function findJsonValueEnd(output: string, start: number) {
	const first = output[start];
	const stack = first === "{" ? ["}"] : first === "[" ? ["]"] : [];
	let inString = false;
	let escaped = false;

	for (let index = start + 1; index < output.length; index += 1) {
		const char = output[index];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
		} else if (char === "{") {
			stack.push("}");
		} else if (char === "[") {
			stack.push("]");
		} else if (char === "}" || char === "]") {
			if (stack.at(-1) !== char) return null;
			stack.pop();
			if (stack.length === 0) return index + 1;
		}
	}

	return null;
}
