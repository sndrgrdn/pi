/**
 * 4-pass matching ladder + ambiguity detection.
 * seekSequence fixtures ported from Codex `apply-patch/src/seek_sequence.rs`;
 * replacement fixtures from `lib.rs` compute_replacements tests.
 */
import { describe, expect, it } from "vitest";
import { computeReplacements, deriveNewContents, seekSequence } from "./matcher.ts";
import type { UpdateChunk } from "./parser.ts";

const chunk = (partial: Partial<UpdateChunk>): UpdateChunk => ({
	changeContext: undefined,
	oldLines: [],
	newLines: [],
	isEndOfFile: false,
	...partial,
});

describe("seekSequence — matching ladder", () => {
	it("pass 1: exact match", () => {
		expect(seekSequence(["foo", "bar", "baz"], ["bar", "baz"], 0, false)).toEqual({ index: 1, pass: 1 });
	});

	it("pass 2: ignores trailing whitespace", () => {
		expect(seekSequence(["foo   ", "bar\t\t"], ["foo", "bar"], 0, false)).toEqual({ index: 0, pass: 2 });
	});

	it("pass 3: ignores leading and trailing whitespace", () => {
		expect(seekSequence(["    foo   ", "   bar\t"], ["foo", "bar"], 0, false)).toEqual({ index: 0, pass: 3 });
	});

	it("pass 4: normalizes unicode punctuation", () => {
		// En-dash and smart quotes in the file; ASCII in the pattern.
		expect(seekSequence(["let s = \u2018hi\u2019 \u2013 done"], ["let s = 'hi' - done"], 0, false)).toEqual({
			index: 0,
			pass: 4,
		});
	});

	it("respects the start offset (forward scan from previous chunk end)", () => {
		expect(seekSequence(["x", "y", "x"], ["x"], 1, false)).toEqual({ index: 2, pass: 1 });
	});

	it("anchors at EOF first when eof is set", () => {
		expect(seekSequence(["a", "b", "a", "b"], ["a", "b"], 0, true)).toEqual({ index: 2, pass: 1 });
	});

	it("returns undefined when the pattern is longer than the input", () => {
		expect(seekSequence(["just one line"], ["too", "many", "lines"], 0, false)).toBeUndefined();
	});

	it("returns undefined when nothing matches", () => {
		expect(seekSequence(["foo"], ["bar"], 0, false)).toBeUndefined();
	});
});

describe("computeReplacements", () => {
	it("computes a replacement for a plain chunk", () => {
		const result = computeReplacements(["a", "b", "c"], [chunk({ oldLines: ["b"], newLines: ["B"] })]);
		expect(result).toEqual({ replacements: [{ index: 1, oldLen: 1, newLines: ["B"] }], errors: [] });
	});

	it("narrows the start with an @@ change context", () => {
		const lines = ["def f():", "    pass", "def g():", "    pass"];
		const result = computeReplacements(lines, [
			chunk({ changeContext: "def g():", oldLines: ["    pass"], newLines: ["    return 1"] }),
		]);
		expect(result.replacements).toEqual([{ index: 3, oldLen: 1, newLines: ["    return 1"] }]);
		expect(result.errors).toEqual([]);
	});

	it("appends pure additions at the end of the file", () => {
		const result = computeReplacements(["a", "b"], [chunk({ newLines: ["c"] })]);
		expect(result.replacements).toEqual([{ index: 2, oldLen: 0, newLines: ["c"] }]);
	});

	it("retries without a trailing empty pattern line", () => {
		const result = computeReplacements(
			["last"],
			[chunk({ oldLines: ["last", ""], newLines: ["LAST", ""], isEndOfFile: false })],
		);
		expect(result.replacements).toEqual([{ index: 0, oldLen: 1, newLines: ["LAST"] }]);
		expect(result.errors).toEqual([]);
	});

	it("anchors *** End of File chunks at EOF", () => {
		const lines = ["x", "tail", "y", "tail"];
		const result = computeReplacements(lines, [chunk({ oldLines: ["tail"], newLines: ["TAIL"], isEndOfFile: true })]);
		expect(result.replacements).toEqual([{ index: 3, oldLen: 1, newLines: ["TAIL"] }]);
	});

	it("errors with both locations when the context is ambiguous", () => {
		const lines = ["dup", "mid", "dup"];
		const result = computeReplacements(lines, [chunk({ oldLines: ["dup"], newLines: ["DUP"] })]);
		expect(result.replacements).toEqual([]);
		expect(result.errors).toEqual(["ambiguous context, matches at lines 1 and 3 — add @@ context"]);
	});

	it("only reports ambiguity for second hits at the same pass", () => {
		// Exact match at line 1; a trim-level (pass 3) shadow at line 3 is not ambiguous.
		const lines = ["dup", "mid", "  dup  "];
		const result = computeReplacements(lines, [chunk({ oldLines: ["dup"], newLines: ["DUP"] })]);
		expect(result.replacements).toEqual([{ index: 0, oldLen: 1, newLines: ["DUP"] }]);
		expect(result.errors).toEqual([]);
	});

	it("collects an error for a missing context line", () => {
		const result = computeReplacements(["a"], [chunk({ changeContext: "nope", oldLines: ["a"], newLines: ["b"] })]);
		expect(result.errors).toEqual(["failed to find context 'nope'"]);
	});

	it("collects errors for unmatched lines and keeps checking later chunks", () => {
		const result = computeReplacements(
			["a", "b"],
			[
				chunk({ oldLines: ["missing", "lines"], newLines: ["x"] }),
				chunk({ oldLines: ["also missing"], newLines: ["y"] }),
			],
		);
		expect(result.replacements).toEqual([]);
		expect(result.errors).toEqual([
			"failed to find expected lines:\nmissing\nlines",
			"failed to find expected lines:\nalso missing",
		]);
	});
});

describe("deriveNewContents", () => {
	it("applies chunks in order and preserves the trailing newline", () => {
		const result = deriveNewContents("a\nb\nc\n", [
			chunk({ oldLines: ["a"], newLines: ["A"] }),
			chunk({ oldLines: ["c"], newLines: ["C", "D"] }),
		]);
		expect(result.newContents).toBe("A\nb\nC\nD\n");
		expect(result.errors).toEqual([]);
		expect(result.originalLines).toEqual(["a", "b", "c"]);
		expect(result.replacements).toEqual([
			{ index: 0, oldLen: 1, newLines: ["A"] },
			{ index: 2, oldLen: 1, newLines: ["C", "D"] },
		]);
	});

	it("adds a trailing newline to files that lack one", () => {
		const result = deriveNewContents("a", [chunk({ oldLines: ["a"], newLines: ["b"] })]);
		expect(result.newContents).toBe("b\n");
		expect(result.errors).toEqual([]);
	});

	it("returns errors instead of contents when matching fails", () => {
		const result = deriveNewContents("a\n", [chunk({ oldLines: ["zzz"], newLines: ["b"] })]);
		expect(result.newContents).toBeUndefined();
		expect(result.errors).toEqual(["failed to find expected lines:\nzzz"]);
	});
});
