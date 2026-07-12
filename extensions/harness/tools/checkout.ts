import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface CheckoutOperations {
	home: string;
	now(): number;
	findCachedRepositories(root: string, name: string): string[];
	isRepository(path: string): boolean;
	exists(path: string): boolean;
	readTimestamp(path: string): number | undefined;
	clone(remote: string, path: string): void;
	fetch(path: string): void;
	isClean(path: string): boolean;
	fastForward(path: string): void;
	writeTimestamp(path: string, timestamp: number): void;
}

interface RepositoryIdentity { host: string; owner: string; name: string }

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function cachedRepositories(root: string, name: string): string[] {
	if (!existsSync(root)) return [];
	const matches: string[] = [];
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(directory, entry.name);
			if (entry.name === name && existsSync(join(path, ".git"))) matches.push(path);
			else visit(path);
		}
	};
	visit(root);
	return matches;
}

export const nodeCheckoutOperations: CheckoutOperations = {
	home: homedir(),
	now: () => Math.floor(Date.now() / 1_000),
	findCachedRepositories: cachedRepositories,
	isRepository: (path) => {
		try { return resolve(git(["-C", path, "rev-parse", "--show-toplevel"])) === resolve(path); } catch { return false; }
	},
	exists: (path) => existsSync(join(path, ".git")),
	readTimestamp: (path) => {
		try {
			const value = Number(readFileSync(join(path, ".git", "librarian-last-fetch"), "utf8").trim());
			return Number.isFinite(value) ? value : undefined;
		} catch { return undefined; }
	},
	clone: (remote, path) => {
		mkdirSync(dirname(path), { recursive: true });
		execFileSync("git", ["clone", "--filter=blob:none", remote, path], { stdio: "ignore" });
	},
	fetch: (path) => { execFileSync("git", ["-C", path, "fetch", "--prune", "--tags", "origin"], { stdio: "ignore" }); },
	isClean: (path) => git(["-C", path, "status", "--porcelain", "--untracked-files=no"]) === "",
	fastForward: (path) => {
		try { execFileSync("git", ["-C", path, "merge", "--ff-only", "@{u}"], { stdio: "ignore" }); } catch { /* no upstream or non-fast-forward: keep fetched checkout */ }
	},
	writeTimestamp: (path, timestamp) => writeFileSync(join(path, ".git", "librarian-last-fetch"), `${timestamp}\n`),
};

function parseRepository(input: string): RepositoryIdentity | undefined {
	const trimmed = input.trim().replace(/[?#].*$/, "");
	if (!trimmed.includes("/")) return undefined;
	let host = "github.com";
	let path = trimmed;
	const scp = trimmed.match(/^git@([^:]+):(.+)$/);
	if (scp) [, host, path] = scp as [string, string, string];
	else if (/^(?:https?|ssh):\/\//.test(trimmed)) {
		const url = new URL(trimmed);
		host = url.hostname;
		path = url.pathname;
	} else {
		const first = trimmed.split("/")[0] ?? "";
		if (first.includes(".") || first === "localhost") {
			host = first;
			path = trimmed.slice(first.length + 1);
		}
	}
	const parts = path.replace(/^\//, "").replace(/\/$/, "").split("/");
	if (["tree", "blob", "pull", "issues", "commit", "actions", "releases", "compare", "wiki"].includes(parts[2] ?? "")) parts.splice(2);
	const name = (parts.pop() ?? "").replace(/\.git$/, "");
	const owner = parts.join("/");
	if (!host || !owner || !name || [host, owner, name].some((part) => part.includes("..") || part.includes("\\"))) {
		throw new Error(`Unsupported repository format: ${input}`);
	}
	return { host, owner, name };
}

export class CheckoutCache {
	readonly root: string;
	constructor(private readonly operations: CheckoutOperations = nodeCheckoutOperations, root?: string) {
		this.root = root ?? join(operations.home, ".cache", "checkouts");
	}

	async checkout(repo: string): Promise<string> {
		const identity = parseRepository(repo);
		let path: string;
		if (identity) {
			path = join(this.root, identity.host, identity.owner, identity.name);
			const contained = relative(this.root, path);
			if (contained.startsWith(`..${sep}`) || contained === "..") throw new Error("Repository resolves outside the checkout cache");
			if (!this.operations.exists(path)) this.operations.clone(`https://${identity.host}/${identity.owner}/${identity.name}.git`, path);
		} else {
			const name = basename(repo.trim());
			const matches = this.operations.findCachedRepositories(this.root, name).filter((candidate) => this.operations.isRepository(candidate));
			if (matches.length === 0) throw new Error(`No cached repository named "${name}". Specify owner/repo or a full URL.`);
			if (matches.length > 1) throw new Error(`Multiple cached repositories named "${name}". Choose one:\n${matches.join("\n")}`);
			path = matches[0]!;
		}
		const now = this.operations.now();
		const lastFetch = this.operations.readTimestamp(path);
		if (lastFetch === undefined || now - lastFetch >= 300) {
			this.operations.fetch(path);
			this.operations.writeTimestamp(path, now);
			if (this.operations.isClean(path)) this.operations.fastForward(path);
		}
		return path;
	}
}

export function createCheckoutTool(cache = new CheckoutCache()): ToolDefinition<any, any, any> {
	return {
		name: "checkout",
		label: "checkout",
		description: "Resolve, clone, or refresh a remote repository in the shared Checkout Cache. Never edit the returned path.",
		parameters: Type.Object({ repo: Type.String({ description: "Repository URL, git SSH reference, owner/repo, or cached bare name." }) }),
		async execute(_id, params: { repo: string }) {
			const path = await cache.checkout(params.repo);
			return { content: [{ type: "text", text: path }], details: { path } };
		},
	} as ToolDefinition<any, any, any>;
}
