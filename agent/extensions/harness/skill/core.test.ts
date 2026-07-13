import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	availableSkillsBlock,
	buildDirective,
	buildSkillRefPattern,
	extractSkillRefs,
	listSkillFiles,
	rankSkillNames,
	stripFrontmatter,
} from "./core.ts";

// ── Trigger matcher ───────────────────────────────────────────────

describe("skill trigger matcher", () => {
	const names = ["tdd", "tdd-review", "deslop"];

	it("matches $name and /name anywhere in a prompt", () => {
		expect(extractSkillRefs("use $tdd here", names)).toEqual(["tdd"]);
		expect(extractSkillRefs("use /tdd here", names)).toEqual(["tdd"]);
		expect(extractSkillRefs("please $deslop the diff", names)).toEqual(["deslop"]);
	});

	it("matches longest name first", () => {
		expect(extractSkillRefs("run $tdd-review now", names)).toEqual(["tdd-review"]);
		expect(extractSkillRefs("run /tdd-review now", names)).toEqual(["tdd-review"]);
	});

	it("collects multiple distinct refs, deduplicated", () => {
		expect(extractSkillRefs("$tdd then /deslop then $tdd again", names)).toEqual([
			"tdd",
			"deslop",
		]);
	});

	it("guards against path fragments", () => {
		// path prefix before the trigger
		expect(extractSkillRefs("see skills/tdd for info", names)).toEqual([]);
		// path continues after the name
		expect(extractSkillRefs("open /tdd/refs.md", names)).toEqual([]);
		// file extension after the name
		expect(extractSkillRefs("open /tdd.md", names)).toEqual([]);
	});

	it("still matches at sentence-end punctuation", () => {
		expect(extractSkillRefs("use /tdd.", names)).toEqual(["tdd"]);
		expect(extractSkillRefs("(use $tdd)", names)).toEqual(["tdd"]);
	});

	it("matches at line start across multiline prompts", () => {
		expect(extractSkillRefs("first line\n$tdd second", names)).toEqual(["tdd"]);
	});

	it("does not match inside words", () => {
		expect(extractSkillRefs("cost$tdd", names)).toEqual([]);
	});

	it("returns null pattern for empty name set", () => {
		expect(buildSkillRefPattern([])).toBeNull();
		expect(extractSkillRefs("$tdd", [])).toEqual([]);
	});

	it("escapes regex metacharacters in names", () => {
		expect(extractSkillRefs("use $c.d now", ["c.d"])).toEqual(["c.d"]);
		expect(extractSkillRefs("use $cxd now", ["c.d"])).toEqual([]);
	});
});

// ── Directive construction ────────────────────────────────────────

describe("buildDirective", () => {
	it("wraps names in the compressed skill_directive envelope", () => {
		expect(buildDirective(["tdd", "deslop"])).toBe(
			[
				"<skill_directive>",
				"The user invoked these skills. Before anything else, call the skill tool once per name below, then follow the returned instructions.",
				"<skill>tdd</skill>",
				"<skill>deslop</skill>",
				"</skill_directive>",
			].join("\n"),
		);
	});
});

// ── Miss-path ranking ─────────────────────────────────────────────

describe("rankSkillNames", () => {
	const names = ["deslop", "tdd", "tdd-review", "humanizer"];

	it("puts fuzzy matches first, best first", () => {
		const ranked = rankSkillNames(names, "tddreview");
		expect(ranked[0]).toBe("tdd-review");
	});

	it("is untruncated: every name appears exactly once", () => {
		const ranked = rankSkillNames(names, "tdd");
		expect([...ranked].sort()).toEqual([...names].sort());
	});

	it("returns names in original order when query matches nothing", () => {
		expect(rankSkillNames(names, "zzzz")).toEqual(names);
	});
});

describe("availableSkillsBlock", () => {
	it("lists all names, fuzzy-ranked by the attempted name", () => {
		const block = availableSkillsBlock(["deslop", "tdd"], "tdd");
		expect(block).toBe(
			[
				"<available_skills>",
				"  <skill>tdd</skill>",
				"  <skill>deslop</skill>",
				"</available_skills>",
			].join("\n"),
		);
	});

	it("handles the empty corpus", () => {
		expect(availableSkillsBlock([], "x")).toBe(
			"<available_skills>(none)</available_skills>",
		);
	});
});

// ── Resources listing ─────────────────────────────────────────────

describe("listSkillFiles", () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function setup(paths: string[]): string {
		dir = mkdtempSync(join(tmpdir(), "skill-core-"));
		for (const p of paths) {
			const full = join(dir, p);
			mkdirSync(join(full, ".."), { recursive: true });
			writeFileSync(full, "x");
		}
		return dir;
	}

	it("lists files relative to the base dir, excluding SKILL.md", () => {
		setup(["SKILL.md", "refs.md", "sub/notes.md"]);
		const { files, truncated } = listSkillFiles(dir);
		expect(files.sort()).toEqual(["refs.md", "sub/notes.md"]);
		expect(truncated).toBe(false);
	});

	it("skips dotfiles, node_modules and __pycache__", () => {
		setup([
			".hidden",
			"node_modules/pkg/index.js",
			"__pycache__/mod.pyc",
			"kept.md",
		]);
		expect(listSkillFiles(dir).files).toEqual(["kept.md"]);
	});

	it("caps at 20 files and flags truncation", () => {
		setup(Array.from({ length: 25 }, (_, i) => `f${String(i).padStart(2, "0")}.md`));
		const { files, truncated } = listSkillFiles(dir);
		expect(files).toHaveLength(20);
		expect(truncated).toBe(true);
	});
});

// ── Frontmatter ───────────────────────────────────────────────────

describe("stripFrontmatter", () => {
	it("strips a leading frontmatter block", () => {
		expect(stripFrontmatter("---\nname: x\n---\n\nBody")).toBe("Body");
	});

	it("leaves content without frontmatter alone", () => {
		expect(stripFrontmatter("Body")).toBe("Body");
	});

	it("leaves unterminated frontmatter alone", () => {
		expect(stripFrontmatter("---\nname: x")).toBe("---\nname: x");
	});
});
