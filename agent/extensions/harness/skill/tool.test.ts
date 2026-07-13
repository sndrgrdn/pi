import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillEntry } from "./core.ts";
import { createSkillTool } from "./index.ts";

const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => `<b>${value}</b>`,
} as any;

function renderedLines(component: { render(width: number): string[] }): string[] {
	return component.render(200).map((line) => line.trimEnd());
}

function skillEntry(): SkillEntry {
	const baseDir = mkdtempSync(join(tmpdir(), "skill-trace-"));
	const filePath = join(baseDir, "SKILL.md");
	mkdirSync(join(baseDir, "references"));
	writeFileSync(filePath, "---\nname: tdd\n---\n\nTest instructions.");
	writeFileSync(join(baseDir, "references", "guide.md"), "Guide");
	return { name: "tdd", description: "Test first", filePath, baseDir };
}

describe("skill Trace View renderer", () => {
	it("renders one compact successful row and preserves content and resources behind expansion", async () => {
		const skill = skillEntry();
		const tool = createSkillTool(new Map([[skill.name, skill]]));
		const updates: any[] = [];
		const result = await tool.execute("skill-1", { name: "tdd" }, undefined, (update: any) => updates.push(update), {
			cwd: "/work",
		} as any);
		const context = { args: { name: "tdd" }, cwd: "/work", isError: false } as any;

		expect(updates[0]?.details).toEqual({ trace: { state: "running" } });
		expect(result.details).toMatchObject({
			title: "Loaded skill: tdd",
			skill: "tdd",
			trace: { state: "success" },
		});
		expect(renderedLines(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context))).toEqual([
			"<success>✓</success> <b>skill</b> tdd",
		]);
		const expanded = renderedLines(
			tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context),
		).join("\n");
		expect(expanded).toContain("<toolOutput>Test instructions.</toolOutput>");
		expect(expanded).toContain("<toolOutput>  <file>references/guide.md</file></toolOutput>");
		expect(expanded).toContain(`<toolOutput>Skill directory: ${skill.baseDir}</toolOutput>`);
	});

	it("renders an unknown skill as one failed row with expandable recovery evidence", () => {
		const tool = createSkillTool(new Map());
		const result = {
			content: [{ type: "text", text: 'Unknown skill "missing".\n<available_skills>(none)</available_skills>' }],
		} as any;
		const context = { args: { name: "missing" }, cwd: "/work", isError: true } as any;

		expect(renderedLines(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context))).toEqual([
			"<error>✗</error> <b>skill</b> missing",
		]);
		expect(renderedLines(tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context))).toEqual([
			"<error>✗</error> <b>skill</b> missing",
			'<toolOutput>Unknown skill "missing".</toolOutput>',
			"<toolOutput><available_skills>(none)</available_skills></toolOutput>",
		]);
	});

	it("keeps unknown-skill model errors unchanged", async () => {
		const tool = createSkillTool(new Map());
		await expect(
			tool.execute("skill-1", { name: "missing" }, undefined, undefined, { cwd: "/work" } as any),
		).rejects.toThrow('Unknown skill "missing".\n<available_skills>(none)</available_skills>');
	});
});
