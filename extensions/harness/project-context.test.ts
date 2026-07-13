import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectContextPrompt } from "./project-context.ts";

describe("project context prompt", () => {
	it("uses pi context discovery including uppercase filenames and absolute source paths", () => {
		const root = mkdtempSync(join(tmpdir(), "task-context-"));
		const child = join(root, "child");
		mkdirSync(child);
		const path = join(root, "AGENTS.MD");
		writeFileSync(path, "Project instructions");

		const prompt = projectContextPrompt(child);
		expect(prompt).toContain("Project instructions");
		expect(prompt).toMatch(/<project_instructions path="[^"]+\/AGENTS\.(?:md|MD)">/);
	});
});
