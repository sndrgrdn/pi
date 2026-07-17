#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

function normalizeOverride(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

const override = process.env.PI_PACKAGE_DIR;
if (override) {
  process.stdout.write(normalizeOverride(override));
  process.exit(0);
}

const executable = process.argv[2];
if (!executable) {
  console.error("Usage: resolve-pi-root.mjs <pi-executable>");
  process.exit(2);
}

let entry;
try {
  entry = realpathSync(resolve(executable));
} catch (error) {
  console.error(`Cannot resolve pi executable ${executable}: ${error.message}`);
  process.exit(1);
}

let directory = dirname(entry);
while (directory !== dirname(directory)) {
  if (existsSync(join(directory, "package.json"))) {
    process.stdout.write(directory);
    process.exit(0);
  }
  directory = dirname(directory);
}

// Compiled Bun distributions keep README.md, docs/, and examples/ beside the executable.
process.stdout.write(dirname(entry));
