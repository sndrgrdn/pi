/** Loads an installed skill through a dedicated tool using the read override's skill format. */

import path from "node:path";
import {
  type AgentToolResult,
  type ExtensionAPI,
  formatSkillsForPrompt,
  type Skill,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Effect } from "effect";
import { Type } from "typebox";
import { readSkillContentBlock } from "./read.ts";
import { emptyToolResult, toolErrorResult, toolPreview } from "./utils/tool-render.ts";

const parameters = Type.Object({
  name: Type.String({ description: "Exact name of the installed skill to load" }),
});

interface SkillEntry {
  readonly name: string;
  readonly filePath: string;
  readonly baseDir: string;
}

interface LoadedSkillDetails {
  readonly status: "loaded";
  readonly skillName: string;
  readonly filePath: string;
}

interface SkillNotFoundDetails {
  readonly status: "not-found";
  readonly requestedName: string;
}

interface SkillReadFailedDetails {
  readonly status: "read-failed";
  readonly skillName: string;
  readonly filePath: string;
}

type SkillToolDetails = LoadedSkillDetails | SkillNotFoundDetails | SkillReadFailedDetails;

function skillEntry(skill: Skill): SkillEntry {
  return {
    name: skill.name,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function skillToolCatalog(skills: readonly Skill[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);

  if (visibleSkills.length === 0) return "";

  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "When a task matches a skill's description, call the skill tool with its exact name before proceeding.",
    "",
    "<available_skills>",
  ];

  for (const skill of visibleSkills) {
    lines.push(
      "  <skill>",
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      "  </skill>",
    );
  }

  lines.push("</available_skills>");

  return lines.join("\n");
}

export function replaceSkillCatalog(systemPrompt: string, skills: readonly Skill[]): string {
  const renderedSkillBlock = formatSkillsForPrompt([...skills]);

  if (!renderedSkillBlock) return systemPrompt;

  return systemPrompt.replace(renderedSkillBlock, skillToolCatalog(skills));
}

function availableSkillsBlock(skills: ReadonlyMap<string, SkillEntry>): string {
  if (skills.size === 0) return "<available_skills>(none)</available_skills>";

  return [
    "<available_skills>",
    ...skills.keys().map((name) => `<skill>${name}</skill>`),
    "</available_skills>",
  ].join("\n");
}

function skillNotFound(
  requestedName: string,
  skills: ReadonlyMap<string, SkillEntry>,
): AgentToolResult<SkillNotFoundDetails> {
  return {
    content: [
      {
        type: "text",
        text: `Skill not found: "${requestedName}". Use an exact installed skill name.\n${availableSkillsBlock(skills)}`,
      },
    ],
    details: { status: "not-found", requestedName },
  };
}

function skillReadFailed(
  skill: SkillEntry,
  message: string,
): AgentToolResult<SkillReadFailedDetails> {
  return {
    content: [
      {
        type: "text",
        text: `Skill read failed: could not load "${skill.name}" from ${skill.filePath}. ${message}`,
      },
    ],
    details: {
      status: "read-failed",
      skillName: skill.name,
      filePath: skill.filePath,
    },
  };
}

function renderSkillResult(
  result: AgentToolResult<SkillToolDetails>,
  expanded: boolean,
  theme: Theme,
): Text {
  if (result.details.status !== "loaded") {
    return toolErrorResult(result, "✗", theme);
  }

  return expanded ? toolPreview(result, theme, { previewLines: 20 }) : emptyToolResult();
}

/** Registers the exact-name skill loader. */
export default function skillTool(pi: ExtensionAPI): void {
  const skillsByName = new Map<string, SkillEntry>();

  const replaceSkills = (skills: readonly Skill[]): void => {
    skillsByName.clear();

    for (const skill of skills) {
      skillsByName.set(skill.name, skillEntry(skill));
    }
  };

  const refreshSkillsFromCommands = (): void => {
    skillsByName.clear();

    for (const command of pi.getCommands()) {
      if (command.source !== "skill") continue;

      const name = command.name.replace(/^skill:/, "");

      if (skillsByName.has(name)) continue;

      skillsByName.set(name, {
        name,
        filePath: command.sourceInfo.path,
        baseDir: path.dirname(command.sourceInfo.path),
      });
    }
  };

  pi.registerTool({
    name: "skill",
    label: "Skill",
    description: [
      "Load complete instructions for an installed skill.",
      "Use when an available skill description matches the task, the user names a skill, or active skill instructions direct you to load one.",
      "Pass the exact listed or stated name.",
    ].join(" "),
    promptSnippet: "Load an installed skill's instructions by exact name",
    parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<SkillToolDetails>> {
      const skill = skillsByName.get(params.name);

      if (!skill) return skillNotFound(params.name, skillsByName);

      const program = readSkillContentBlock(skill.name, skill.filePath, skill.baseDir).pipe(
        Effect.map(
          (text) =>
            ({
              content: [
                {
                  type: "text" as const,
                  text,
                },
              ],
              details: {
                status: "loaded" as const,
                skillName: skill.name,
                filePath: skill.filePath,
              },
            }) satisfies AgentToolResult<LoadedSkillDetails>,
        ),
        Effect.match({
          onFailure: (error) => skillReadFailed(skill, error.message),
          onSuccess: (result) => result,
        }),
      );

      return Effect.runPromise(program);
    },
    renderCall(args, theme) {
      const skill = skillsByName.get(args.name);
      const location = skill ? ` ${theme.fg("muted", skill.filePath)}` : "";

      return new Text(
        `${theme.fg("toolTitle", theme.bold("skill"))} ${theme.fg("accent", args.name)}${location}`,
        0,
        0,
      );
    },
    renderResult(result, options, theme) {
      return renderSkillResult(result, options.expanded, theme);
    },
  });

  pi.on("session_start", () => {
    refreshSkillsFromCommands();
  });

  pi.on("resources_discover", () => {
    refreshSkillsFromCommands();
  });

  pi.on("before_agent_start", (event) => {
    const skills = event.systemPromptOptions.skills ?? [];

    const systemPrompt = replaceSkillCatalog(event.systemPrompt, skills);

    replaceSkills(skills);

    if (systemPrompt === event.systemPrompt) return;

    return { systemPrompt };
  });
}
