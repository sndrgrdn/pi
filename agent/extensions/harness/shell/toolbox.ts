/**
 * The indivisible shell triplet as a child-toolbox bundle. One place owns
 * both the tool constructors and the model-visible names, so agent specs
 * admit the capability without repeating either list.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createShellCancelTool } from "./cancel.ts";
import { createShellCommandTool } from "./command.ts";
import type { BackgroundShellRegistry } from "./registry.ts";
import { createShellStatusTool } from "./status.ts";

export const SHELL_TOOLBOX_NAMES = ["shell_command", "shell_command_status", "shell_command_cancel"] as const;

export function createShellToolbox(processes: BackgroundShellRegistry): ToolDefinition<any, any, any>[] {
	return [createShellCommandTool(processes), createShellStatusTool(processes), createShellCancelTool(processes)];
}
