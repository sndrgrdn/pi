/**
 * apply_patch applier (spec §4.4 Atomicity/Paths/Errors): full preflight —
 * parse, read every target, match every chunk, compute all new contents —
 * before any write. Sequential writes with rollback from held prior contents;
 * any write failure restores written files and reports the patch wholly
 * failed. Preflight errors are collected, not fail-fast; the envelope parse
 * failure alone is fail-fast. Invariant: patch applied or nothing changed.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { buildDisplayDiff, countChanges } from "./diff.ts";
import { deriveNewContents, type Replacement, splitContentLines } from "./matcher.ts";
import { parsePatch } from "./parser.ts";

/** Injectable filesystem seam (used by tests to force mid-write failures). */
export interface PatchFsOps {
	readFile(absPath: string): Promise<string>;
	writeFile(absPath: string, contents: string): Promise<void>;
	mkdirs(absDir: string): Promise<void>;
	unlink(absPath: string): Promise<void>;
	/** undefined when the path does not exist. */
	stat(absPath: string): Promise<{ isFile: boolean; isDirectory: boolean } | undefined>;
}

export const defaultFsOps: PatchFsOps = {
	readFile: (path) => readFile(path, "utf8"),
	writeFile: (path, contents) => writeFile(path, contents, "utf8"),
	mkdirs: async (dir) => {
		await mkdir(dir, { recursive: true });
	},
	unlink: (path) => rm(path),
	stat: async (path) => {
		try {
			const s = await stat(path);
			return { isFile: s.isFile(), isDirectory: s.isDirectory() };
		} catch {
			return undefined;
		}
	},
};

/** One applied file change, with contents for the TUI's per-file diffs. */
export interface AppliedFile {
	kind: "add" | "update" | "delete";
	/** Display path (patch spelling: cwd-relative or absolute as written). */
	path: string;
	/** Display destination for moves. */
	movePath: string | undefined;
	oldContents: string | undefined;
	newContents: string | undefined;
	/** Display diff in pi's line-numbered format (TUI-only audience). */
	diff: string;
	added: number;
	removed: number;
}

function diffFields(
	originalLines: string[],
	replacements: Replacement[],
): Pick<AppliedFile, "diff" | "added" | "removed"> {
	return { diff: buildDisplayDiff(originalLines, replacements), ...countChanges(replacements) };
}

export interface ApplyPatchResult {
	/** Model-facing summary: `Success. …` + `A/M/D` lines only (spec §4.4 Result). */
	summary: string;
	files: AppliedFile[];
}

/** A fully preflighted write plan step, holding prior contents for rollback. */
type WriteStep =
	| { op: "write"; absPath: string; contents: string; prior: string | undefined; makeParents: boolean }
	| { op: "unlink"; absPath: string; prior: string };

interface PlannedFile {
	file: AppliedFile;
	steps: WriteStep[];
}

const resolvePath = (cwd: string, path: string): string => (isAbsolute(path) ? path : resolve(cwd, path));

/**
 * Apply a Codex-envelope patch atomically against `cwd`.
 * Throws with the collected preflight error catalog, or — after a mid-write
 * failure — with a wholly-failed report (honest caveat if rollback fails).
 */
export async function applyPatch(
	patch: string,
	cwd: string,
	ops: PatchFsOps = defaultFsOps,
): Promise<ApplyPatchResult> {
	const hunks = parsePatch(patch); // parse failure alone is fail-fast
	if (hunks.length === 0) throw new Error("No files were modified.");

	// Preflight: read every target, match every chunk, compute all new
	// contents before any write. Collect every error (spec §4.4 Errors).
	const planned: PlannedFile[] = [];
	const errors: string[] = [];

	for (const hunk of hunks) {
		const absPath = resolvePath(cwd, hunk.path);
		const existing = await ops.stat(absPath);

		switch (hunk.type) {
			case "add": {
				if (existing?.isDirectory) {
					errors.push(`${hunk.path}: is a directory`);
					break;
				}
				const prior = existing ? await ops.readFile(absPath) : undefined;
				planned.push({
					file: {
						kind: "add",
						path: hunk.path,
						movePath: undefined,
						oldContents: prior,
						newContents: hunk.contents,
						...diffFields([], [{ index: 0, oldLen: 0, newLines: splitContentLines(hunk.contents) }]),
					},
					steps: [{ op: "write", absPath, contents: hunk.contents, prior, makeParents: true }],
				});
				break;
			}
			case "delete": {
				if (!existing) {
					errors.push(`${hunk.path}: file not found`);
					break;
				}
				if (existing.isDirectory) {
					errors.push(`${hunk.path}: is a directory`);
					break;
				}
				const prior = await ops.readFile(absPath);
				const priorLines = splitContentLines(prior);
				planned.push({
					file: {
						kind: "delete",
						path: hunk.path,
						movePath: undefined,
						oldContents: prior,
						newContents: undefined,
						...diffFields(priorLines, [{ index: 0, oldLen: priorLines.length, newLines: [] }]),
					},
					steps: [{ op: "unlink", absPath, prior }],
				});
				break;
			}
			case "update": {
				if (!existing) {
					errors.push(`${hunk.path}: file not found`);
					break;
				}
				if (existing.isDirectory) {
					errors.push(`${hunk.path}: is a directory`);
					break;
				}
				const oldContents = await ops.readFile(absPath);
				const {
					newContents,
					errors: matchErrors,
					originalLines,
					replacements,
				} = deriveNewContents(oldContents, hunk.chunks);
				if (matchErrors.length > 0 || newContents === undefined) {
					errors.push(...matchErrors.map((message) => `${hunk.path}: ${message}`));
					break;
				}
				const steps: WriteStep[] =
					hunk.movePath === undefined
						? [{ op: "write", absPath, contents: newContents, prior: oldContents, makeParents: false }]
						: [
								{
									op: "write",
									absPath: resolvePath(cwd, hunk.movePath),
									contents: newContents,
									prior: await priorContentsOf(ops, resolvePath(cwd, hunk.movePath)),
									makeParents: true,
								},
								{ op: "unlink", absPath, prior: oldContents },
							];
				planned.push({
					file: {
						kind: "update",
						path: hunk.path,
						movePath: hunk.movePath,
						oldContents,
						newContents,
						...diffFields(originalLines, replacements),
					},
					steps,
				});
				break;
			}
		}
	}

	if (errors.length > 0) throw new Error(errors.join("\n"));

	// Sequential writes with rollback (spec §4.4 Atomicity).
	const executed: WriteStep[] = [];
	try {
		for (const { steps } of planned) {
			for (const step of steps) {
				if (step.op === "write") {
					if (step.makeParents) await ops.mkdirs(dirname(step.absPath));
					await ops.writeFile(step.absPath, step.contents);
				} else {
					await ops.unlink(step.absPath);
				}
				executed.push(step);
			}
		}
	} catch (writeError) {
		const rollbackFailures = await rollback(ops, executed);
		const why = writeError instanceof Error ? writeError.message : String(writeError);
		if (rollbackFailures.length === 0) {
			throw new Error(`The patch failed and was rolled back — no files were changed. Cause: ${why}`);
		}
		throw new Error(
			`The patch failed: ${why}. Rollback also failed for: ${rollbackFailures.join("; ")}. ` +
				"The working tree may be partially modified.",
		);
	}

	return { summary: buildSummary(cwd, planned), files: planned.map(({ file }) => file) };
}

async function priorContentsOf(ops: PatchFsOps, absPath: string): Promise<string | undefined> {
	const existing = await ops.stat(absPath);
	return existing?.isFile ? await ops.readFile(absPath) : undefined;
}

/** Undo executed steps in reverse order; returns descriptions of failures. */
async function rollback(ops: PatchFsOps, executed: WriteStep[]): Promise<string[]> {
	const failures: string[] = [];
	for (const step of executed.reverse()) {
		try {
			if (step.op === "write") {
				if (step.prior === undefined) await ops.unlink(step.absPath);
				else await ops.writeFile(step.absPath, step.prior);
			} else {
				await ops.writeFile(step.absPath, step.prior);
			}
		} catch (error) {
			failures.push(`${step.absPath} (${error instanceof Error ? error.message : String(error)})`);
		}
	}
	return failures;
}

/** cwd-relative display path; absolute patch paths stay absolute (spec §4.4 Paths). */
export function displayPath(cwd: string, path: string): string {
	if (!isAbsolute(path)) return path;
	const rel = relative(cwd, path);
	return rel.startsWith("..") ? path : rel;
}

function buildSummary(cwd: string, planned: PlannedFile[]): string {
	const lines = ["Success. Updated the following files:"];
	const byKind = (kind: AppliedFile["kind"]): AppliedFile[] =>
		planned.map(({ file }) => file).filter((file) => file.kind === kind);
	for (const file of byKind("add")) lines.push(`A ${displayPath(cwd, file.path)}`);
	for (const file of byKind("update")) {
		lines.push(
			file.movePath === undefined
				? `M ${displayPath(cwd, file.path)}`
				: `M ${displayPath(cwd, file.path)} -> ${displayPath(cwd, file.movePath)}`,
		);
	}
	for (const file of byKind("delete")) lines.push(`D ${displayPath(cwd, file.path)}`);
	return lines.join("\n");
}
