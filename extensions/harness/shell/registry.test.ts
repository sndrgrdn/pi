import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
	BackgroundShellRegistry,
	clampTimeoutMs,
	DEFAULT_TIMEOUT_MS,
	MAX_TIMEOUT_MS,
	ShellOutputFile,
	SWEEP_AFTER_MS,
} from "./registry.ts";

describe("clampTimeoutMs", () => {
	it.each([
		[undefined, DEFAULT_TIMEOUT_MS],
		[null, DEFAULT_TIMEOUT_MS],
		["5000", DEFAULT_TIMEOUT_MS],
		[Number.NaN, DEFAULT_TIMEOUT_MS],
		[Number.POSITIVE_INFINITY, DEFAULT_TIMEOUT_MS],
		[-1, 0],
		[0, 0],
		[1234.9, 1234],
		[10_000, 10_000],
		[60_000, MAX_TIMEOUT_MS],
		[60_001, MAX_TIMEOUT_MS],
		[999_999, MAX_TIMEOUT_MS],
	])("clamps %s to %d", (input, expected) => {
		expect(clampTimeoutMs(input)).toBe(expected);
	});
});

describe("ShellOutputFile", () => {
	const files: ShellOutputFile[] = [];
	const make = () => {
		const file = new ShellOutputFile("pi-shell-test");
		files.push(file);
		return file;
	};
	afterEach(() => {
		for (const file of files.splice(0)) file.unlink();
	});

	it("appends chunks to a temp file and tracks bytes written", () => {
		const file = make();
		file.append(Buffer.from("hello "));
		file.append(Buffer.from("world"));
		expect(file.bytesWritten).toBe(11);
		expect(existsSync(file.path)).toBe(true);
		expect(readFileSync(file.path, "utf8")).toBe("hello world");
	});

	it("reads byte-offset slices", () => {
		const file = make();
		file.append(Buffer.from("one\ntwo\nthree\n"));
		expect(file.readSlice(0)).toBe("one\ntwo\nthree\n");
		expect(file.readSlice(4)).toBe("two\nthree\n");
		expect(file.readSlice(4, 8)).toBe("two\n");
		expect(file.readSlice(14)).toBe("");
	});
});

const adopt = (registry: BackgroundShellRegistry, exitPromise: Promise<number | null> = new Promise(() => {})) =>
	registry.adopt({ command: "sleep 999", pid: undefined, output: new ShellOutputFile("pi-shell-test"), exitPromise });

describe("BackgroundShellRegistry", () => {
	it("allocates sequential per-session opaque ids", () => {
		const registry = new BackgroundShellRegistry();
		expect(adopt(registry).id).toBe("shell-1");
		expect(adopt(registry).id).toBe("shell-2");
		const other = new BackgroundShellRegistry();
		expect(adopt(other).id).toBe("shell-1");
	});

	it("readAndAdvance returns only new output per read (lossless cursor)", () => {
		const registry = new BackgroundShellRegistry();
		const record = adopt(registry);
		record.output.append(Buffer.from("first\n"));
		expect(registry.readAndAdvance(record)).toBe("first\n");
		expect(registry.readAndAdvance(record)).toBe("");
		record.output.append(Buffer.from("second\n"));
		expect(registry.readAndAdvance(record)).toBe("second\n");
		record.output.unlink();
	});

	it("marks records exited when the exit promise settles", async () => {
		const registry = new BackgroundShellRegistry();
		const record = adopt(registry, Promise.resolve(3));
		await new Promise((r) => setImmediate(r));
		expect(record.exited).toBe(true);
		expect(record.exitCode).toBe(3);
		expect(record.exitedAt).toBeTypeOf("number");
		expect(registry.liveIds()).toEqual([]);
	});

	it("completeRead deletes the record (read-once)", () => {
		const registry = new BackgroundShellRegistry();
		const record = adopt(registry);
		registry.completeRead(record.id);
		expect(registry.get(record.id)).toBeUndefined();
	});

	it("unknown-id error lists live ids", () => {
		const registry = new BackgroundShellRegistry();
		expect(registry.unknownIdError("shell-9").message).toContain("Live ids: none");
		const record = adopt(registry);
		const err = registry.unknownIdError("shell-9");
		expect(err.message).toContain('no tracked background process "shell-9"');
		expect(err.message).toContain(`Live ids: ${record.id}`);
	});

	it("single-flight: concurrent second read on the same id throws", () => {
		const registry = new BackgroundShellRegistry();
		const record = adopt(registry);
		registry.beginRead(record);
		expect(() => registry.beginRead(record)).toThrow(/read already in flight/);
		registry.endRead(record);
		expect(() => registry.beginRead(record)).not.toThrow();
	});

	it("sweeps exited records only after 1h idle", async () => {
		const registry = new BackgroundShellRegistry();
		const live = adopt(registry);
		const exited = adopt(registry, Promise.resolve(0));
		await new Promise((r) => setImmediate(r));
		const idleSince = Math.max(exited.exitedAt ?? 0, exited.lastPolledAt);
		registry.sweep(idleSince + SWEEP_AFTER_MS);
		expect(registry.get(exited.id)).toBeDefined();
		registry.sweep(idleSince + SWEEP_AFTER_MS + 1);
		expect(registry.get(exited.id)).toBeUndefined();
		expect(registry.get(live.id)).toBeDefined();
	});
});
