/**
 * Per-session background-process registry for the shell triplet.
 *
 * Owns opaque `shell-N` ids, the accumulator temp file with byte-offset
 * cursors for lossless incremental reads, read-once completion, the 1h lazy
 * sweep, same-id single-flight, and the killProcessTree kill path.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, readSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 60_000;
export const SWEEP_AFTER_MS = 60 * 60 * 1000;
/** Cap on how much of the temp file a single read pulls into memory. */
const MAX_READ_BYTES = 5 * 1024 * 1024;

/** Clamp 0–60000ms, default 10000, floor, non-finite → default. */
export function clampTimeoutMs(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.min(MAX_TIMEOUT_MS, Math.max(0, Math.floor(value)));
}

/**
 * Kill a process and all its children. Mirrors pi's internal
 * `utils/shell.killProcessTree` (not exported from the package): SIGKILL to
 * the process group with single-pid fallback on Unix, `taskkill /F /T` on
 * Windows.
 */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
				windowsHide: true,
			});
		} catch {
			// Ignore errors if taskkill fails.
		}
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Process already dead.
		}
	}
}

/**
 * Append-only temp-file accumulator. All raw output lands here; reads are
 * byte-offset slices so the backgrounding snapshot, every status read, and
 * the final cancel/completion read share one lossless cursor.
 */
export class ShellOutputFile {
	readonly path: string;
	bytesWritten = 0;
	private fd: number | undefined;

	constructor(prefix = "pi-shell") {
		this.path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.log`);
		this.fd = openSync(this.path, "a");
	}

	append(chunk: Buffer): void {
		if (this.fd === undefined) return;
		writeSync(this.fd, chunk);
		this.bytesWritten += chunk.length;
	}

	/** Read bytes [from, to) from the file. Oversized slices keep only the tail. */
	readSlice(from: number, to = this.bytesWritten): string {
		let start = Math.max(0, Math.min(from, to));
		if (to - start > MAX_READ_BYTES) start = to - MAX_READ_BYTES;
		const length = to - start;
		if (length <= 0) return "";
		const buffer = Buffer.alloc(length);
		const readFd = openSync(this.path, "r");
		try {
			const bytesRead = readSync(readFd, buffer, 0, length, start);
			return buffer.subarray(0, bytesRead).toString("utf8");
		} finally {
			closeSync(readFd);
		}
	}

	close(): void {
		if (this.fd === undefined) return;
		closeSync(this.fd);
		this.fd = undefined;
	}

	unlink(): void {
		this.close();
		try {
			unlinkSync(this.path);
		} catch {
			// Already gone.
		}
	}
}

export interface TrackInput {
	command: string;
	pid: number | undefined;
	output: ShellOutputFile;
	exitPromise: Promise<number | null>;
}

export interface ShellProcessRecord extends TrackInput {
	id: string;
	cursor: number;
	exited: boolean;
	exitCode: number | null;
	exitedAt?: number;
	lastPolledAt: number;
	readInFlight: boolean;
	/** Set by requestCancel; an in-flight status wait checks this on wake. */
	cancelled: boolean;
	/** Resolves when the record is cancelled; raced by in-flight status waits. */
	cancelPromise: Promise<void>;
}

export class BackgroundShellRegistry {
	private nextId = 1;
	private records = new Map<string, ShellProcessRecord>();
	private exitHookInstalled = false;
	private cancelResolvers = new Map<string, () => void>();
	private releaseWaiters = new Map<string, Array<() => void>>();

	/** Track a process that outlived its foreground window. Allocates `shell-N`. */
	track(input: TrackInput): ShellProcessRecord {
		let resolveCancel!: () => void;
		const cancelPromise = new Promise<void>((resolvePromise) => {
			resolveCancel = resolvePromise;
		});
		const record: ShellProcessRecord = {
			...input,
			id: `shell-${this.nextId++}`,
			cursor: 0,
			exited: false,
			exitCode: null,
			lastPolledAt: Date.now(),
			readInFlight: false,
			cancelled: false,
			cancelPromise,
		};
		this.cancelResolvers.set(record.id, resolveCancel);
		input.exitPromise.then(
			(code) => {
				record.exited = true;
				record.exitCode = code;
				record.exitedAt = Date.now();
				record.output.close();
			},
			() => {
				record.exited = true;
				record.exitCode = null;
				record.exitedAt = Date.now();
				record.output.close();
			},
		);
		this.records.set(record.id, record);
		this.installExitHook();
		return record;
	}

	get(id: string): ShellProcessRecord | undefined {
		return this.records.get(id);
	}

	liveIds(): string[] {
		return [...this.records.values()].filter((r) => !r.exited).map((r) => r.id);
	}

	unknownIdError(id: string): Error {
		const live = this.liveIds();
		return new Error(
			`no tracked background process "${id}" — it may have completed and already been read. ` +
				`Live ids: ${live.length ? live.join(", ") : "none"}`,
		);
	}

	/** Lossless since-last-read slice; advances the cursor. */
	readAndAdvance(record: ShellProcessRecord): string {
		const end = record.output.bytesWritten;
		const text = record.output.readSlice(record.cursor, end);
		record.cursor = end;
		record.lastPolledAt = Date.now();
		return text;
	}

	/** Read-once: the completing read deletes the record. Temp file persists. */
	completeRead(id: string): void {
		const record = this.records.get(id);
		if (!record) return;
		record.output.close();
		this.records.delete(id);
		this.cancelResolvers.delete(id);
		this.releaseWaiters.delete(id);
	}

	/** Same-id single-flight: a concurrent second read is a tool error. */
	beginRead(record: ShellProcessRecord): void {
		if (record.readInFlight) {
			throw new Error(`read already in flight for "${record.id}"`);
		}
		record.readInFlight = true;
	}

	endRead(record: ShellProcessRecord): void {
		record.readInFlight = false;
		const waiters = this.releaseWaiters.get(record.id);
		if (waiters) {
			this.releaseWaiters.delete(record.id);
			for (const wake of waiters) wake();
		}
	}

	/**
	 * Cancel-preempts-poll: mark the record cancelled and wake any
	 * in-flight status wait so it resolves immediately with output-so-far.
	 */
	requestCancel(record: ShellProcessRecord): void {
		record.cancelled = true;
		this.cancelResolvers.get(record.id)?.();
	}

	/**
	 * Resolves once no read is in flight for the record. Lets cancel sequence
	 * after a preempted status wait's slice read, keeping the cursor lossless.
	 */
	waitForReadRelease(record: ShellProcessRecord): Promise<void> {
		if (!record.readInFlight) return Promise.resolve();
		return new Promise((resolvePromise) => {
			const waiters = this.releaseWaiters.get(record.id) ?? [];
			waiters.push(resolvePromise);
			this.releaseWaiters.set(record.id, waiters);
		});
	}

	/** Drop exited records unread for 1h since max(exitedAt, lastPolledAt). */
	sweep(now = Date.now()): void {
		for (const record of this.records.values()) {
			if (!record.exited) continue;
			const idleSince = Math.max(record.exitedAt ?? 0, record.lastPolledAt);
			if (now - idleSince > SWEEP_AFTER_MS) {
				this.completeRead(record.id);
			}
		}
	}

	/** Session end kills everything still alive. */
	killAll(): void {
		for (const record of this.records.values()) {
			if (!record.exited && record.pid) killProcessTree(record.pid);
		}
	}

	private installExitHook(): void {
		if (this.exitHookInstalled) return;
		this.exitHookInstalled = true;
		process.once("exit", () => this.killAll());
	}
}
