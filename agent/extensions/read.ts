/**
 * Two behaviors, one format:
 *
 * - `read` override: reading a SKILL.md returns the opencode `skill` tool's
 *   output (markdown body and a `<skill_files>` listing) with pi's
 *   `<skill name location>` outer tag so the TUI renders it as a skill.
 *   All other files keep the builtin behavior.
 * - `/skill:name` intercept: the same block replaces the builtin expansion,
 *   so both loading paths produce identical output.
 *
 * Parity note: both paths read the SKILL.md fresh from disk, so the block
 * is never truncated by the builtin read tool's offset/limit handling.
 * Remaining deliberate difference: skills outside the three standard skill
 * directories are not found by the lookup and fall through to the builtin
 * `/skill:` expansion, whose block omits the `<skill_files>` listing and
 * emits "References are relative to <dir>" instead.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { TextContent } from "@earendil-works/pi-ai";
import {
  type AgentToolResult,
  createReadToolDefinition,
  type ExtensionAPI,
  getAgentDir,
  loadSkillsFromDir,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { Effect, Option, Ref } from "effect";
import * as Schema from "effect/Schema";

/** Max files in a <skill_files> listing (opencode's ripgrep limit); at this count the listing is flagged as sampled. */
export const SKILL_FILE_LIST_LIMIT = 10;

/** Typed read failures. All call sites treat these as "give up quietly". */
export class ReadError extends Schema.TaggedError<ReadError>()("Read.Error", {
  kind: Schema.Union([Schema.Literal("io")]),
  message: Schema.String,
  path: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
}) {}

/** Error factory for ReadError; call sites give up quietly or fall through. */
export const readError = (
  kind: ReadError["kind"],
  fields: Partial<Omit<ReadError, "_tag" | "kind" | "message">> = {},
): ReadError =>
  new ReadError({ kind, message: `Read failed: ${fields.path ?? "(unknown path)"}`, ...fields });

/** Skill-directory fs capability with fs errors translated to ReadError. */
export interface ReadFileSystemContract {
  readonly readdir: (dir: string) => Effect.Effect<string[], ReadError>;
  readonly stat: (
    absolutePath: string,
  ) => Effect.Effect<{ isFile: boolean; isDirectory: boolean }, ReadError>;
  readonly readText: (absolutePath: string) => Effect.Effect<string, ReadError>;
}

/** Node fs errors carry an errno-style `code`; anything else is treated as absent. */
const ErrnoCode = Schema.Struct({ code: Schema.optional(Schema.String) });

/** Real fs implementation; each operation maps Node rejections to ReadError. */
export function makeReadFileSystem(): ReadFileSystemContract {
  const ioError = (absolutePath: string, err: Error) => {
    const code = Option.getOrUndefined(Schema.decodeUnknownOption(ErrnoCode)(err))?.code;

    return readError(
      "io",
      code === undefined ? { path: absolutePath } : { path: absolutePath, code },
    );
  };

  return {
    readdir: (dir) =>
      Effect.tryPromise({
        try: () => readdir(dir),
        catch: (e) => ioError(dir, e instanceof Error ? e : new Error(String(e))),
      }),
    stat: (absolutePath) =>
      Effect.tryPromise({
        try: () => stat(absolutePath),
        catch: (e) => ioError(absolutePath, e instanceof Error ? e : new Error(String(e))),
      }).pipe(Effect.map((s) => ({ isFile: s.isFile(), isDirectory: s.isDirectory() }))),
    readText: (absolutePath) =>
      Effect.tryPromise({
        try: () => readFile(absolutePath, "utf8"),
        catch: (e) => ioError(absolutePath, e instanceof Error ? e : new Error(String(e))),
      }),
  };
}

/** Enumerate files under the skill directory, skipping unreadable entries. */
export const listSkillFiles = Effect.fn("Read.listSkillFiles")(function* (
  fs: ReadFileSystemContract,
  dir: string,
  limit: number,
): Effect.fn.Return<string[], never> {
  const files = yield* Ref.make<string[]>([]);
  const skipDirs = new Set([".git", "node_modules"]);

  const walk: (current: string) => Effect.Effect<void, never> = (current) =>
    Effect.gen(function* () {
      if ((yield* Ref.get(files)).length >= limit) return;
      const entries = yield* fs.readdir(current).pipe(Effect.catch(() => Effect.succeed([])));

      for (const entry of [...entries].sort()) {
        if ((yield* Ref.get(files)).length >= limit) return;
        const full = path.join(current, entry);
        const info = yield* fs.stat(full).pipe(Effect.option);

        if (Option.isNone(info)) continue;

        if (info.value.isDirectory) {
          if (skipDirs.has(entry)) continue;
          yield* walk(full);
        } else if (info.value.isFile && entry !== "SKILL.md") {
          yield* Ref.update(files, (current) => [...current, full]);
        }
      }
    });

  yield* walk(dir);

  return yield* Ref.get(files);
});

/** Find a skill by name in the standard skill directories; unreadable roots are skipped. */
export const findSkill = Effect.fn("Read.findSkill")(function* (
  name: string,
  roots: string[] = [
    path.join(homedir(), ".agents", "skills"),
    path.join(homedir(), ".claude", "skills"),
    path.join(getAgentDir(), "skills"),
  ],
): Effect.fn.Return<Skill | undefined, never> {
  const loadSkill = (root: string): Skill | undefined => {
    try {
      return loadSkillsFromDir({ dir: root, source: root }).skills.find((s) => s.name === name);
    } catch (error) {
      // Unreadable or corrupt skill root: log and treat as not-found.
      console.warn(`read-override: failed to load skills from ${root}`, error);

      return undefined;
    }
  };

  for (const root of roots) {
    const found = loadSkill(root);

    if (found) return found;
  }

  return undefined;
});

/** Swap a SKILL.md read for the skill block; other files pass through untouched. */
export const toSkillContentBlock = Effect.fn("Read.toSkillContentBlock")(function* <TDetails>(
  fs: ReadFileSystemContract,
  result: AgentToolResult<TDetails>,
  rawPath: string,
  cwd: string,
): Effect.fn.Return<AgentToolResult<TDetails>, never> {
  // Builtin tools strip a leading @ before resolving paths; mirror that here.
  const barePath = rawPath.replace(/^@+/, "");

  if (path.basename(barePath) !== "SKILL.md") return result;

  const location = path.resolve(cwd, barePath);
  const dir = path.dirname(location);

  // Read fresh (the builtin text is offset/limit-truncated), falling back
  // to the result text if the file is gone.
  const fallbackText =
    (result.content ?? []).find((part): part is TextContent => part.type === "text")?.text ?? "";

  const fullText = yield* fs
    .readText(location)
    .pipe(Effect.catch(() => Effect.succeed(fallbackText)));

  const files = yield* listSkillFiles(fs, dir, SKILL_FILE_LIST_LIMIT);
  const block = formatSkillContentBlock(skillName(fullText, dir), location, fullText, files);

  return { ...result, content: [{ type: "text", text: block }] };
});

/** The skill's display name: its YAML `name:` field, else the directory name. */
export function skillName(content: string, dir: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";

  return frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || path.basename(dir);
}

/** Strip the YAML frontmatter and the blank line after it. */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)+/);

  return match ? content.slice(match[0].length) : content;
}

/** The skill block: pi's `<skill name location>` tag (the TUI's contract), the body, and the absolute-path `<skill_files>` listing. */
export function formatSkillContentBlock(
  name: string,
  location: string,
  content: string,
  files: string[],
): string {
  const lines = [`<skill name="${name}" location="${location}">`, stripFrontmatter(content).trim()];

  if (files.length >= SKILL_FILE_LIST_LIMIT) {
    lines.push("", "Note: file list is sampled.");
  }

  lines.push(
    "",
    "<skill_files>",
    ...files.map((file) => `<file>${file}</file>`),
    "</skill_files>",
    "</skill>",
  );

  return lines.join("\n");
}

/**
 * Override the read tool so SKILL.md renders the skill block (with the
 * `<skill_files>` listing), and intercept `/skill:name` input with the same
 * block; all other reads and inputs pass through untouched.
 */
export default function readOverride(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const original = createReadToolDefinition(ctx.cwd);
    pi.registerTool({
      ...original,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        const result = await original.execute(toolCallId, params, signal, onUpdate, executeCtx);
        const fs = makeReadFileSystem();

        return toSkillContentBlock(fs, result, params.path, executeCtx.cwd).pipe(Effect.runPromise);
      },
    });
  });

  // Unknown skills pass through to the builtin expansion.
  pi.on("input", async (event) => {
    if (!event.text.startsWith("/skill:")) return { action: "continue" };
    const spaceIndex = event.text.indexOf(" ");
    const skillName = spaceIndex === -1 ? event.text.slice(7) : event.text.slice(7, spaceIndex);
    const args = spaceIndex === -1 ? "" : event.text.slice(spaceIndex + 1).trim();

    const program = Effect.gen(function* () {
      const skill = yield* findSkill(skillName);

      if (!skill) return undefined;
      const fs = makeReadFileSystem();
      const content = yield* fs.readText(skill.filePath);
      const files = yield* listSkillFiles(fs, skill.baseDir, SKILL_FILE_LIST_LIMIT);

      return formatSkillContentBlock(skill.name, skill.filePath, content, files);
    });

    try {
      const block = await program.pipe(Effect.runPromise);

      if (!block) return { action: "continue" };

      return { action: "transform", text: args ? `${block}\n\n${args}` : block };
    } catch (error) {
      console.warn("read-override: failed to expand skill", error);

      return { action: "continue" };
    }
  });
}
