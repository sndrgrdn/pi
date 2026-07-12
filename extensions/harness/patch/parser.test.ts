/**
 * Grammar accept/reject table for the apply_patch envelope parser (spec §4.4).
 * Fixture cases ported from Codex `apply-patch/src/parser.rs` and
 * `streaming_parser.rs`.
 */
import { describe, expect, it } from "vitest";
import { parsePatch, PatchParseError } from "./parser.ts";

describe("parsePatch — accept table", () => {
	it("parses an empty patch", () => {
		expect(parsePatch("*** Begin Patch\n*** End Patch")).toEqual([]);
	});

	it("parses add / delete / update-with-move hunks", () => {
		const hunks = parsePatch(
			[
				"*** Begin Patch",
				"*** Add File: path/add.py",
				"+abc",
				"+def",
				"*** Delete File: path/delete.py",
				"*** Update File: path/update.py",
				"*** Move to: path/update2.py",
				"@@ def f():",
				"-    pass",
				"+    return 123",
				"*** End Patch",
			].join("\n"),
		);
		expect(hunks).toEqual([
			{ type: "add", path: "path/add.py", contents: "abc\ndef\n" },
			{ type: "delete", path: "path/delete.py" },
			{
				type: "update",
				path: "path/update.py",
				movePath: "path/update2.py",
				chunks: [
					{
						changeContext: "def f():",
						oldLines: ["    pass"],
						newLines: ["    return 123"],
						isEndOfFile: false,
					},
				],
			},
		]);
	});

	it("parses an update hunk followed by an add hunk", () => {
		const hunks = parsePatch(
			"*** Begin Patch\n*** Update File: file.py\n@@\n+line\n*** Add File: other.py\n+content\n*** End Patch",
		);
		expect(hunks).toEqual([
			{
				type: "update",
				path: "file.py",
				movePath: undefined,
				chunks: [{ changeContext: undefined, oldLines: [], newLines: ["line"], isEndOfFile: false }],
			},
			{ type: "add", path: "other.py", contents: "content\n" },
		]);
	});

	it("parses an update chunk without an explicit @@ header", () => {
		const hunks = parsePatch("*** Begin Patch\n*** Update File: file2.py\n import foo\n+bar\n*** End Patch");
		expect(hunks).toEqual([
			{
				type: "update",
				path: "file2.py",
				movePath: undefined,
				chunks: [
					{
						changeContext: undefined,
						oldLines: ["import foo"],
						newLines: ["import foo", "bar"],
						isEndOfFile: false,
					},
				],
			},
		]);
	});

	it("preserves the *** End of File marker on the final chunk", () => {
		const hunks = parsePatch(
			"*** Begin Patch\n*** Update File: file.txt\n@@\n+quux\n*** End of File\n\n*** End Patch",
		);
		expect(hunks).toEqual([
			{
				type: "update",
				path: "file.txt",
				movePath: undefined,
				chunks: [{ changeContext: undefined, oldLines: [], newLines: ["quux"], isEndOfFile: true }],
			},
		]);
	});

	it("tolerates whitespace around patch markers", () => {
		expect(parsePatch("*** Begin Patch \n*** Add File: foo\n+hi\n *** End Patch")).toEqual([
			{ type: "add", path: "foo", contents: "hi\n" },
		]);
	});

	it("accepts a trailing newline after *** End Patch", () => {
		expect(parsePatch("*** Begin Patch\n*** Add File: foo\n+hi\n*** End Patch\n")).toEqual([
			{ type: "add", path: "foo", contents: "hi\n" },
		]);
	});

	it("strips a heredoc wrapper (lenient parse)", () => {
		for (const open of ["<<EOF", "<<'EOF'", '<<"EOF"']) {
			expect(
				parsePatch(`${open}\n*** Begin Patch\n*** Update File: file2.py\n import foo\n+bar\n*** End Patch\nEOF\n`),
			).toEqual([
				{
					type: "update",
					path: "file2.py",
					movePath: undefined,
					chunks: [
						{
							changeContext: undefined,
							oldLines: ["import foo"],
							newLines: ["import foo", "bar"],
							isEndOfFile: false,
						},
					],
				},
			]);
		}
	});

	it("strips \\r line endings", () => {
		expect(
			parsePatch("*** Begin Patch\r\n*** Update File: file.txt\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\n"),
		).toEqual([
			{
				type: "update",
				path: "file.txt",
				movePath: undefined,
				chunks: [{ changeContext: undefined, oldLines: ["old"], newLines: ["new"], isEndOfFile: false }],
			},
		]);
	});

	it("keeps indented *** markers as context lines inside update hunks", () => {
		const hunks = parsePatch(
			[
				"*** Begin Patch",
				"*** Update File: a.txt",
				"@@",
				"-old a",
				"+new a",
				" *** Update File: b.txt",
				"@@",
				"-old b",
				"+new b",
				"*** End Patch",
			].join("\n"),
		);
		expect(hunks).toEqual([
			{
				type: "update",
				path: "a.txt",
				movePath: undefined,
				chunks: [
					{
						changeContext: undefined,
						oldLines: ["old a", "*** Update File: b.txt"],
						newLines: ["new a", "*** Update File: b.txt"],
						isEndOfFile: false,
					},
					{ changeContext: undefined, oldLines: ["old b"], newLines: ["new b"], isEndOfFile: false },
				],
			},
		]);
	});

	it("treats bare empty lines in update hunks as empty context lines", () => {
		const hunks = parsePatch(
			"*** Begin Patch\n*** Update File: file.txt\n@@\n context before\n\n context after\n*** End Patch",
		);
		expect(hunks).toEqual([
			{
				type: "update",
				path: "file.txt",
				movePath: undefined,
				chunks: [
					{
						changeContext: undefined,
						oldLines: ["context before", "", "context after"],
						newLines: ["context before", "", "context after"],
						isEndOfFile: false,
					},
				],
			},
		]);
	});
});

describe("parsePatch — reject table", () => {
	const rejects: Array<[name: string, patch: string, message: string]> = [
		["missing Begin Patch", "bad", "The first line of the patch must be '*** Begin Patch'"],
		[
			"truncated envelope (missing End Patch)",
			"*** Begin Patch\n*** Add File: file.txt\n+hello\n",
			"The last line of the patch must be '*** End Patch'",
		],
		[
			"content after End Patch",
			"*** Begin Patch\n*** Add File: file.txt\n+hello\n*** End Patch\nextra\n",
			"The last line of the patch must be '*** End Patch'",
		],
		[
			"invalid hunk header",
			"*** Begin Patch\nbad\n*** End Patch",
			"Invalid patch (line 2): 'bad' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
		],
		[
			"junk inside an add hunk",
			"*** Begin Patch\n*** Add File: file.txt\nbad\n*** End Patch",
			"Invalid patch (line 3): 'bad' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
		],
		[
			"junk after a delete hunk",
			"*** Begin Patch\n*** Delete File: file.txt\nbad\n*** End Patch",
			"Invalid patch (line 3): 'bad' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
		],
		[
			"empty update hunk",
			"*** Begin Patch\n*** Update File: test.py\n*** End Patch",
			"Invalid patch (line 2): Update file hunk for path 'test.py' is empty",
		],
		[
			"move followed by nothing",
			"*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** Delete File: other.txt\n*** End Patch",
			"Invalid patch (line 2): Update file hunk for path 'old.txt' is empty",
		],
		[
			"@@ chunk with no lines before End Patch",
			"*** Begin Patch\n*** Update File: file.txt\n@@\n*** End Patch",
			"Invalid patch (line 4): Update hunk does not contain any lines",
		],
		[
			"@@ chunk with no lines before End of File",
			"*** Begin Patch\n*** Update File: file.txt\n@@\n*** End of File\n*** End Patch",
			"Invalid patch (line 4): Update hunk does not contain any lines",
		],
		[
			"consecutive @@ markers with no lines",
			"*** Begin Patch\n*** Update File: file.txt\n@@\n@@\n+x\n*** End Patch",
			"Invalid patch (line 4): Unexpected line found in update hunk: '@@'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)",
		],
		[
			"unprefixed line after chunk lines",
			"*** Begin Patch\n*** Update File: file.txt\n@@\n-old\nbad\n*** End Patch",
			"Invalid patch (line 5): Expected update hunk to start with a @@ context marker, got: 'bad'",
		],
		[
			"nested update header inside a chunk",
			"*** Begin Patch\n*** Update File: file.txt\n@@\n*** Update File: other.txt\n+x\n*** End Patch",
			"Invalid patch (line 4): Unexpected line found in update hunk: '*** Update File: other.txt'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)",
		],
		[
			"heredoc with mismatched quotes",
			"<<\"EOF'\n*** Begin Patch\n*** Update File: f.py\n import foo\n+bar\n*** End Patch\nEOF\n",
			"The first line of the patch must be '*** Begin Patch'",
		],
		[
			"truncated heredoc",
			"<<EOF\n*** Begin Patch\n*** Update File: file2.py\nEOF\n",
			"The last line of the patch must be '*** End Patch'",
		],
	];

	it.each(rejects)("rejects %s", (_name, patch, message) => {
		expect(() => parsePatch(patch)).toThrowError(PatchParseError);
		expect(() => parsePatch(patch)).toThrowError(message);
	});
});
