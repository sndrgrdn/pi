import * as path from "node:path"

export const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

export const FILE_LIMIT = 500

/** Build ripgrep arguments from default + custom ignore patterns. */
export function buildRgArgs(customIgnore?: string[]): string[] {
  const args = ["--files"]
  for (const pattern of IGNORE_PATTERNS) {
    args.push("--glob", `!${pattern}*`)
  }
  if (customIgnore) {
    for (const pattern of customIgnore) {
      args.push("--glob", `!${pattern}`)
    }
  }
  args.push(".")
  return args
}

export interface DirTree {
  dirs: Set<string>
  filesByDir: Map<string, string[]>
}

/** Build a directory tree structure from a flat list of relative file paths. */
export function buildTree(files: string[]): DirTree {
  const dirs = new Set<string>()
  const filesByDir = new Map<string, string[]>()

  for (const file of files) {
    const dir = path.dirname(file)
    const parts = dir === "." ? [] : dir.split("/")

    // Register all parent directories
    for (let i = 0; i <= parts.length; i++) {
      const dirPath = i === 0 ? "." : parts.slice(0, i).join("/")
      dirs.add(dirPath)
    }

    // Group file into its directory
    const existing = filesByDir.get(dir)
    if (existing) {
      existing.push(path.basename(file))
    } else {
      filesByDir.set(dir, [path.basename(file)])
    }
  }

  return { dirs, filesByDir }
}

/** Render a DirTree as an indented string. Directories first, then files, sorted. */
export function renderTree(tree: DirTree): string {
  const { dirs, filesByDir } = tree

  function renderDir(dirPath: string, depth: number): string {
    const indent = "  ".repeat(depth)
    let output = ""

    if (depth > 0) {
      output += `${indent}${path.basename(dirPath)}/\n`
    }

    const childIndent = "  ".repeat(depth + 1)

    // Subdirectories first
    const children = Array.from(dirs)
      .filter((d) => path.dirname(d) === dirPath && d !== dirPath)
      .toSorted()

    for (const child of children) {
      output += renderDir(child, depth + 1)
    }

    // Then files
    const dirFiles = filesByDir.get(dirPath) ?? []
    for (const file of dirFiles.toSorted()) {
      output += `${childIndent}${file}\n`
    }

    return output
  }

  return renderDir(".", 0)
}
