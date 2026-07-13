/**
 * apply_patch envelope parser (spec §4.4): full Codex envelope grammar with
 * lenient parse and loud truncation failure. Ported from Codex
 * `apply-patch/src/parser.rs` + `streaming_parser.rs`.
 *
 * Grammar:
 *   start: "*** Begin Patch" LF hunk* "*** End Patch" LF?
 *   hunk:  "*** Add File: " path LF ("+" line LF)+
 *        | "*** Delete File: " path LF
 *        | "*** Update File: " path LF ("*** Move to: " path LF)? chunk+
 *   chunk: ("@@" | "@@ " context)? LF ((" "|"+"|"-") line LF)+ ("*** End of File" LF)?
 *
 * Lenient behaviors: heredoc-wrapper strip, `\r` strip, whitespace-tolerant
 * markers, optional trailing LF. Hard error on unrecognized content inside
 * the envelope and on a missing `*** End Patch` (truncation fails loudly).
 */

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

export interface UpdateChunk {
	/** Optional `@@` context line that narrows where the chunk starts. */
	changeContext: string | undefined;
	/** Contiguous block of lines to be replaced by `newLines`. */
	oldLines: string[];
	newLines: string[];
	/** When true, `oldLines` must anchor at the end of the file. */
	isEndOfFile: boolean;
}

export type Hunk =
	| { type: "add"; path: string; contents: string }
	| { type: "delete"; path: string }
	| { type: "update"; path: string; movePath: string | undefined; chunks: UpdateChunk[] };

/** Envelope parse failure. Parse errors are fail-fast (spec §4.4 Errors). */
export class PatchParseError extends Error {
	constructor(why: string, lineNumber?: number) {
		super(lineNumber === undefined ? `Invalid patch: ${why}` : `Invalid patch (line ${lineNumber}): ${why}`);
		this.name = "PatchParseError";
	}
}

const INVALID_HUNK_HEADER = (line: string) =>
	`'${line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`;
const UNEXPECTED_UPDATE_LINE = (line: string) =>
	`Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`;

type Mode =
	| { kind: "add" }
	| { kind: "delete" }
	| { kind: "update"; hunkLineNumber: number }
	| { kind: "started" }
	| { kind: "ended" };

export function parsePatch(patch: string): Hunk[] {
	const rawLines = patch.trim().split("\n");
	const lines = stripHeredocWrapper(rawLines).map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	checkBoundaries(lines);
	return parseBody(lines);
}

/**
 * Lenient heredoc strip: if the strict boundary check fails and the text looks
 * like `<<EOF … EOF`, retry on the inner lines (Codex gpt-4.1 leniency).
 */
function stripHeredocWrapper(lines: string[]): string[] {
	try {
		checkBoundaries(lines);
		return lines;
	} catch (originalError) {
		const first = lines[0];
		const last = lines[lines.length - 1];
		if (
			lines.length >= 4 &&
			(first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
			last !== undefined &&
			last.endsWith("EOF")
		) {
			const inner = lines.slice(1, -1);
			checkBoundaries(inner);
			return inner;
		}
		throw originalError;
	}
}

/** Loud boundary check: first/last lines must be the Begin/End markers. */
function checkBoundaries(lines: string[]): void {
	const first = lines[0]?.trim();
	const last = lines[lines.length - 1]?.trim();
	if (first !== BEGIN_PATCH_MARKER) {
		throw new PatchParseError("The first line of the patch must be '*** Begin Patch'");
	}
	if (last !== END_PATCH_MARKER) {
		throw new PatchParseError("The last line of the patch must be '*** End Patch'");
	}
}

function parseBody(lines: string[]): Hunk[] {
	const hunks: Hunk[] = [];
	let mode: Mode = { kind: "started" };

	const lastUpdate = (): Extract<Hunk, { type: "update" }> => {
		const hunk = hunks[hunks.length - 1];
		if (hunk?.type !== "update") throw new Error("parser invariant: expected an update hunk");
		return hunk;
	};

	/**
	 * Reject transitions out of an update hunk that has produced no lines yet
	 * (empty hunk or a dangling `@@` marker).
	 */
	const ensureUpdateHunkIsNotEmpty = (line: string, lineNumber: number): void => {
		if (mode.kind !== "update") return;
		const { path, chunks } = lastUpdate();
		if (chunks.length === 0) {
			throw new PatchParseError(`Update file hunk for path '${path}' is empty`, mode.hunkLineNumber);
		}
		const tail = chunks[chunks.length - 1]!;
		if (tail.oldLines.length === 0 && tail.newLines.length === 0) {
			if (line === END_PATCH_MARKER) {
				throw new PatchParseError("Update hunk does not contain any lines", lineNumber);
			}
			throw new PatchParseError(UNEXPECTED_UPDATE_LINE(line), lineNumber);
		}
	};

	/** Handle hunk headers and `*** End Patch`; returns the next mode when consumed. */
	const handleHeaders = (trimmed: string, lineNumber: number): Mode | undefined => {
		if (trimmed === END_PATCH_MARKER) {
			ensureUpdateHunkIsNotEmpty(trimmed, lineNumber);
			return { kind: "ended" };
		}
		if (trimmed.startsWith(ADD_FILE_MARKER)) {
			ensureUpdateHunkIsNotEmpty(trimmed, lineNumber);
			hunks.push({ type: "add", path: trimmed.slice(ADD_FILE_MARKER.length), contents: "" });
			return { kind: "add" };
		}
		if (trimmed.startsWith(DELETE_FILE_MARKER)) {
			ensureUpdateHunkIsNotEmpty(trimmed, lineNumber);
			hunks.push({ type: "delete", path: trimmed.slice(DELETE_FILE_MARKER.length) });
			return { kind: "delete" };
		}
		if (trimmed.startsWith(UPDATE_FILE_MARKER)) {
			ensureUpdateHunkIsNotEmpty(trimmed, lineNumber);
			hunks.push({
				type: "update",
				path: trimmed.slice(UPDATE_FILE_MARKER.length),
				movePath: undefined,
				chunks: [],
			});
			return { kind: "update", hunkLineNumber: lineNumber };
		}
		return undefined;
	};

	const pushChunk = (changeContext: string | undefined, chunks: UpdateChunk[]): void => {
		chunks.push({ changeContext, oldLines: [], newLines: [], isEndOfFile: false });
	};

	// Body starts after "*** Begin Patch" (line 1); ends before "*** End Patch".
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i]!;
		const lineNumber = i + 1;
		const trimmed = line.trim();

		switch (mode.kind) {
			case "ended": {
				if (trimmed === "") break;
				throw new PatchParseError("The last line of the patch must be '*** End Patch'");
			}
			case "started":
			case "add":
			case "delete": {
				const next = handleHeaders(trimmed, lineNumber);
				if (next) {
					mode = next;
					break;
				}
				if (mode.kind === "add" && line.startsWith("+")) {
					const hunk = hunks[hunks.length - 1] as Extract<Hunk, { type: "add" }>;
					hunk.contents += `${line.slice(1)}\n`;
					break;
				}
				throw new PatchParseError(INVALID_HUNK_HEADER(trimmed), lineNumber);
			}
			case "update": {
				// Headers inside update hunks are detected on the rtrimmed line so
				// indented `*** …` text still reads as chunk content (Codex parity).
				const updateLine = line.replace(/\s+$/, "");
				const next = handleHeaders(updateLine, lineNumber);
				if (next) {
					mode = next;
					break;
				}

				const hunk = lastUpdate();
				const { chunks } = hunk;
				const tail = chunks[chunks.length - 1];

				if (tail?.isEndOfFile) {
					if (updateLine === "") break; // ignore empty lines after *** End of File
					if (updateLine !== EMPTY_CHANGE_CONTEXT_MARKER && !updateLine.startsWith(CHANGE_CONTEXT_MARKER)) {
						throw new PatchParseError(
							`Expected update hunk to start with a @@ context marker, got: '${line}'`,
							lineNumber,
						);
					}
				}

				if (chunks.length === 0 && hunk.movePath === undefined && updateLine.startsWith(MOVE_TO_MARKER)) {
					hunk.movePath = updateLine.slice(MOVE_TO_MARKER.length);
					break;
				}

				const isContextMarker =
					updateLine === EMPTY_CHANGE_CONTEXT_MARKER || updateLine.startsWith(CHANGE_CONTEXT_MARKER);
				if (isContextMarker && tail && tail.oldLines.length === 0 && tail.newLines.length === 0) {
					throw new PatchParseError(UNEXPECTED_UPDATE_LINE(line), lineNumber);
				}
				if (updateLine === EMPTY_CHANGE_CONTEXT_MARKER) {
					pushChunk(undefined, chunks);
					break;
				}
				if (updateLine.startsWith(CHANGE_CONTEXT_MARKER)) {
					pushChunk(updateLine.slice(CHANGE_CONTEXT_MARKER.length), chunks);
					break;
				}
				if (updateLine === EOF_MARKER) {
					if (tail && tail.oldLines.length === 0 && tail.newLines.length === 0) {
						throw new PatchParseError("Update hunk does not contain any lines", lineNumber);
					}
					if (tail) tail.isEndOfFile = true;
					break;
				}

				if (line === "") {
					// Bare empty line: lenient empty context line.
					if (chunks.length === 0) pushChunk(undefined, chunks);
					const chunk = chunks[chunks.length - 1]!;
					chunk.oldLines.push("");
					chunk.newLines.push("");
					break;
				}
				const prefix = line[0];
				if (prefix === " " || prefix === "+" || prefix === "-") {
					if (chunks.length === 0) pushChunk(undefined, chunks);
					const chunk = chunks[chunks.length - 1]!;
					const content = line.slice(1);
					if (prefix !== "+") chunk.oldLines.push(content);
					if (prefix !== "-") chunk.newLines.push(content);
					break;
				}

				if (tail && (tail.oldLines.length > 0 || tail.newLines.length > 0)) {
					throw new PatchParseError(
						`Expected update hunk to start with a @@ context marker, got: '${line}'`,
						lineNumber,
					);
				}
				throw new PatchParseError(UNEXPECTED_UPDATE_LINE(line), lineNumber);
			}
		}
	}

	return hunks;
}
