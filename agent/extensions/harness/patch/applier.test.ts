/**
 * apply_patch applier (spec §4.4): full preflight → sequential writes →
 * rollback; collect-all preflight errors; move + parent-dir creation;
 * cwd-relative and absolute path handling; A/M/D summary.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPatch, defaultFsOps, type PatchFsOps } from "./applier.ts";

const dirs: string[] = [];
const makeCwd = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "pi-apply-patch-test-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const wrap = (body: string): string => `*** Begin Patch\n${body}\n*** End Patch`;

describe("applyPatch — happy path", () => {
	it("applies a multi-file patch and reports A/M/D summary lines", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "update.txt"), "keep\nold\n");
		writeFileSync(join(cwd, "delete.txt"), "bye\n");

		const result = await applyPatch(
			wrap(
				[
					"*** Add File: sub/add.txt",
					"+hello",
					"*** Update File: update.txt",
					"@@",
					"-old",
					"+new",
					"*** Delete File: delete.txt",
				].join("\n"),
			),
			cwd,
		);

		expect(result.summary).toBe(
			"Success. Updated the following files:\nA sub/add.txt\nM update.txt\nD delete.txt",
		);
		expect(readFileSync(join(cwd, "sub/add.txt"), "utf8")).toBe("hello\n");
		expect(readFileSync(join(cwd, "update.txt"), "utf8")).toBe("keep\nnew\n");
		expect(existsSync(join(cwd, "delete.txt"))).toBe(false);
	});

	it("moves a file, creating parent dirs, and reports M old -> new", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "old.txt"), "a\nb\n");

		const result = await applyPatch(
			wrap(["*** Update File: old.txt", "*** Move to: nested/dir/new.txt", "@@", "-a", "+A"].join("\n")),
			cwd,
		);

		expect(result.summary).toBe("Success. Updated the following files:\nM old.txt -> nested/dir/new.txt");
		expect(existsSync(join(cwd, "old.txt"))).toBe(false);
		expect(readFileSync(join(cwd, "nested/dir/new.txt"), "utf8")).toBe("A\nb\n");
	});

	it("accepts absolute paths as-is", async () => {
		const cwd = makeCwd();
		const other = makeCwd();
		const absolute = join(other, "abs.txt");
		writeFileSync(absolute, "x\n");

		const result = await applyPatch(wrap([`*** Update File: ${absolute}`, "@@", "-x", "+y"].join("\n")), cwd);

		expect(readFileSync(absolute, "utf8")).toBe("y\n");
		expect(result.summary).toContain(`M ${absolute}`);
	});

	it("resolves relative paths against the given cwd", async () => {
		const cwd = makeCwd();
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src/f.txt"), "x\n");

		await applyPatch(wrap(["*** Update File: src/f.txt", "@@", "-x", "+y"].join("\n")), cwd);
		expect(readFileSync(join(cwd, "src/f.txt"), "utf8")).toBe("y\n");
	});
});

describe("applyPatch — preflight errors (collect-all)", () => {
	it("collects every preflight error instead of failing fast", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "present.txt"), "dup\nmid\ndup\n");
		mkdirSync(join(cwd, "adir"));

		const patch = wrap(
			[
				"*** Update File: missing.txt",
				"@@",
				"-a",
				"+b",
				"*** Delete File: adir",
				"*** Update File: present.txt",
				"@@",
				"-dup",
				"+DUP",
			].join("\n"),
		);

		const error = await applyPatch(patch, cwd).catch((e: unknown) => e as Error);
		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toContain("missing.txt: file not found");
		expect(message).toContain("adir: is a directory");
		expect(message).toContain("present.txt: ambiguous context, matches at lines 1 and 3 — add @@ context");
		// Nothing was written.
		expect(readFileSync(join(cwd, "present.txt"), "utf8")).toBe("dup\nmid\ndup\n");
	});

	it("reports failed-to-find with the expected lines", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "f.txt"), "actual\n");
		const error = await applyPatch(
			wrap(["*** Update File: f.txt", "@@", "-not here", "+x"].join("\n")),
			cwd,
		).catch((e: unknown) => e as Error);
		expect((error as Error).message).toContain("f.txt: failed to find expected lines:\nnot here");
	});

	it("rejects an empty patch", async () => {
		const cwd = makeCwd();
		await expect(applyPatch("*** Begin Patch\n*** End Patch", cwd)).rejects.toThrow("No files were modified.");
	});

	it("fails fast and loudly on a truncated envelope", async () => {
		const cwd = makeCwd();
		await expect(applyPatch("*** Begin Patch\n*** Add File: f.txt\n+x\n", cwd)).rejects.toThrow(
			"The last line of the patch must be '*** End Patch'",
		);
	});
});

describe("applyPatch — atomicity", () => {
	it("rolls back all written files on a forced mid-write failure", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "one.txt"), "one-old\n");
		writeFileSync(join(cwd, "two.txt"), "two-old\n");
		writeFileSync(join(cwd, "gone.txt"), "gone\n");

		let writes = 0;
		const failingOps: PatchFsOps = {
			...defaultFsOps,
			writeFile: async (path, content) => {
				writes += 1;
				if (writes === 2) throw new Error("disk full");
				return defaultFsOps.writeFile(path, content);
			},
		};

		const patch = wrap(
			[
				"*** Update File: one.txt",
				"@@",
				"-one-old",
				"+one-new",
				"*** Update File: two.txt",
				"@@",
				"-two-old",
				"+two-new",
				"*** Delete File: gone.txt",
			].join("\n"),
		);

		const error = await applyPatch(patch, cwd, failingOps).catch((e: unknown) => e as Error);
		expect((error as Error).message).toContain("patch failed");
		expect((error as Error).message).toContain("disk full");
		expect((error as Error).message).toContain("no files were changed");
		// Everything restored.
		expect(readFileSync(join(cwd, "one.txt"), "utf8")).toBe("one-old\n");
		expect(readFileSync(join(cwd, "two.txt"), "utf8")).toBe("two-old\n");
		expect(readFileSync(join(cwd, "gone.txt"), "utf8")).toBe("gone\n");
	});

	it("rolls back a partially executed move", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "src.txt"), "content\n");
		writeFileSync(join(cwd, "later.txt"), "later-old\n");

		let writes = 0;
		const failingOps: PatchFsOps = {
			...defaultFsOps,
			writeFile: async (path, content) => {
				writes += 1;
				if (writes === 2) throw new Error("boom");
				return defaultFsOps.writeFile(path, content);
			},
		};

		const patch = wrap(
			[
				"*** Update File: src.txt",
				"*** Move to: dst.txt",
				"@@",
				"-content",
				"+changed",
				"*** Update File: later.txt",
				"@@",
				"-later-old",
				"+later-new",
			].join("\n"),
		);

		await expect(applyPatch(patch, cwd, failingOps)).rejects.toThrow("boom");
		expect(readFileSync(join(cwd, "src.txt"), "utf8")).toBe("content\n");
		expect(existsSync(join(cwd, "dst.txt"))).toBe(false);
		expect(readFileSync(join(cwd, "later.txt"), "utf8")).toBe("later-old\n");
	});

	it("caveats honestly when rollback itself fails", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "a.txt"), "a-old\n");
		writeFileSync(join(cwd, "b.txt"), "b-old\n");

		let writes = 0;
		const ops: PatchFsOps = {
			...defaultFsOps,
			writeFile: async (path, content) => {
				writes += 1;
				if (writes >= 2) throw new Error("device error");
				return defaultFsOps.writeFile(path, content);
			},
		};

		const patch = wrap(
			["*** Update File: a.txt", "@@", "-a-old", "+a-new", "*** Update File: b.txt", "@@", "-b-old", "+b-new"].join(
				"\n",
			),
		);

		const error = await applyPatch(patch, cwd, ops).catch((e: unknown) => e as Error);
		expect((error as Error).message).toContain("Rollback also failed");
		expect((error as Error).message).toContain("a.txt");
	});
});

describe("applyPatch — result details", () => {
	it("returns per-file old/new contents for TUI diff rendering", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "u.txt"), "old\n");
		const result = await applyPatch(
			wrap(["*** Add File: a.txt", "+added", "*** Update File: u.txt", "@@", "-old", "+new"].join("\n")),
			cwd,
		);
		expect(result.files).toEqual([
			{
				kind: "add",
				path: "a.txt",
				movePath: undefined,
				oldContents: undefined,
				newContents: "added\n",
				diff: "+1 added",
				added: 1,
				removed: 0,
			},
			{
				kind: "update",
				path: "u.txt",
				movePath: undefined,
				oldContents: "old\n",
				newContents: "new\n",
				diff: "-1 old\n+1 new",
				added: 1,
				removed: 1,
			},
		]);
	});
});
