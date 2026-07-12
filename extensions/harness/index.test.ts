import { describe, expect, it } from "vitest";
import harness from "./index.ts";

describe("harness extension entry", () => {
	it("exports an extension entry function", () => {
		expect(typeof harness).toBe("function");
	});
});
