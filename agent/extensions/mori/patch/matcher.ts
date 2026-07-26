/**
 * apply_patch chunk matcher: Codex 4-pass ladder per
 * chunk (exact → rstrip → trim → unicode-punctuation-normalize), forward scan
 * from the previous chunk's end, `@@` context narrowing, `*** End of File`
 * EOF anchoring, trailing-empty-line retry — plus ambiguity detection: after
 * a match at pass N the remainder is scanned at the same pass, and a second
 * hit errors with both locations. Ported from Codex
 * `apply-patch/src/seek_sequence.rs` + `lib.rs` compute_replacements.
 */
import type { UpdateChunk } from "./parser.ts";

/** One scheduled edit: replace `oldLen` lines at `index` with `newLines`. */
export interface Replacement {
	index: number;
	oldLen: number;
	newLines: string[];
}

export interface SeekResult {
	index: number;
	/** Which ladder pass matched (1 exact … 4 unicode-normalized). */
	pass: 1 | 2 | 3 | 4;
}

/** Normalize common unicode punctuation to ASCII (pass 4, git-apply-like). */
function normalize(s: string): string {
	let out = "";
	for (const ch of s.trim()) {
		switch (ch) {
			case "\u2010":
			case "\u2011":
			case "\u2012":
			case "\u2013":
			case "\u2014":
			case "\u2015":
			case "\u2212":
				out += "-";
				break;
			case "\u2018":
			case "\u2019":
			case "\u201A":
			case "\u201B":
				out += "'";
				break;
			case "\u201C":
			case "\u201D":
			case "\u201E":
			case "\u201F":
				out += '"';
				break;
			case "\u00A0":
			case "\u2002":
			case "\u2003":
			case "\u2004":
			case "\u2005":
			case "\u2006":
			case "\u2007":
			case "\u2008":
			case "\u2009":
			case "\u200A":
			case "\u202F":
			case "\u205F":
			case "\u3000":
				out += " ";
				break;
			default:
				out += ch;
		}
	}
	return out;
}

type LineComparator = (fileLine: string, patternLine: string) => boolean;

const PASSES: readonly LineComparator[] = [
	(a, b) => a === b,
	(a, b) => a.replace(/\s+$/, "") === b.replace(/\s+$/, ""),
	(a, b) => a.trim() === b.trim(),
	(a, b) => normalize(a) === normalize(b),
];

function matchesAt(lines: string[], pattern: string[], index: number, compare: LineComparator): boolean {
	for (let p = 0; p < pattern.length; p++) {
		if (!compare(lines[index + p]!, pattern[p]!)) return false;
	}
	return true;
}

function scan(lines: string[], pattern: string[], from: number, compare: LineComparator): number | undefined {
	for (let i = from; i <= lines.length - pattern.length; i++) {
		if (matchesAt(lines, pattern, i, compare)) return i;
	}
	return undefined;
}

/**
 * Find `pattern` within `lines` at or after `start`, trying each ladder pass
 * in turn. When `eof` is true the search starts at the end-of-file anchor
 * position. Empty pattern matches at `start`; oversized pattern never matches.
 */
export function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): SeekResult | undefined {
	if (pattern.length === 0) return { index: start, pass: 1 };
	if (pattern.length > lines.length) return undefined;
	const searchStart = eof ? lines.length - pattern.length : start;
	for (let pass = 0; pass < PASSES.length; pass++) {
		const index = scan(lines, pattern, searchStart, PASSES[pass]!);
		if (index !== undefined) return { index, pass: (pass + 1) as SeekResult["pass"] };
	}
	return undefined;
}

/** Scan the remainder at the same pass; returns the second hit, if any. */
function findSecondHit(lines: string[], pattern: string[], match: SeekResult): number | undefined {
	if (pattern.length === 0) return undefined;
	return scan(lines, pattern, match.index + 1, PASSES[match.pass - 1]!);
}

export interface ComputedReplacements {
	/** Empty when any error was collected. */
	replacements: Replacement[];
	/** File-scoped error messages, path prefixed by the caller. */
	errors: string[];
}

/**
 * Schedule the replacements that transform `originalLines` per `chunks`.
 * Collect-all: a failed chunk records its error and matching continues with
 * later chunks so one retry turn can fix everything.
 */
export function computeReplacements(originalLines: string[], chunks: UpdateChunk[]): ComputedReplacements {
	const replacements: Replacement[] = [];
	const errors: string[] = [];
	let lineIndex = 0;

	for (const chunk of chunks) {
		if (chunk.changeContext !== undefined) {
			const ctx = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
			if (!ctx) {
				errors.push(`failed to find context '${chunk.changeContext}'`);
				continue;
			}
			lineIndex = ctx.index + 1;
		}

		if (chunk.oldLines.length === 0) {
			// Pure addition: insert at the end of the file.
			replacements.push({ index: originalLines.length, oldLen: 0, newLines: [...chunk.newLines] });
			continue;
		}

		// Trailing-empty-line retry: the final "" often stands for the file's
		// terminating newline, which is stripped from originalLines.
		let pattern = chunk.oldLines;
		let newLines = chunk.newLines;
		let match = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		if (!match && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newLines[newLines.length - 1] === "") newLines = newLines.slice(0, -1);
			match = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		}

		if (!match) {
			errors.push(`failed to find expected lines:\n${chunk.oldLines.join("\n")}`);
			continue;
		}

		const secondHit = findSecondHit(originalLines, pattern, match);
		if (secondHit !== undefined) {
			errors.push(`ambiguous context, matches at lines ${match.index + 1} and ${secondHit + 1} — add @@ context`);
			continue;
		}

		replacements.push({ index: match.index, oldLen: pattern.length, newLines: [...newLines] });
		lineIndex = match.index + pattern.length;
	}

	if (errors.length > 0) return { replacements: [], errors };
	replacements.sort((a, b) => a.index - b.index);
	return { replacements, errors };
}

/** Apply replacements in descending order so indices stay stable. */
function applyReplacements(lines: string[], replacements: Replacement[]): string[] {
	const result = [...lines];
	for (let i = replacements.length - 1; i >= 0; i--) {
		const { index, oldLen, newLines } = replacements[i]!;
		result.splice(index, Math.min(oldLen, result.length - index), ...newLines);
	}
	return result;
}

export interface DerivedContents {
	/** Undefined when errors were collected. */
	newContents: string | undefined;
	errors: string[];
	/** Original file lines (trailing-newline element dropped), for diff display. */
	originalLines: string[];
	/** The applied replacement plan (empty when errors were collected). */
	replacements: Replacement[];
}

/**
 * Split file contents into lines, dropping the trailing empty element from
 * the final newline so line counts match standard `diff` behavior.
 */
export function splitContentLines(contents: string): string[] {
	const lines = contents.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** Derive the full new file contents for an Update hunk. */
export function deriveNewContents(originalContents: string, chunks: UpdateChunk[]): DerivedContents {
	const originalLines = splitContentLines(originalContents);

	const { replacements, errors } = computeReplacements(originalLines, chunks);
	if (errors.length > 0) return { newContents: undefined, errors, originalLines, replacements: [] };

	const newLines = applyReplacements(originalLines, replacements);
	if (newLines[newLines.length - 1] !== "") newLines.push("");
	return { newContents: newLines.join("\n"), errors: [], originalLines, replacements };
}
