/**
 * Display-diff builder for the apply_patch TUI. Produces pi's
 * line-numbered diff text (`+N content` / `-N content` / ` N content` with a
 * `...` separator), consumable by pi's `renderDiff`. Built directly from the
 * preflighted replacement plan, so it reflects exactly what was applied.
 */
import type { Replacement } from "./matcher.ts";

const CONTEXT_LINES = 4;

/**
 * Render the display diff for one file from its original lines and the
 * (ascending, non-overlapping) replacements that were applied to it.
 */
export function buildDisplayDiff(
	originalLines: string[],
	replacements: Replacement[],
	context = CONTEXT_LINES,
): string {
	const newTotal = originalLines.length + replacements.reduce((n, r) => n + r.newLines.length - r.oldLen, 0);
	const width = String(Math.max(originalLines.length, newTotal, 1)).length;
	const pad = (n: number): string => String(n).padStart(width, " ");

	const rows: string[] = [];
	let delta = 0; // newLineNum - oldLineNum so far
	let emittedThrough = 0; // exclusive old-line index rendered so far

	const emitContext = (fromIdx: number, toIdx: number): void => {
		for (let i = fromIdx; i < toIdx; i++) {
			rows.push(` ${pad(i + 1)} ${originalLines[i]}`);
		}
	};

	for (let r = 0; r < replacements.length; r++) {
		const { index, oldLen, newLines } = replacements[r]!;

		// Leading context: up to `context` lines, from where we left off.
		const contextStart = Math.max(emittedThrough, index - context);
		if (contextStart > emittedThrough && rows.length > 0) {
			rows.push(` ${"".padStart(width, " ")} ...`);
		}
		emitContext(contextStart, index);

		for (let i = 0; i < oldLen; i++) {
			rows.push(`-${pad(index + i + 1)} ${originalLines[index + i]}`);
		}
		for (let i = 0; i < newLines.length; i++) {
			rows.push(`+${pad(index + delta + i + 1)} ${newLines[i]}`);
		}
		delta += newLines.length - oldLen;
		emittedThrough = index + oldLen;

		// Trailing context: up to `context` lines, but stop short of the next
		// replacement's own leading context.
		const nextIndex = replacements[r + 1]?.index ?? Number.POSITIVE_INFINITY;
		const trailingEnd = Math.min(emittedThrough + context, originalLines.length, nextIndex);
		emitContext(emittedThrough, trailingEnd);
		emittedThrough = trailingEnd;
	}

	return rows.join("\n");
}

/** Total added/removed line counts for a replacement plan. */
export function countChanges(replacements: Replacement[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const { oldLen, newLines } of replacements) {
		added += newLines.length;
		removed += oldLen;
	}
	return { added, removed };
}
