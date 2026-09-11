/** Renders SKILL.md reads and `/skill:` expansion through one skill-block format. */

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

/** File-list limit; reaching it marks the listing as sampled. */
export const SKILL_FILE_LIST_LIMIT = 10;

/** Filesystem failure while constructing a skill block. */
export class ReadError extends Schema.TaggedError<ReadError>()("Read.Error", {
  kind: Schema.Union([Schema.Literal("io")]),
  message: Schema.String,
  path: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
}) {}

/** Creates a model-facing skill-read failure. */
export const readError = (
  kind: ReadError["kind"],
  fields: Partial<Omit<ReadError, "_tag" | "kind" | "message">> = {},
): ReadError =>
  new ReadError({ kind, message: `Read failed: ${fields.path ?? "(unknown path)"}`, ...fields });

/** Skill-directory filesystem boundary that maps failures to ReadError. */
export interface ReadFileSystemContract {
  readonly readdir: (dir: string) => Effect.Effect<string[], ReadError>;
  readonly stat: (
    absolutePath: string,
  ) => Effect.Effect<{ isFile: boolean; isDirectory: boolean }, ReadError>;
  readonly readText: (absolutePath: string) => Effect.Effect<string, ReadError>;
}

const ErrnoCode = Schema.Struct({ code: Schema.optional(Schema.String) });

/** Creates the Node-backed skill filesystem boundary. */
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

/** Lists readable skill files up to a fixed caller-supplied limit. */
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

/** Finds a named skill in the standard roots, skipping unreadable roots. */
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

/** Converts a SKILL.md result to a complete skill block. */
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

/** Reads a skill name from frontmatter, with the directory name as fallback. */
export function skillName(content: string, dir: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";

  return frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || path.basename(dir);
}

/** Removes YAML frontmatter from skill content. */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)+/);

  return match ? content.slice(match[0].length) : content;
}

/** Formats skill content and its file list for Pi's skill renderer. */
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

/** Registers matching SKILL.md read and `/skill:` expansion behavior. */
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
