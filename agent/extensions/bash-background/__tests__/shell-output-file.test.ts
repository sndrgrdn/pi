import { readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ShellOutputFile } from "../shell-output-file.ts";

describe("ShellOutputFile", () => {
  it("writes all output to the temp file losslessly", async () => {
    const file = new ShellOutputFile(10);
    file.appendOutput(Buffer.from("hello "));
    file.appendOutput(Buffer.from("world!"));
    const snapshot = file.outputSnapshot();
    expect(snapshot.totalBytes).toBe(12);
    expect(await readFile(snapshot.fullPath, "utf8")).toBe("hello world!");
    file.close();
    await rm(snapshot.fullPath, { force: true });
  });

  it("keeps only the capped tail in memory for the status display", async () => {
    const file = new ShellOutputFile(5);
    file.appendOutput(Buffer.from("abcdef"));
    const snapshot = file.outputSnapshot();
    expect(snapshot.tail).toBe("bcdef");
    expect(snapshot.totalBytes).toBe(6);
    file.close();
    await rm(snapshot.fullPath, { force: true });
  });

  it("decodes multibyte characters split across chunks", async () => {
    const file = new ShellOutputFile(64);
    file.appendOutput(Buffer.from([0xc3])); // first half of é
    file.appendOutput(Buffer.from([0xa9])); // second half of é
    const snapshot = file.outputSnapshot();
    expect(snapshot.tail).toBe("é");
    file.close();
    await rm(snapshot.fullPath, { force: true });
  });

  it("stops accepting output after close", async () => {
    const file = new ShellOutputFile(64);
    file.appendOutput(Buffer.from("before"));
    file.close();
    file.appendOutput(Buffer.from("after"));
    const snapshot = file.outputSnapshot();
    expect(snapshot.tail).toBe("before");
    expect(snapshot.totalBytes).toBe(6);
    await rm(snapshot.fullPath, { force: true });
  });
});
