import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverChecks } from "./check-discovery.ts";

async function check(root: string, directory: string, filename: string, content: string) {
	const checks = join(root, directory, ".agents", "checks");
	await mkdir(checks, { recursive: true });
	await writeFile(join(checks, filename), content);
}

describe("discoverChecks", () => {
	it("parses frontmatter and applies filename and metadata fallbacks", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-"));
		await check(root, "repo", "security.md", "Review authentication boundaries.\n");
		await check(
			root,
			"repo",
			"errors.md",
			"---\nname: error-handling\ndescription: Find swallowed errors\nseverity-default: high\n---\nInspect changed error paths.\n",
		);
		await check(root, "repo", "empty.md", "");
		await check(root, "repo", "metadata-only.md", "---\nname: metadata-only\n---\n   \n");
		await check(root, "repo", "ignored.txt", "not a check");
		await mkdir(join(root, "repo", ".agents", "checks", "nested"));
		await writeFile(join(root, "repo", ".agents", "checks", "nested", "nested.md"), "ignored");

		const checks = await discoverChecks({
			cwd: join(root, "repo"),
			globalRoots: [],
		});

		expect(checks).toEqual([
			{
				name: "error-handling",
				description: "Find swallowed errors",
				severityDefault: "high",
				body: "Inspect changed error paths.",
				path: join(root, "repo", ".agents", "checks", "errors.md"),
			},
			{
				name: "security",
				description: undefined,
				severityDefault: "medium",
				body: "Review authentication boundaries.",
				path: join(root, "repo", ".agents", "checks", "security.md"),
			},
		]);
	});

	it("normalizes metadata and uses locale-independent file ordering for collisions", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-"));
		await check(root, "repo", "a.md", "---\nname: ' duplicate '\n---\nlowercase file");
		await check(
			root,
			"repo",
			"B.md",
			"---\nname: duplicate\ndescription: '  padded description  '\nseverity-default: ' high '\n---\nuppercase file",
		);

		const checks = await discoverChecks({ cwd: join(root, "repo"), globalRoots: [] });

		expect(checks).toMatchObject([
			{
				name: "duplicate",
				description: "padded description",
				severityDefault: "high",
				body: "uppercase file",
			},
		]);
	});

	it("walks nearest ancestors before injected global roots and keeps the first name", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-"));
		const repo = join(root, "repo");
		const cwd = join(repo, "packages", "app");
		await mkdir(cwd, { recursive: true });
		await check(root, "repo", "shared.md", "root shared");
		await check(root, "repo/packages", "parent.md", "parent");
		await check(root, "repo/packages/app", "shared.md", "nearest shared");
		const piGlobal = join(root, "pi-global");
		const agentsGlobal = join(root, "agents-global");
		await mkdir(piGlobal, { recursive: true });
		await mkdir(agentsGlobal, { recursive: true });
		await writeFile(join(piGlobal, "global.md"), "pi global");
		await writeFile(join(agentsGlobal, "global.md"), "agents global");
		await writeFile(join(agentsGlobal, "agents-only.md"), "agents only");

		const checks = await discoverChecks({ cwd, globalRoots: [piGlobal, agentsGlobal] });

		expect(checks.map(({ name, body }) => [name, body])).toEqual([
			["shared", "nearest shared"],
			["parent", "parent"],
			["global", "pi global"],
			["agents-only", "agents only"],
		]);
	});

	it("rejects a malformed severity-default loudly, naming the file", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-severity-"));
		await check(root, "repo", "banana.md", "---\nseverity-default: banana\n---\nInstructions.");
		await expect(discoverChecks({ cwd: join(root, "repo"), globalRoots: [] })).rejects.toThrow(
			/banana\.md.*severity-default "banana" must be one of critical\|high\|medium\|low/,
		);
	});

	it("rejects malformed and non-object frontmatter loudly, naming the file", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-frontmatter-"));
		await check(root, "repo", "malformed.md", "---\nseverity-default: [high\n---\nInstructions.");
		await expect(discoverChecks({ cwd: join(root, "repo"), globalRoots: [] })).rejects.toThrow(
			/malformed\.md.*invalid YAML frontmatter/,
		);
		const otherRoot = await mkdtemp(join(tmpdir(), "pi-checks-frontmatter-"));
		await check(otherRoot, "repo", "scalar.md", "---\nhigh\n---\nInstructions.");
		await expect(discoverChecks({ cwd: join(otherRoot, "repo"), globalRoots: [] })).rejects.toThrow(
			/scalar\.md.*frontmatter must be a YAML object/,
		);
	});

	it("parses a valid severity-default and defaults to medium", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-severity-ok-"));
		await check(root, "repo", "strict.md", "---\nseverity-default: critical\n---\nInstructions.");
		await check(root, "repo", "plain.md", "Instructions.");
		const checks = await discoverChecks({ cwd: join(root, "repo"), globalRoots: [] });
		expect(checks.map(({ name, severityDefault }) => [name, severityDefault])).toEqual([
			["plain", "medium"],
			["strict", "critical"],
		]);
	});

	it("normalizes globs from a string or list and leaves unscoped Checks undefined", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-globs-"));
		await check(root, "repo", "single.md", "---\nglobs: app/workers/**\n---\nInstructions.");
		await check(root, "repo", "multiple.md", "---\nglobs:\n  - app/jobs/**\n  - lib/**/*.ts\n---\nInstructions.");
		await check(root, "repo", "unscoped.md", "Instructions.");

		const checks = await discoverChecks({ cwd: join(root, "repo"), globalRoots: [] });
		expect(checks.map(({ name, globs }) => [name, globs])).toEqual([
			["multiple", ["app/jobs/**", "lib/**/*.ts"]],
			["single", ["app/workers/**"]],
			["unscoped", undefined],
		]);
	});

	it("rejects malformed globs loudly, naming the file", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-checks-globs-invalid-"));
		await check(root, "repo", "invalid.md", "---\nglobs: 42\n---\nInstructions.");
		await expect(discoverChecks({ cwd: join(root, "repo"), globalRoots: [] })).rejects.toThrow(
			/invalid\.md.*globs 42 must be a string or list of strings/,
		);
	});
});
