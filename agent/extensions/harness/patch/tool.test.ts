/**
 * apply_patch tool contract (spec §4.4): schema `{patch}`, summary-only A/M/D
 * model result, per-file diff details for the TUI, per-session mutex.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApplyPatchTool, registerApplyPatch } from "./tool.ts";

const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => `<b>${value}</b>`,
} as any;

function renderedLines(component: { render(width: number): string[] }): string[] {
	return component.render(200).map((line) => line.trimEnd());
}

const dirs: string[] = [];
beforeAll(() => initTheme());
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
	it("renders one affected path and invocation mutation counts as a collapsed Trace row", () => {
		const tool = createApplyPatchTool();
		const patch = "*** Begin Patch\n*** Update File: src/file.ts\n@@\n-old\n+new\n+extra\n*** End Patch";
		const component = tool.renderResult!(
			{ content: [{ type: "text", text: "hidden" }] } as any,
			{ expanded: false, isPartial: false },
			theme,
			{ args: { patch }, cwd: "/work", isError: false } as any,
		);

		expect(renderedLines(component)).toEqual([
			"<success>✓</success> <b>apply_patch</b> ./src/file.ts · <muted>+2 -1</muted>",
		]);
	});

	it("renders the affected file count for a multi-file patch", () => {
		const tool = createApplyPatchTool();
		const patch = "*** Begin Patch\n*** Add File: a.txt\n+one\n*** Delete File: b.txt\n*** End Patch";
		const component = tool.renderResult!(
			{ content: [{ type: "text", text: "hidden" }] } as any,
			{ expanded: false, isPartial: false },
			theme,
			{ args: { patch }, cwd: "/work", isError: false } as any,
		);

		expect(renderedLines(component)).toEqual([
			"<success>✓</success> <b>apply_patch</b> 2 files · <muted>+1 -0</muted>",
		]);
	});

	it("counts unique affected files rather than repeated hunks", () => {
		const tool = createApplyPatchTool();
		const patch =
			"*** Begin Patch\n*** Update File: file.txt\n@@ first\n-old\n+new\n*** Update File: file.txt\n@@ second\n-before\n+after\n*** End Patch";
		const component = tool.renderResult!(
			{ content: [{ type: "text", text: "hidden" }] } as any,
			{ expanded: false, isPartial: false },
			theme,
			{ args: { patch }, cwd: "/work", isError: false } as any,
		);

		expect(renderedLines(component)).toEqual([
			"<success>✓</success> <b>apply_patch</b> ./file.txt · <muted>+2 -2</muted>",
		]);
	});

	it("returns a summary-only model result and per-file diff details", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "u.txt"), "old\n");
		const tool = createApplyPatchTool();

		const updates: any[] = [];
		const patch =
			"*** Begin Patch\n*** Add File: a.txt\n+added\n*** Update File: u.txt\n@@\n-old\n+new\n*** End Patch";
		const result = await tool.execute(
			"call-1",
			{ patch },
			undefined as any,
			(update: any) => updates.push(update),
			ctx(cwd),
		);

		expect(updates[0]?.details).toEqual({ trace: { state: "running" } });
		expect(result.content).toEqual([
			{ type: "text", text: "Success. Updated the following files:\nA a.txt\nM u.txt" },
		]);
		expect(result.details?.files).toHaveLength(2);
		expect(result.details?.files[0]).toMatchObject({ kind: "add", path: "a.txt", diff: "+1 added" });
		expect(result.details?.files[1]).toMatchObject({ kind: "update", path: "u.txt", diff: "-1 old\n+1 new" });
		// Full file contents stay out of the session record.
		expect(result.details?.files[0]).not.toHaveProperty("newContents");
		expect(result.details?.files[1]).not.toHaveProperty("oldContents");
		expect(result.details?.trace).toEqual({ state: "success" });
	});

	it("preserves per-file diffs only in the expanded Trace row", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "file.txt"), "old\n");
		const tool = createApplyPatchTool();
		const patch = "*** Begin Patch\n*** Update File: file.txt\n@@\n-old\n+new\n*** End Patch";
		const result = await execute(tool, patch, cwd);
		const context = { args: { patch }, cwd, isError: false } as any;

		const collapsed = renderedLines(
			tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context),
		).join("\n");
		const expanded = renderedLines(
			tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context),
		).join("\n");

		expect(collapsed).not.toContain("M ./file.txt");
		expect(collapsed).not.toContain("old");
		expect(expanded).toContain("M ./file.txt");
		expect(expanded).toContain("old");
		expect(expanded).toContain("new");
	});

	it("surfaces collected preflight errors as a tool error", async () => {
		const cwd = makeCwd();
		const tool = createApplyPatchTool();
		const patch = "*** Begin Patch\n*** Update File: nope.txt\n@@\n-x\n+y\n*** End Patch";
		await expect(execute(tool, patch, cwd)).rejects.toThrow("nope.txt: file not found");
		const result = { content: [{ type: "text", text: "nope.txt: file not found" }] } as any;
		const context = { args: { patch }, cwd, isError: true } as any;

		expect(renderedLines(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context))).toEqual([
			"<error>✗</error> <b>apply_patch</b> ./nope.txt · <muted>+1 -1</muted>",
		]);
		expect(renderedLines(tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context))).toEqual([
			"<error>✗</error> <b>apply_patch</b> ./nope.txt · <muted>+1 -1</muted>",
			"<toolOutput>nope.txt: file not found</toolOutput>",
		]);
	});

	it("preserves cancellation as structured lifecycle state", async () => {
		let tool: any;
		let resultHandler: any;
		registerApplyPatch({
			registerTool: (definition: any) => {
				tool = definition;
			},
			on: (event: string, handler: any) => {
				if (event === "tool_result") resultHandler = handler;
			},
		} as any);
		const controller = new AbortController();
		controller.abort();

		await expect(
			tool.execute(
				"patch-1",
				{ patch: "*** Begin Patch\n*** Add File: file.txt\n+text\n*** End Patch" },
				controller.signal,
				undefined,
				{ cwd: makeCwd() },
			),
		).rejects.toThrow(/aborted/);
		expect(resultHandler({ toolName: "apply_patch", toolCallId: "patch-1", details: undefined })).toEqual({
			details: { trace: { state: "cancelled" } },
		});
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
