import { homedir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	createTraceRenderer,
	createTraceToolRegistrar,
	formatTracePath,
	sanitizeTraceEvidence,
	shellTraceInvocation,
} from "./trace.ts";

const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => `<b>${value}</b>`,
} as any;

function lines(component: { render(width: number): string[] }): string[] {
	return component.render(200).map((line) => line.trimEnd());
}

describe("Trace renderer", () => {
	const renderer = createTraceRenderer<{ command: string; workdir?: string }>({
		invocation: shellTraceInvocation,
	});

	it("keeps the call component empty so the lifecycle result owns the Trace row", () => {
		const component = renderer.renderCall({ command: "echo ok" }, theme, { lastComponent: undefined });
		expect(lines(component)).toEqual([]);
	});

	it.each([
		[{ isPartial: true, isError: false, details: undefined }, "<accent>◐</accent> <b>$</b> echo ok"],
		[{ isPartial: false, isError: false, details: undefined }, "<success>✓</success> <b>$</b> echo ok"],
		[{ isPartial: false, isError: true, details: undefined }, "<error>✗</error> <b>$</b> echo ok"],
		[
			{ isPartial: false, isError: false, details: { trace: { state: "cancelled" } } },
			"<warning>■</warning> <b>$</b> echo ok",
		],
	])("renders mechanical state without coloring the row", (state, expected) => {
		const component = renderer.renderResult(
			{ content: [{ type: "text", text: "ignored output" }], details: state.details },
			{ expanded: false, isPartial: state.isPartial },
			theme,
			{ args: { command: "echo ok" }, cwd: "/work", isError: state.isError },
		);
		expect(lines(component)).toEqual([` ${expected}`]);
	});

	it("keeps output hidden until expanded", () => {
		const collapsed = renderer.renderResult(
			{ content: [{ type: "text", text: "first\nsecond" }] },
			{ expanded: false, isPartial: false },
			theme,
			{ args: { command: "printf output" }, cwd: "/work", isError: false },
		);
		expect(lines(collapsed)).toEqual([" <success>✓</success> <b>$</b> printf output"]);

		const expanded = renderer.renderResult(
			{ content: [{ type: "text", text: "first\nsecond" }] },
			{ expanded: true, isPartial: false },
			theme,
			{ args: { command: "printf output" }, cwd: "/work", isError: false },
		);
		expect(lines(expanded)).toEqual([
			" <success>✓</success> <b>$</b> printf output",
			" <toolOutput>first</toolOutput>",
			" <toolOutput>second</toolOutput>",
		]);
	});

	it("preserves a multiline command and shows a material workdir", () => {
		const invocation = shellTraceInvocation(
			{ command: "\n  echo first\necho second", workdir: "/work/app" },
			"/work",
		);
		expect(invocation).toEqual({ action: "$", target: "echo first\necho second", qualifiers: ["in ./app"] });
	});

	it("ends a truncated single-line row with an ellipsis", () => {
		const plainTheme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const component = renderer.renderResult(
			{ content: [{ type: "text", text: "hidden" }] },
			{ expanded: false, isPartial: false },
			plainTheme,
			{ args: { command: "echo a very long command" }, cwd: "/work", isError: false },
		);
		const rendered = component.render(12);
		expect(rendered).toHaveLength(1);
		expect(visibleWidth(rendered[0]!)).toBe(12);
		expect(stripVTControlCharacters(rendered[0]!)).toBe(" ✓ $ echo … ");
	});

	it("adds mechanical result qualifiers", () => {
		const component = renderer.renderResult(
			{
				content: [{ type: "text", text: "hidden" }],
				details: { trace: { state: "success", qualifiers: ["shell-3", "backgrounded"] } },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ args: { command: "sleep 10" }, cwd: "/work", isError: false },
		);
		expect(lines(component)).toEqual([
			" <success>✓</success> <b>$</b> sleep 10 · <muted>shell-3</muted> · <muted>backgrounded</muted>",
		]);
	});

	it("sanitizes terminal controls before rendering expanded evidence", () => {
		expect(sanitizeTraceEvidence("safe\u0000\u001b]52;c;secret\u0007\u001b[31mred\u001b[0m\r\nnext")).toBe(
			"safered\nnext",
		);
	});

	it("owns thrown cancellation recording and result rewriting for every registered tool", async () => {
		let registered: any;
		let resultHandler: ((event: any) => unknown) | undefined;
		const registrar = createTraceToolRegistrar(
			{
				registerTool: (tool: any) => {
					registered = tool;
				},
				on: (event: string, handler: (event: any) => unknown) => {
					if (event === "tool_result") resultHandler = handler;
				},
			} as any,
			(_error, signal) => signal?.aborted === true,
		);
		registrar.register({
			name: "read",
			execute: async () => {
				throw new Error("aborted");
			},
		} as any);
		const controller = new AbortController();
		controller.abort();

		await expect(registered.execute("call-1", {}, controller.signal)).rejects.toThrow("aborted");
		expect(resultHandler?.({ toolName: "read", toolCallId: "call-1", details: { file: true } })).toEqual({
			details: { file: true, trace: { state: "cancelled" } },
		});
	});
});

describe("formatTracePath", () => {
	it("uses cwd-relative, home-relative, and external absolute paths", () => {
		expect(formatTracePath("/work/app/file.ts", "/work/app", "/Users/test")).toBe("./file.ts");
		expect(formatTracePath(join(homedir(), "notes/file.txt"), "/work/app", homedir())).toBe("~/notes/file.txt");
		expect(formatTracePath("/opt/shared/file.txt", "/work/app", "/Users/test")).toBe("/opt/shared/file.txt");
	});
});
