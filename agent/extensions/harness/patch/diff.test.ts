/**
 * Display-diff generation for the apply_patch TUI: pi's
 * line-numbered diff format (`+N `, `-N `, ` N `, `...`), built exactly from
 * the preflighted replacement plan — no diff algorithm.
 */
import { describe, expect, it } from "vitest";
import { buildDisplayDiff } from "./diff.ts";

describe("buildDisplayDiff", () => {
	it("renders a single replacement with context and line numbers", () => {
		const lines = ["a", "b", "c", "d", "e", "f", "g"];
		const diff = buildDisplayDiff(lines, [{ index: 3, oldLen: 1, newLines: ["D"] }]);
		expect(diff.split("\n")).toEqual([" 1 a", " 2 b", " 3 c", "-4 d", "+4 D", " 5 e", " 6 f", " 7 g"]);
	});

	it("limits context to 4 lines and separates distant chunks with ...", () => {
		const lines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
		const diff = buildDisplayDiff(lines, [
			{ index: 0, oldLen: 1, newLines: ["FIRST"] },
			{ index: 29, oldLen: 1, newLines: ["LAST"] },
		]);
		const rows = diff.split("\n");
		expect(rows[0]).toBe("- 1 line1");
		expect(rows[1]).toBe("+ 1 FIRST");
		// 4 trailing context lines, separator, 4 leading context lines.
		expect(rows.slice(2, 6)).toEqual(["  2 line2", "  3 line3", "  4 line4", "  5 line5"]);
		expect(rows[6]).toMatch(/^\s+\.\.\.$/);
		expect(rows.slice(7, 11)).toEqual([" 26 line26", " 27 line27", " 28 line28", " 29 line29"]);
		expect(rows[11]).toBe("-30 line30");
		expect(rows[12]).toBe("+30 LAST");
	});

	it("tracks shifted new-file line numbers after insertions", () => {
		const lines = ["a", "b", "c"];
		const diff = buildDisplayDiff(lines, [
			{ index: 0, oldLen: 1, newLines: ["a1", "a2"] },
			{ index: 2, oldLen: 1, newLines: ["C"] },
		]);
		// Context lines are numbered by the old file (pi generateDiffString parity).
		expect(diff.split("\n")).toEqual(["-1 a", "+1 a1", "+2 a2", " 2 b", "-3 c", "+4 C"]);
	});

	it("renders pure insertions", () => {
		const diff = buildDisplayDiff(["a"], [{ index: 1, oldLen: 0, newLines: ["b"] }]);
		expect(diff.split("\n")).toEqual([" 1 a", "+2 b"]);
	});

	it("renders whole-file adds and deletes", () => {
		expect(buildDisplayDiff([], [{ index: 0, oldLen: 0, newLines: ["x", "y"] }]).split("\n")).toEqual([
			"+1 x",
			"+2 y",
		]);
		expect(buildDisplayDiff(["x", "y"], [{ index: 0, oldLen: 2, newLines: [] }]).split("\n")).toEqual([
			"-1 x",
			"-2 y",
		]);
	});
});
