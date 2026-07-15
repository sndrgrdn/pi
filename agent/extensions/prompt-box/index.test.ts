import { describe, expect, it } from "vitest";
import { harnessModeColor } from "./index.ts";

describe("harnessModeColor", () => {
	it("uses the corresponding thinking color for each Mode", () => {
		expect(harnessModeColor("low")).toBe("thinkingLow");
		expect(harnessModeColor("medium")).toBe("thinkingMedium");
		expect(harnessModeColor("high")).toBe("thinkingHigh");
		expect(harnessModeColor("ultra")).toBe("thinkingXhigh");
	});
});
