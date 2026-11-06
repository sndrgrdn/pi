import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  link,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import { parse, stringify } from "yaml";

export const git = promisify(execFile);

const nonempty = Type.String({ pattern: "\\S" });

export const traitSchema = Type.Object(
  {
    name: Type.String({ pattern: "^(?!trait-)[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 80 }),
    subject: nonempty,
    requirement: nonempty,
    purpose: nonempty,
    applicability: Type.Optional(nonempty),
    context: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type Trait = Static<typeof traitSchema>;

const frontmatterValidator = Compile(Type.Omit(traitSchema, ["context"]));

const configurationValidator = Compile(
  Type.Object(
    {
      classifier: Type.Optional(
        Type.Object({ provider: nonempty, id: nonempty }, { additionalProperties: false }),
      ),
      excludes: Type.Optional(Type.Array(nonempty)),
      excludeGitignored: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
);

const gitRootUnavailable = Schema.is(Schema.Struct({ code: Schema.Literal(128) }));

export async function project(cwd: string, signal?: AbortSignal) {
  let stdout: string;

  try {
    ({ stdout } = await git("git", ["rev-parse", "--show-toplevel"], { cwd, signal }));
  } catch (error) {
    if (gitRootUnavailable(error)) return undefined;
    throw error;
  }

  const root = await realpath(stdout.trim());

  let text: string;

  try {
    text = await readFile(join(root, ".pi", "traits.json"), { encoding: "utf8", signal });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }

  const configuration: unknown = JSON.parse(text);

  if (!configurationValidator.Check(configuration)) {
    throw new Error(
      "Invalid .pi/traits.json. Expected optional classifier { provider, id } and excludes.",
    );
  }

  return {
    root,
    directory: join(root, ".agents", "traits"),
    classifier: configuration.classifier ?? { provider: "typesafe", id: "jev-latest" },
    excludeGitignored: configuration.excludeGitignored ?? true,
    excludes: [
      "**/.git",
      "**/.git/**",
      "**/.worktrees",
      "**/.worktrees/**",
      ...(configuration.excludes ?? []).map((pattern) =>
        isAbsolute(pattern) ? relative(root, pattern) : pattern,
      ),
    ],
  };
}

export type Project = NonNullable<Awaited<ReturnType<typeof project>>>;

export const isMissing = Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }));

export function serializeTrait(trait: Trait): string {
  const { context, ...frontmatter } = trait;

  return `---\n${stringify(frontmatter, { blockQuote: "literal" })}---\n${context ?? ""}`;
}

export async function readTraits(project: Project, names?: string[]): Promise<Trait[]> {
  let files: string[];

  try {
    files = await readdir(project.directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
    files = [];
  }

  const traits: Trait[] = [];

  for (const filename of files.filter((file) => file.endsWith(".md")).sort()) {
    const file = join(project.directory, filename);

    if (!(await stat(file)).isFile()) continue;

    const text = await readFile(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);

    if (!match) throw new Error(`Invalid frontmatter in ${filename}.`);

    let trait: Trait;

    try {
      const metadata: unknown = parse(match[1] ?? "");
      trait = frontmatterValidator.Parse(metadata);

      const context = match[2] ?? "";

      if (context !== "") trait.context = context;
    } catch {
      throw new Error(`Invalid trait ${filename}.`);
    }

    if (filename !== `${trait.name}.md`)
      throw new Error(`Trait name does not match filename ${filename}.`);
    traits.push(trait);
  }

  if (names?.some((name) => !traits.some((trait) => trait.name === name))) {
    throw new Error("Unknown trait name. List all traits to find their canonical names.");
  }

  return names ? traits.filter((trait) => names.includes(trait.name)) : traits;
}

export function revision(traits: Trait[]): string {
  return createHash("sha256").update(JSON.stringify(traits)).digest("hex");
}

export async function saveTrait(
  project: Project,
  trait: Trait,
  expectedRevision: string,
  signal?: AbortSignal,
) {
  const document = serializeTrait(trait);

  await mkdir(project.directory, { recursive: true });
  const lock = join(project.directory, ".pi-traits-lock");

  await mkdir(lock);

  const temporary = join(project.directory, `.${randomUUID()}.tmp`);

  try {
    signal?.throwIfAborted();
    const current = await readTraits(project);

    if (revision(current) !== expectedRevision) {
      throw new Error(
        "Traits changed after assessment or approval. Propose again to obtain fresh approval.",
      );
    }

    const destination = join(project.directory, `${trait.name}.md`);
    const existing = current.some((stored) => stored.name === trait.name);
    const mode = existing ? (await stat(destination)).mode : undefined;

    await writeFile(temporary, document, { flag: "wx", mode, signal });
    signal?.throwIfAborted();

    if (existing) await rename(temporary, destination);
    else await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true });
  }
}
