import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

function getBlockedCommandMessage(command: string): string | null {
  const startsCmd = "(?:^|\\n|[;|&]{1,2})\\s*(?:\\S+\/)?";

  const pipPattern = new RegExp(`${startsCmd}pip3?\\b`, "m");
  const pipxPattern = new RegExp(`${startsCmd}pipx\\b`, "m");
  const poetryPattern = new RegExp(`${startsCmd}poetry\\b`, "m");
  const pyenvPattern = new RegExp(`${startsCmd}pyenv\\b`, "m");
  const virtualenvPattern = new RegExp(`${startsCmd}virtualenv\\b`, "m");
  const condaPattern = new RegExp(`${startsCmd}(?:conda|mamba|micromamba)\\b`, "m");
  const otherManagersPattern = new RegExp(`${startsCmd}(?:pipenv|pdm|rye|hatch)\\b`, "m");
  const pythonPattern = new RegExp(`${startsCmd}python(?:3(?:\\.\\d+)?)?\\b`, "m");

  if (pipPattern.test(command)) {
    return [
      "Error: pip/pip3 blocked. Use uv instead:",
      "",
      "  To add dependency: uv add PACKAGE",
      "  To install tool: uv tool install TOOL",
      "  To run one-off tool: uvx TOOL",
      "",
    ].join("\n");
  }

  if (pipxPattern.test(command)) {
    return [
      "Error: pipx blocked. Use uv tool/uvx instead:",
      "",
      "  Install tool: uv tool install TOOL",
      "  Run one-off tool: uvx TOOL",
      "",
    ].join("\n");
  }

  if (poetryPattern.test(command)) {
    return [
      "Error: poetry blocked. Use uv instead:",
      "",
      "  Init project: uv init",
      "  Add dependency: uv add PACKAGE",
      "  Sync lock/env: uv sync",
      "  Run command: uv run COMMAND",
      "",
    ].join("\n");
  }

  if (pyenvPattern.test(command)) {
    return [
      "Error: pyenv blocked. Use uv Python manager instead:",
      "",
      "  List versions: uv python list",
      "  Install version: uv python install 3.12",
      "  Pin version: uv python pin 3.12",
      "",
    ].join("\n");
  }

  if (virtualenvPattern.test(command)) {
    return [
      "Error: virtualenv blocked. Use uv instead:",
      "",
      "  Create environment: uv venv",
      "",
    ].join("\n");
  }

  if (condaPattern.test(command)) {
    return [
      "Error: conda/mamba blocked. Use uv instead:",
      "",
      "  Create environment: uv venv",
      "  Manage deps: uv add / uv sync",
      "",
    ].join("\n");
  }

  if (otherManagersPattern.test(command)) {
    return [
      "Error: alternate Python package manager blocked (pipenv/pdm/rye/hatch).",
      "",
      "  Use uv init / uv add / uv sync / uv run",
      "",
    ].join("\n");
  }

  if (pythonPattern.test(command)) {
    return [
      "Error: direct python/python3 blocked.",
      "",
      "  Run scripts with: uv run python ...",
      "",
    ].join("\n");
  }

  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;

    const blocked = getBlockedCommandMessage(event.input.command);
    if (!blocked) return;

    return { block: true, reason: blocked };
  });

  pi.on("user_bash", (event) => {
    const blocked = getBlockedCommandMessage(event.command);
    if (!blocked) return;

    return {
      result: {
        output: blocked,
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
}
