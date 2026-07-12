import { describe, expect, it } from "vitest";
import { renderSubagentRow } from "./subagent.ts";

describe("shared subagent row", () => {
	it("renders spinner, running label, and detail on one row", () => {
		expect(renderSubagentRow({ state: "running", label: "Oracle exploring", detail: "check races" }))
			.toEqual(["◐ Oracle exploring — check races"]);
	});

	it("reveals the transcript only when expanded", () => {
		const completed = { state: "complete" as const, label: "Oracle has spoken", detail: "check races", transcript: "read a.ts\nfound mutex" };
		expect(renderSubagentRow(completed, false)).toEqual(["✓ Oracle has spoken — check races"]);
		expect(renderSubagentRow(completed, true)).toEqual([
			"✓ Oracle has spoken — check races",
			"  read a.ts",
			"  found mutex",
		]);
	});
});
