import { spawnSync } from "node:child_process";
import { unwatchFile, watchFile } from "node:fs";

export function watchGitBranch(cwd: string, onChange: (branch: string | null) => void): () => void {
  const git = (...args: string[]) =>
    spawnSync("git", ["--no-optional-locks", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    });

  const paths = git(
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "HEAD",
    "--git-path",
    "reftable/tables.list",
  );

  if (paths.status !== 0) {
    onChange(null);

    return () => {};
  }

  let branch: string | null | undefined;

  const refreshBranch = () => {
    const result = git("symbolic-ref", "--quiet", "--short", "HEAD");

    let nextBranch: string | null = null;

    if (result.status === 0) nextBranch = result.stdout.trim();
    else if (result.status === 1) nextBranch = "detached";

    if (branch !== nextBranch) {
      branch = nextBranch;
      onChange(branch);
    }
  };

  const watchedPaths = paths.stdout.trimEnd().split("\n");

  for (const path of watchedPaths) {
    watchFile(path, { interval: 1000, persistent: false }, refreshBranch);
  }

  refreshBranch();

  return () => {
    for (const path of watchedPaths) unwatchFile(path, refreshBranch);
  };
}
