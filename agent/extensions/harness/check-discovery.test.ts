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
});
