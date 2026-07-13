import { describe, expect, it } from "vitest";
import { buildEnvelope, parseEnvelope } from "./envelopes.ts";

describe("subagent result envelopes", () => {
	it("stamps the child session ID around verbatim content", () => {
		expect(buildEnvelope({ kind: "oracle", sessionID: "child-42", content: "Use a <mutex>." })).toBe(
			'<oracle_result sessionID="child-42">\nUse a <mutex>.\n</oracle_result>',
		);
	});

	it("stamps error envelopes with the failing agent's tag", () => {
		expect(buildEnvelope({ kind: "error", agent: "task", sessionID: "child-1", content: "Cancelled." })).toBe(
			'<task_error sessionID="child-1">\nCancelled.\n</task_error>',
		);
		expect(parseEnvelope('<oracle_error sessionID="child-2">\nFailed.\n</oracle_error>')).toEqual({
			tag: "oracle_error",
			sessionID: "child-2",
			content: "Failed.",
		});
	});

	it("escapes harness-owned XML attributes", () => {
		expect(
			buildEnvelope({ kind: "finder", sessionID: 'child&"1', content: "Found it", title: 'Files & "tests"' }),
		).toBe(
			'<finder_result title="Files &amp; &quot;tests&quot;" sessionID="child&amp;&quot;1">\nFound it\n</finder_result>',
		);
	});

	it("parses harness-owned attributes and verbatim content", () => {
		expect(
			parseEnvelope(
				'<finder_result title="Auth &amp; sessions" sessionID="child-1">\n/abs/auth.ts:2\n</finder_result>',
			),
		).toEqual({ tag: "finder_result", title: "Auth & sessions", sessionID: "child-1", content: "/abs/auth.ts:2" });
	});

	it("preserves meaningful whitespace inside the harness framing", () => {
		const envelope = buildEnvelope({ kind: "oracle", sessionID: "child-1", content: "  indented\ntrailing  " });
		expect(parseEnvelope(envelope)?.content).toBe("  indented\ntrailing  ");
	});

	it("rejects unknown tags and illegal title combinations", () => {
		expect(parseEnvelope('<unknown_result sessionID="one">\nx\n</unknown_result>')).toBeUndefined();
		expect(parseEnvelope('<finder_result sessionID="one">\nx\n</finder_result>')).toBeUndefined();
		expect(parseEnvelope('<oracle_result title="Nope" sessionID="one">\nx\n</oracle_result>')).toBeUndefined();
	});
});
