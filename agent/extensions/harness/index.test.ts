import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import harness from "./index.ts";

describe("harness extension entry", () => {
	it("admits only the ten Main tools when a session starts", () => {
		const setActiveTools = vi.fn();
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const pi = {
			setActiveTools,
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
			registerShortcut: vi.fn(),
			setModel: vi.fn(),
			setThinkingLevel: vi.fn(),
			appendEntry: vi.fn(),
			on: vi.fn((event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler)),
			events: { emit: vi.fn(), on: vi.fn() },
			getCommands: () => [],
		} as unknown as ExtensionAPI;

		harness(pi);
		expect(setActiveTools).not.toHaveBeenCalled();

		handlers.get("session_start")?.({}, {});

		expect(setActiveTools).toHaveBeenCalledOnce();
		expect(setActiveTools).toHaveBeenCalledWith([
			"shell_command",
			"shell_command_status",
			"shell_command_cancel",
			"read",
			"apply_patch",
			"finder",
			"oracle",
			"librarian",
			"task",
			"mcp",
		]);
	});
});
