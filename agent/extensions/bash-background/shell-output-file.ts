/** Persists complete process output and retains a bounded in-memory tail for status. */

import { closeSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";

/** Current output tail, byte count, and complete-output path. */
export interface OutputSnapshot {
  tail: string;
  totalBytes: number;
  fullPath: string;
}

/** Requires serialized writes and retains only a bounded decoded tail in memory. */
export class ShellOutputFile {
  readonly path: string;
  bytesWritten = 0;
  private fd: number | undefined;
  private tail = "";
  private decoder = new TextDecoder("utf-8");
  private closed = false;
  private readonly maxTailChars: number;

  constructor(maxTailChars = DEFAULT_MAX_BYTES, prefix = "pi-bash-bg") {
    this.maxTailChars = maxTailChars;
    this.path = join(
      tmpdir(),
      `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.log`,
    );
    this.fd = openSync(this.path, "a");
  }

  /** Appends raw output to the full file and bounded tail. */
  appendOutput(chunk: Buffer): void {
    if (this.fd === undefined || this.closed || chunk.length === 0) return;
    writeSync(this.fd, chunk);
    this.bytesWritten += chunk.length;
    const text = this.decoder.decode(chunk, { stream: true });

    if (text.length > 0) this.tail = (this.tail + text).slice(-this.maxTailChars);
  }

  /** Flushes pending text and closes the output file. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const flushed = this.decoder.decode();

    if (flushed.length > 0) this.tail = (this.tail + flushed).slice(-this.maxTailChars);

    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
    }
  }

  /** Returns a snapshot without closing the running output stream. */
  outputSnapshot(): OutputSnapshot {
    return { tail: this.tail, totalBytes: this.bytesWritten, fullPath: this.path };
  }
}
