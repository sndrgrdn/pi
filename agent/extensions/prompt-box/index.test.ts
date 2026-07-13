import { describe, expect, it } from "vitest";
import { selectTopRightParts } from "./index.ts";

describe("prompt-box top-right content", () => {
	it("shows only the named Mode when one is active", () => {
		expect(selectTopRightParts(["GPT-5.6 Sol", "med"], "medium")).toEqual(["medium"]);
	});

	it("keeps the existing model and thinking content for a null Mode", () => {
		expect(selectTopRightParts(["GPT-5.6 Sol", "med"], null)).toEqual(["GPT-5.6 Sol", "med"]);
	});
});
