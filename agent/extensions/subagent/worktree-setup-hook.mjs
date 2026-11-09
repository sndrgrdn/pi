#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { worktreePath } = JSON.parse(readFileSync(0, "utf8"));
const setup = join(worktreePath, "bin", "worktree-setup");

if (existsSync(setup)) {
  const result = spawnSync(setup, [worktreePath], { cwd: worktreePath, stdio: ["ignore", process.stderr, process.stderr] });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write("{}\n");
