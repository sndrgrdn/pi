import { describe, expect, it } from "vitest";
import { createSubagentRenderer } from "./subagent.ts";

const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => `<b>${value}</b>`,
} as any;

function lines(component: { render(width: number): string[] }): string[] {
	return component.render(200).map((line) => line.trimEnd());
}

describe("delegation Trace View renderer", () => {
	const renderer = createSubagentRenderer<{ query: string }>({
		action: "finder",
		target: (args) => args.query,
	});
	const context = { args: { query: "find auth" }, cwd: "/repo", isError: false } as any;

	it("keeps invocation identity while ordered action tallies appear only during running", () => {
		const running = renderer.renderResult(
			{
				content: [{ type: "text", text: "model-facing progress" }],
				details: { trace: { state: "running" }, actions: { grep: 2, read: 1 } },
			},
			{ expanded: false, isPartial: true },
			theme,
			context,
		);
		expect(lines(running)).toEqual(["<accent>◐</accent> <b>finder</b> find auth · <muted>grep ×2, read ×1</muted>"]);

		const completed = renderer.renderResult(
			{
				content: [
					{
						type: "text",
						text: '<finder_result title="Child title" sessionID="one">\n/abs/auth.ts:2\n</finder_result>',
					},
				],
				details: { trace: { state: "success" }, actions: { grep: 2, read: 1 } },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...context, lastComponent: running },
		);
		expect(completed).toBe(running);
		expect(lines(completed)).toEqual(["<success>✓</success> <b>finder</b> find auth"]);
	});

	it("shows wrapper-free child content only when expanded", () => {
		const result = {
			content: [
				{ type: "text", text: '<finder_result title="Auth" sessionID="one">\n/abs/auth.ts:2\n</finder_result>' },
			],
			details: { trace: { state: "success" } },
		};
		expect(lines(renderer.renderResult(result, { expanded: true, isPartial: false }, theme, context))).toEqual([
			"<success>✓</success> <b>finder</b> find auth",
			"<toolOutput>/abs/auth.ts:2</toolOutput>",
		]);
	});

	it.each([
		[{ trace: { state: "failed" } }, "<error>✗</error> <b>finder</b> find auth"],
		[{ trace: { state: "cancelled" } }, "<warning>■</warning> <b>finder</b> find auth"],
	])("uses explicit mechanical terminal state", (details, expected) => {
		const component = renderer.renderResult(
			{ content: [{ type: "text", text: "child prose says success" }], details },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);
		expect(lines(component)).toEqual([expected]);
	});

	it("keeps parallel invocations in separate rows", () => {
		const first = renderer.renderResult(
			{ content: [{ type: "text", text: "" }], details: { trace: { state: "running" } } },
			{ expanded: false, isPartial: true },
			theme,
			{ ...context, args: { query: "first query" } },
		);
		const second = renderer.renderResult(
			{ content: [{ type: "text", text: "" }], details: { trace: { state: "running" } } },
			{ expanded: false, isPartial: true },
			theme,
			{ ...context, args: { query: "second query" } },
		);

		expect(second).not.toBe(first);
		expect(lines(first)).toEqual(["<accent>◐</accent> <b>finder</b> first query"]);
		expect(lines(second)).toEqual(["<accent>◐</accent> <b>finder</b> second query"]);
	});
});
