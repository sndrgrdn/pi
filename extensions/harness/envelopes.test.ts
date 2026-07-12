import { describe, expect, it } from "vitest";
import { buildEnvelope } from "./envelopes.ts";

describe("subagent result envelopes", () => {
	it("stamps the child session ID around verbatim content", () => {
		expect(buildEnvelope({ kind: "oracle", sessionID: "child-42", content: "Use a <mutex>." }))
			.toBe('<oracle_result sessionID="child-42">\nUse a <mutex>.\n</oracle_result>');
	});

	it("escapes harness-owned XML attributes", () => {
		expect(buildEnvelope({ kind: "finder", sessionID: 'child&"1', content: "Found it", title: 'Files & "tests"' }))
			.toBe('<finder_result title="Files &amp; &quot;tests&quot;" sessionID="child&amp;&quot;1">\nFound it\n</finder_result>');
	});
});
