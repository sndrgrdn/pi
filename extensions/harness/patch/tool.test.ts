/**
 * apply_patch tool contract (spec §4.4): schema `{patch}`, summary-only A/M/D
 * model result, per-file diff details for the TUI, per-session mutex.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPatchHeader, createApplyPatchTool } from "./tool.ts";

const dirs: string[] = [];
const makeCwd = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "pi-apply-patch-tool-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ctx = (cwd: string) => ({ cwd }) as any;

const execute = async (tool: ReturnType<typeof createApplyPatchTool>, patch: string, cwd: string) =>
	tool.execute("call-1", { patch }, undefined as any, undefined, ctx(cwd));

describe("apply_patch tool", () => {
	it("returns a summary-only model result and per-file diff details", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "u.txt"), "old\n");
		const tool = createApplyPatchTool();

		const result = await execute(
			tool,
			"*** Begin Patch\n*** Add File: a.txt\n+added\n*** Update File: u.txt\n@@\n-old\n+new\n*** End Patch",
			cwd,
		);

		expect(result.content).toEqual([
			{ type: "text", text: "Success. Updated the following files:\nA a.txt\nM u.txt" },
		]);
		expect(result.details?.files).toHaveLength(2);
		expect(result.details?.files[0]).toMatchObject({ kind: "add", path: "a.txt", diff: "+1 added" });
		expect(result.details?.files[1]).toMatchObject({ kind: "update", path: "u.txt", diff: "-1 old\n+1 new" });
	});

	it("surfaces collected preflight errors as a tool error", async () => {
		const cwd = makeCwd();
		const tool = createApplyPatchTool();
		await expect(
			execute(tool, "*** Begin Patch\n*** Update File: nope.txt\n@@\n-x\n+y\n*** End Patch", cwd),
		).rejects.toThrow("nope.txt: file not found");
	});

	it("serializes concurrent calls through the per-session mutex", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "counter.txt"), "0\n");
		const tool = createApplyPatchTool();

		// Both patches transform 0 -> 1 -> 2; without the mutex the second
		// preflight would race the first write and both would read "0".
		const first = execute(tool, "*** Begin Patch\n*** Update File: counter.txt\n@@\n-0\n+1\n*** End Patch", cwd);
		const second = execute(tool, "*** Begin Patch\n*** Update File: counter.txt\n@@\n-1\n+2\n*** End Patch", cwd);
		await Promise.all([first, second]);
		expect(readFileSync(join(cwd, "counter.txt"), "utf8")).toBe("2\n");
	});

	it("keeps serializing after a failed call", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "f.txt"), "a\n");
		const tool = createApplyPatchTool();

		await expect(execute(tool, "garbage", cwd)).rejects.toThrow();
		const result = await execute(tool, "*** Begin Patch\n*** Update File: f.txt\n@@\n-a\n+b\n*** End Patch", cwd);
		const first = result.content[0];
		expect(first?.type === "text" ? first.text : "").toContain("M f.txt");
	});
});

describe("buildPatchHeader", () => {
	it("summarizes file and +/- counts from the patch text", () => {
		const header = buildPatchHeader(
			"*** Begin Patch\n*** Add File: a.txt\n+one\n+two\n*** Update File: b.txt\n@@\n-x\n+y\n*** End Patch",
		);
		expect(header).toBe("apply_patch · 2 files (+3 -1)");
	});

	it("falls back to the bare tool name while the patch is incomplete", () => {
		expect(buildPatchHeader("*** Begin Patch\n*** Add F")).toBe("apply_patch");
	});

	it("uses the singular for one file", () => {
		expect(buildPatchHeader("*** Begin Patch\n*** Delete File: a.txt\n*** End Patch")).toBe(
			"apply_patch · 1 file (+0 -0)",
		);
	});
});
