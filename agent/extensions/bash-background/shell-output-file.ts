import { closeSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";

export interface OutputSnapshot {
  tail: string;
  totalBytes: number;
  fullPath: string;
}

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

  appendOutput(chunk: Buffer): void {
    if (this.fd === undefined || this.closed || chunk.length === 0) return;
    writeSync(this.fd, chunk);
    this.bytesWritten += chunk.length;
    const text = this.decoder.decode(chunk, { stream: true });

    if (text.length > 0) this.tail = (this.tail + text).slice(-this.maxTailChars);
  }

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

  outputSnapshot(): OutputSnapshot {
    return { tail: this.tail, totalBytes: this.bytesWritten, fullPath: this.path };
  }
}
