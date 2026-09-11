/** Ported from the mori/shell toolbox: every chunk is written to the temp file immediately; a capped in-memory tail serves the status display. */

import { closeSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";

/** Point-in-time view of a process's output: capped tail plus the full file path. */
export interface OutputSnapshot {
  tail: string;
  totalBytes: number;
  fullPath: string;
}

/**
 * Appends every chunk to a temp file immediately; keeps a capped in-memory
 * tail for the status display. Thread-safe only via single-writer callers.
 */
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

  /** Append raw output; the file gets the full bytes, the tail only the cap. */
  appendOutput(chunk: Buffer): void {
    if (this.fd === undefined || this.closed || chunk.length === 0) return;
    writeSync(this.fd, chunk);
    this.bytesWritten += chunk.length;
    const text = this.decoder.decode(chunk, { stream: true });

    if (text.length > 0) this.tail = (this.tail + text).slice(-this.maxTailChars);
  }

  /** Flush the decoder, close the fd, and mark the file appendable-no-more. */
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

  /** Safe to call while the process is still running. */
  outputSnapshot(): OutputSnapshot {
    return { tail: this.tail, totalBytes: this.bytesWritten, fullPath: this.path };
  }
}
