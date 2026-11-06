import { createHash } from "node:crypto";
import type { ClassifierContext } from "@earendil-works/pi-ai";
import { glob, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Data } from "effect";
import { complianceQuestion, type Decisions } from "./decisions.ts";
import { git, type Project, type Trait } from "./store.ts";

type SourceLocation = Data.TaggedEnum<{ File: { path: string; startLine: number } }>;

const SourceLocation = Data.taggedEnum<SourceLocation>();

function traitIgnores(text: string) {
  const names = new Set<string>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#!")) continue;

    const comment = /^(?:\/\/(.*)|<!--(.*)-->)$/s.exec(trimmed);

    if (!comment) break;

    const directive = /^traits-ignore-file\s+([^\s:]+)\s*:\s*\S/.exec(
      (comment[1] ?? comment[2] ?? "").trim(),
    );

    if (directive?.[1]) names.add(directive[1]);
  }

  return names;
}

export async function checkTraits(
  project: Project,
  traits: Trait[],
  include: string[],
  decisions: Decisions,
  cwd: string,
  circumstances?: string,
  signal?: AbortSignal,
) {
  let includedFiles: Set<string> | undefined;

  if (project.excludeGitignored) {
    const { stdout } = await git(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "--full-name", "-z"],
      { cwd: project.root, signal, maxBuffer: Infinity },
    );

    includedFiles = new Set(
      stdout
        .split("\0")
        .filter(Boolean)
        .map((file) => resolve(project.root, file)),
    );
  }

  const paths = new Set<string>();

  for (const pattern of include) {
    for await (const file of glob(isAbsolute(pattern) ? pattern : join(cwd, pattern), {
      cwd: project.root,
      exclude: project.excludes,
    })) {
      const path = resolve(project.root, file);

      if (!includedFiles || includedFiles.has(path)) paths.add(path);
    }
  }

  const files = [];

  for (const path of [...paths].sort()) {
    signal?.throwIfAborted();

    if (!(await stat(path)).isFile()) continue;

    const text = await readFile(path, { encoding: "utf8", signal });
    const ignored = traitIgnores(text);
    const activeTraits = traits.filter((trait) => !ignored.has(trait.name));

    const questions = Object.fromEntries(
      activeTraits.map((trait) => [trait.name, complianceQuestion(trait)]),
    );

    const lines = text.split("\n");
    const chunks = [];

    for (let index = 0; index < lines.length && activeTraits.length; index += 200) {
      const excerpt = lines.slice(index, index + 200).join("\n");

      const state: ClassifierContext["state"] = {
        source: { text: excerpt, location: SourceLocation.File({ path, startLine: index + 1 }) },
      };

      if (circumstances !== undefined) state.circumstances = circumstances;

      const answers = await decisions.assess(state, questions);

      const findings = Object.entries(answers)
        .filter(
          ([, answer]) =>
            answer.classification === "violation" || answer.classification === "inconclusive",
        )
        .map(([traitName, assessment]) => ({ traitName, assessment }));

      if (findings.length) chunks.push({ startLine: index + 1, text: excerpt, findings });
    }

    if (chunks.length) {
      files.push({
        path,
        revision: `sha256:${createHash("sha256").update(text).digest("hex")}`,
        chunks,
      });
    }
  }

  const referenced = new Set(
    files.flatMap((file) =>
      file.chunks.flatMap((chunk) => chunk.findings.map((finding) => finding.traitName)),
    ),
  );

  return { traits: traits.filter((trait) => referenced.has(trait.name)), files };
}
