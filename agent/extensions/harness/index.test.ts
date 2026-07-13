import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import harness, { registerDelegationCancellation } from "./index.ts";

describe("harness extension entry", () => {
	it("exports an extension entry function", () => {
		expect(typeof harness).toBe("function");
	});

	it("locks Main to the eleven admitted tools", () => {
		const setActiveTools = vi.fn();
		const registeredTools: any[] = [];
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const pi = new Proxy(
			{
				setActiveTools,
				registerTool: vi.fn((tool: any) => registeredTools.push(tool)),
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
		expect(registeredTools.map(({ name, renderShell }) => [name, renderShell])).toEqual([
			["shell_command", "self"],
			["shell_command_status", "self"],
			["shell_command_cancel", "self"],
			["apply_patch", "self"],
			["read", "self"],
			["skill", "self"],
			["finder", "self"],
			["librarian", "self"],
			["oracle", "self"],
			["task", "self"],
		]);
	});

	it("marks recorded delegation aborts as cancelled mechanical results", () => {
		let handler: ((event: any) => unknown) | undefined;
		const pi = {
			on: vi.fn((_event: string, callback: (event: any) => unknown) => {
				handler = callback;
			}),
		} as any;
		const cancelledCalls = new Set(["call-1"]);
		registerDelegationCancellation(pi, cancelledCalls);

		expect(handler?.({ toolName: "task", toolCallId: "call-1", details: { child: true } })).toEqual({
			details: { child: true, trace: { state: "cancelled" } },
		});
		expect(cancelledCalls).toEqual(new Set());
	});
});
