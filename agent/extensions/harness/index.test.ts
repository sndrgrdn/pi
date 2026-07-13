import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import harness from "./index.ts";

describe("harness extension entry", () => {
	it("exports an extension entry function", () => {
		expect(typeof harness).toBe("function");
	});

	it("locks Main to the eleven admitted tools", () => {
		const setActiveTools = vi.fn();
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const pi = new Proxy(
			{
				setActiveTools,
				on: vi.fn((event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler)),
				events: { emit: vi.fn(), on: vi.fn() },
				getCommands: () => [],
			},
			{
				get(target, property) {
					return property in target ? target[property as keyof typeof target] : vi.fn();
				},
			},
		) as unknown as ExtensionAPI;

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
			"skill",
			"finder",
			"oracle",
			"librarian",
			"task",
			"mcp",
		]);
	});
});
