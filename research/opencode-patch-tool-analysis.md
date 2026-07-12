# OpenCode Patch/Edit Tool Implementation Analysis

**Repo**: /Users/sander/.cache/checkouts/github.com/anomalyco/opencode  
**Analysis Date**: 2026-07-12  
**Primary Files**:
- `/packages/opencode/src/tool/apply_patch.ts` (11,019 bytes)
- `/packages/opencode/src/tool/apply_patch.txt` (1,098 bytes, model-facing description)
- `/packages/opencode/src/tool/edit.ts` (24,530 bytes)
- `/packages/opencode/src/tool/edit.txt` (1,369 bytes, model-facing description)
- `/packages/core/src/patch.ts` (parser and hunk definitions)

---

## 1. Tool Schema (Parameters)

### apply_patch Tool
**File**: `apply_patch.ts` lines 19–25

```typescript
export const Parameters = Schema.Struct({
  patchText: Schema.String.annotate({ 
    description: "The full patch text that describes all changes to be made" 
  }),
})
```

**Schema Type**: Effect Schema (TypeScript-first validation)  
**Model Receives**: JSON Schema compiled from the above Struct  
**Single Parameter**: `patchText: string` — the entire patch document as one string block

---

### edit Tool
**File**: `edit.ts` lines 193–206

```typescript
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ 
    description: "The absolute path to the file to modify" 
  }),
  oldString: Schema.String.annotate({ 
    description: "The text to replace" 
  }),
  newString: Schema.String.annotate({
    description: "The text to replace it with (must be different from oldString)",
  }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "Replace all occurrences of oldString (default false)",
  }),
})
```

**Parameters**:
1. `filePath`: absolute path (or relative to instance.directory)
2. `oldString`: exact match search text
3. `newString`: replacement text (must differ from oldString)
4. `replaceAll` (optional, default false): boolean flag to replace all occurrences

---

## 2. Supported Patch Format & Parser Implementation

### Format Grammar

**File**: `apply_patch.txt` (model-facing spec)

**Envelope Structure**:
```
*** Begin Patch
[one or more file operations]
*** End Patch
```

**Three File Operation Headers** (mutually exclusive per file):
1. `*** Add File: <path>` — create new file
2. `*** Delete File: <path>` — remove existing file
3. `*** Update File: <path>` — modify in place (optionally with rename)

**Optional Rename Directive** (for Update):
```
*** Move to: <newpath>
```

**Add File Lines**: Every line prefixed with `+`  
**Update File Chunks** (one or more):
```
@@[optional context description]
 [unchanged context line]
-[removed line]
+[added line]
 [unchanged context line]
```

**Special Marker**: `*** End of File` — marks explicit EOF during update (rare)

### Parser Implementation

**File**: `/packages/core/src/patch.ts` (primary parser)

#### Entry Point: `Patch.parsePatch(patchText: string)`
- Returns `{ hunks: Hunk[] }`
- Throws on malformed input

#### Parsing Logic (lines ~16–85):

```typescript
export function parse(patchText: string): ReadonlyArray<Hunk> {
  const lines = stripHeredoc(patchText.trim()).split("\n")
  const begin = lines.findIndex((line) => line.trim() === "*** Begin Patch")
  const end = lines.findIndex((line) => line.trim() === "*** End Patch")
  if (begin === -1 || end === -1 || begin >= end) 
    throw new Error("Invalid patch format: missing Begin/End markers")

  const hunks: Hunk[] = []
  let index = begin + 1
  while (index < end) {
    const line = lines[index]!
    if (line.startsWith("*** Add File:")) {
      const path = line.slice("*** Add File:".length).trim()
      if (!path) throw new Error("Invalid add file path")
      const parsed = parseAdd(lines, index + 1)
      hunks.push({ type: "add", path, contents: parsed.content })
      index = parsed.next
      continue
    }
    // ... similar for Delete and Update
  }
  return hunks
}
```

#### Hunk Data Types

```typescript
export type Hunk =
  | { readonly type: "add"; readonly path: string; readonly contents: string }
  | { readonly type: "delete"; readonly path: string }
  | {
      readonly type: "update"
      readonly path: string
      readonly movePath?: string
      readonly chunks: ReadonlyArray<UpdateFileChunk>
    }

export interface UpdateFileChunk {
  readonly oldLines: ReadonlyArray<string>
  readonly newLines: ReadonlyArray<string>
  readonly changeContext?: string
  readonly endOfFile?: boolean
}
```

#### Heredoc Support
- **Line**: `const stripHeredoc = (input: string) => input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$)?.[2] ?? input`
- Extracts patch from shell heredoc syntax: `cat <<'PATCH' ... PATCH`
- Useful for shell tool integration

#### Update Chunk Parser (`parseUpdate`)
- Reads lines starting with `@@` as chunk headers
- Collects context lines (space-prefixed), removals (`-`), additions (`+`)
- Respects `*** End of File` marker (sets `endOfFile: true` in chunk)

---

## 3. Matching Algorithm

### apply_patch Tool: Line-based Exact & Fuzzy Matching

**File**: `/packages/core/src/patch.ts`, `computeReplacements()` and `seek()` functions

#### Seek Strategy (4-pass fallback chain)

```typescript
function seek(lines: ReadonlyArray<string>, pattern: ReadonlyArray<string>, start: number, eof = false) {
  if (pattern.length === 0) return -1
  for (const compare of [exact, rstrip, trim, normalized]) {
    // Try EOF match first if eof flag set
    if (eof) {
      const offset = lines.length - pattern.length
      if (offset >= start && matches(lines, pattern, offset, compare)) return offset
    }
    // Scan forward from start position
    for (let offset = start; offset <= lines.length - pattern.length; offset++) {
      if (matches(lines, pattern, offset, compare)) return offset
    }
  }
  return -1
}
```

**Comparison Functions** (in order of strictness):
1. **`exact`**: `left === right` — byte-for-byte identity
2. **`rstrip`**: `left.trimEnd() === right.trimEnd()` — ignore trailing whitespace only
3. **`trim`**: `left.trim() === right.trim()` — ignore leading & trailing whitespace
4. **`normalized`**: `normalize(left.trim()) === normalize(right.trim())`
   - Normalizes smart quotes: `[''‚‛]` → `'`, `[""„‟]` → `"`
   - Normalizes dashes: `[‐‑‒–—―]` → `-`
   - Ellipsis: `…` → `...`
   - Spaces: ` ` (non-breaking) → ` ` (regular)

**Search Behavior**:
- Sequential scan from `lineIndex` forward
- Matches all lines in pattern to corresponding lines in file
- If pattern ends with empty string, tries without it before failing
- EOF flag skips forward scan, checks only final position

### edit Tool: Multi-Strategy Replacer Chain

**File**: `edit.ts` lines 368–700+

#### Replacer Strategies (in order of attempt)

The `replace()` function iterates through replacers, each yielding candidate matches:

```typescript
for (const replacer of [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
  MultiOccurrenceReplacer,
]) {
  for (const search of replacer(content, oldString)) {
    // ... try replacement with this candidate
  }
}
```

#### Strategy Details

1. **SimpleReplacer** (lines 346–348)  
   Yields the exact `find` string as-is. Baseline for simple exact matches.

2. **LineTrimmedReplacer** (lines 350–380)  
   - Splits content & search by `\n`
   - Trims per-line, compares trimmed versions
   - If all lines match (trimmed), yields the original untrimmed block from content
   - **Use case**: handles indentation variations in line-by-line blocks

3. **BlockAnchorReplacer** (lines 382–465)  
   - Requires ≥3 lines to activate (needs meaningful context anchors)
   - Matches first & last line (trimmed)
   - Computes `maxLineDelta = Math.max(1, Math.floor(blockSize * 0.25))`
   - Single candidate: uses relaxed threshold 0.65 similarity on middle lines
   - Multiple candidates: picks best match by similarity
   - Similarity metric: Levenshtein distance per line
   - **Use case**: fuzzy block matching when indentation/spacing changes

4. **WhitespaceNormalizedReplacer** (lines 467–502)  
   - Normalizes all whitespace: `/\s+/g` → single space, `.trim()`
   - Compares normalized versions
   - Handles both single-line and multi-line (block) matches
   - **Use case**: resilient to whitespace/formatting changes

5. **IndentationFlexibleReplacer** (lines 504–535)  
   - Removes common leading indentation from both find & content
   - Line-by-line comparison after deindent
   - **Use case**: indentation-agnostic matching (e.g., code inside nested blocks)

6. **EscapeNormalizedReplacer** (lines 537–577)  
   - Unescapes escape sequences: `\n`, `\t`, `\r`, `\'`, `\"`, `` \` ``, `\\`
   - Tries unescaped version in content
   - Also unescapes blocks for multi-line matching
   - **Use case**: handles escaped strings from code generation

7. **TrimmedBoundaryReplacer** (lines 579–599)  
   - Skip if already trimmed
   - Tries trimmed version as substring
   - Also tries multi-line blocks where trimmed content matches
   - **Use case**: edge whitespace cleanup

8. **ContextAwareReplacer** (lines 601–646)  
   - Requires ≥3 lines
   - Extracts first & last lines (trimmed) as anchors
   - Finds blocks with matching anchors
   - Checks if block has ≥50% matching middle lines
   - Only matches first occurrence
   - **Use case**: contextual block identification with partial middle-content tolerance

9. **MultiOccurrenceReplacer** (lines 648–660)  
   - Yields all exact matches sequentially using `indexOf()`
   - Allows `replaceAll` flag to handle multiple occurrences
   - **Use case**: explicit multi-match support

#### Uniqueness Enforcement (lines 662–708)

```typescript
const index = content.indexOf(search)
if (index === -1) continue
notFound = false

// Check for proportionality
if (isDisproportionateMatch(search, oldString)) {
  throw new Error(
    "Refusing replacement because the matched span is much larger than oldString. "
    "Re-read the file and provide the full exact oldString for the intended replacement."
  )
}

if (replaceAll) {
  return content.replaceAll(search, newString)
}

const lastIndex = content.lastIndexOf(search)
if (index !== lastIndex) continue  // Skip if multiple occurrences found
return content.substring(0, index) + newString + content.substring(index + search.length)
```

**Proportionality Check** (lines 730–739):
```typescript
function isDisproportionateMatch(search: string, oldString: string) {
  const oldLines = oldString.split("\n").length
  const searchLines = search.split("\n").length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}
```

**Error Cases**:
- `oldString` not found after any replacer → "Could not find oldString in the file..."
- Multiple candidates found & not replaceAll → "Found multiple matches for oldString..."
- Proportionate match rejected → "Refusing replacement because matched span is much larger..."

---

## 4. Path Resolution Rules

### apply_patch Tool

**File**: `apply_patch.ts`, lines 57–69

```typescript
const instance = yield* InstanceState.context

for (const hunk of hunks) {
  const filePath = path.resolve(instance.directory, hunk.path)
  yield* assertExternalDirectoryEffect(ctx, filePath)
```

**Resolution**:
1. Resolve `hunk.path` (from patch) relative to `instance.directory`
2. Validate against external directory constraints
3. Use resolved absolute path for all file operations

**Base Directory**: `instance.directory` (workspace/project root)  
**Relative Paths**: Patch paths like `nested/new.txt` are relative to project root  
**Move Target**: `hunk.move_path` also resolved via `instance.directory`

### edit Tool

**File**: `edit.ts`, lines 216–220

```typescript
const filePath = path.isAbsolute(params.filePath)
  ? params.filePath
  : path.join(instance.directory, params.filePath)
yield* assertExternalDirectoryEffect(ctx, filePath)
```

**Resolution**:
1. Accept absolute OR relative paths
2. Relative paths resolved against `instance.directory`
3. Validate against external directory constraints

**External Directory Validation**

**File**: `tool/external-directory.ts`

```typescript
export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return false
  if (options?.bypass) return false

  const ins = yield* InstanceState.context
  const full = process.platform === "win32" ? FSUtil.normalizePath(target) : target
  if (containsPath(full, ins)) return false  // Inside project → OK

  // Outside project → ask permission
  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: { filepath: full, parentDir: dir },
  })
  return true
})
```

**Rules**:
- Files within instance (project) directory: auto-allowed
- Files outside project: permission request (can be auto-approved by `always: ["*"]`)
- Windows: paths normalized before check
- Unix: raw path comparison

---

## 5. Atomicity: Preflight, Verification, Apply, Rollback

### apply_patch Tool

**File**: `apply_patch.ts`

#### Preflight Phase (lines 41–168)

**No rollback support; preflight validates everything before first write**:

```typescript
// Parse & validate hunks
let hunks: Patch.Hunk[]
try {
  const parseResult = Patch.parsePatch(params.patchText)
  hunks = parseResult.hunks
} catch (error) {
  return yield* Effect.fail(new Error(`apply_patch verification failed: ${error}`))
}

if (hunks.length === 0) {
  return yield* Effect.fail(new Error("patch rejected: empty patch"))
}

// Build fileChanges with diffs and counts
const fileChanges: Array<{
  filePath: string
  oldContent: string
  newContent: string
  type: "add" | "update" | "delete" | "move"
  movePath?: string
  diff: string
  additions: number
  deletions: number
  bom: boolean
}> = []

let totalDiff = ""

for (const hunk of hunks) {
  const filePath = path.resolve(instance.directory, hunk.path)
  yield* assertExternalDirectoryEffect(ctx, filePath)

  switch (hunk.type) {
    case "add": {
      // Compute diff from empty content to new content
      // No file I/O yet
      const diff = trimDiff(createTwoFilesPatch(...))
      fileChanges.push({ ... })
      break
    }
    case "update": {
      // Read file
      const stats = yield* afs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stats || stats.type === "Directory") {
        return yield* Effect.fail(
          new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`)
        )
      }
      const source = yield* Bom.readFile(afs, filePath)
      const oldContent = source.text
      
      // Derive new content (applies chunks)
      const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks, ...)
      // If chunk matching fails, throws and fails entire operation
      fileChanges.push({ ... })
      break
    }
    case "delete": {
      const source = yield* Bom.readFile(afs, filePath).pipe(
        Effect.catch((error) =>
          Effect.fail(new Error(`apply_patch verification failed: ${error.message}`))
        )
      )
      fileChanges.push({ ... })
      break
    }
  }
}
```

**Key Points**:
- All file reads happen in preflight
- Chunk matching happens before permission request
- If any hunk fails to parse or match, entire operation fails
- No partial application

#### Permission Request (lines 170–185)

```typescript
const files = fileChanges.map((change) => ({
  filePath: change.filePath,
  relativePath: path.relative(instance.worktree, change.movePath ?? change.filePath),
  type: change.type,
  patch: change.diff,
  additions: change.additions,
  deletions: change.deletions,
  movePath: change.movePath,
}))

yield* ctx.ask({
  permission: "edit",
  patterns: relativePaths,
  always: ["*"],
  metadata: {
    filepath: relativePaths.join(", "),
    diff: totalDiff,
    files,  // Per-file metadata for UI rendering
  },
})
```

**Single permission request** with all file metadata

#### Application Phase (lines 187–246)

```typescript
for (const change of fileChanges) {
  switch (change.type) {
    case "add":
      yield* afs.writeWithDirs(change.filePath, Bom.join(change.newContent, change.bom))
      updates.push({ file: change.filePath, event: "add" })
      break
    case "update":
      yield* afs.writeWithDirs(change.filePath, Bom.join(change.newContent, change.bom))
      updates.push({ file: change.filePath, event: "change" })
      break
    case "move":
      yield* afs.writeWithDirs(change.movePath!, Bom.join(change.newContent, change.bom))
      yield* afs.remove(change.filePath)
      updates.push({ file: change.filePath, event: "unlink" })
      updates.push({ file: change.movePath, event: "add" })
      break
    case "delete":
      yield* afs.remove(change.filePath)
      updates.push({ file: change.filePath, event: "unlink" })
      break
  }

  if (edited) {
    if (yield* format.file(edited)) {  // Format post-write
      yield* Bom.syncFile(afs, edited, change.bom)
    }
    yield* events.publish(FileSystem.Event.Edited, { file: edited })
  }
}
```

**Behavior**:
- Writes applied sequentially (no batching)
- Formatter runs per-file after write
- Each write emits FileSystem.Event.Edited
- Watcher.Event.Updated emitted for each change type
- No rollback on late failures (e.g., if formatter fails after 3 files written)

#### Post-Apply Diagnostics (lines 248–268)

```typescript
for (const change of fileChanges) {
  if (change.type === "delete") continue
  const target = change.movePath ?? change.filePath
  yield* lsp.touchFile(target, "document")
}
const diagnostics = yield* lsp.diagnostics()

// Report LSP errors in output
for (const change of fileChanges) {
  if (change.type === "delete") continue
  const target = change.movePath ?? change.filePath
  const block = LSP.Diagnostic.report(target, diagnostics[...] ?? [])
  if (!block) continue
  output += `\n\nLSP errors detected in ${rel}, please fix:\n${block}`
}
```

**Diagnostics** collected post-apply, reported in output (not fatal)

### edit Tool

**File**: `edit.ts`, lines 208–295

#### Concurrency Lock

```typescript
const locks = new Map<string, Semaphore.Semaphore>()

function lock(filePath: string) {
  const resolvedFilePath = FSUtil.resolve(filePath)
  const hit = locks.get(resolvedFilePath)
  if (hit) return hit
  const next = Semaphore.makeUnsafe(1)
  locks.set(resolvedFilePath, next)
  return next
}
```

**Mutual exclusion per file** using Effect Semaphore

#### Apply within Semaphore

```typescript
yield* lock(filePath).withPermits(1)(
  Effect.gen(function* () {
    // File operations here are serialized per-file
    const info = yield* afs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!info) throw new Error(`File ${filePath} not found`)
    
    const source = yield* Bom.readFile(afs, filePath)
    const contentOld = source.text

    const ending = detectLineEnding(contentOld)
    const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending)
    const replacement = convertToLineEnding(normalizeLineEndings(params.newString), ending)

    const next = Bom.split(replace(contentOld, old, replacement, params.replaceAll))
    const desiredBom = source.bom || next.bom
    const contentNew = next.text

    // Permission request
    yield* ctx.ask({
      permission: "edit",
      patterns: [path.relative(instance.worktree, filePath)],
      always: ["*"],
      metadata: { filepath: filePath, diff },
    })

    // Write
    yield* afs.writeWithDirs(filePath, Bom.join(contentNew, desiredBom))
    if (yield* format.file(filePath)) {
      contentNew = yield* Bom.syncFile(afs, filePath, desiredBom)
    }
    yield* events.publish(FileSystem.Event.Edited, { file: filePath })
    yield* events.publish(Watcher.Event.Updated, { file: filePath, event: "change" })
  }).pipe(Effect.orDie)
)
```

**Atomicity per edit call**:
- One file at a time
- Serialized via semaphore
- No rollback support
- If formatter fails, file remains in partially formatted state
- **Note**: Empty oldString special case (lines 228–247) for file creation

---

## 6. Validation

### File-Must-Be-Read-First Tracking

**Status**: **Documented but NOT enforced in code**

**File**: `edit.txt` (model-facing spec, lines 5–6)
```
- You must use your `Read` tool at least once in the conversation before editing. 
  This tool will error if you attempt an edit without reading the file.
```

**Code Reality**: No runtime check exists. The edit tool does not verify that the file has been read via the Read tool. This is a **documentation-only constraint** intended for model guidance.

### External Modification Detection

**Status**: **Not implemented**

No persistent file hash or mtime tracking. Vulnerabilities:
- Concurrent edit (edits can race)
- External process modifies file between read and write
- File deleted/moved by external process

Semaphore only prevents concurrent calls to the same edit tool instance, not external modifications.

### Permission Prompts

**apply_patch**: Single permission request with all file metadata
```typescript
yield* ctx.ask({
  permission: "edit",
  patterns: relativePaths,
  always: ["*"],
  metadata: {
    filepath: relativePaths.join(", "),
    diff: totalDiff,
    files,  // For UI rendering
  },
})
```

**edit**: Per-call permission request
```typescript
yield* ctx.ask({
  permission: "edit",
  patterns: [path.relative(instance.worktree, filePath)],
  always: ["*"],
  metadata: { filepath: filePath, diff },
})
```

**External Directory**: Separate permission if target outside project
```typescript
yield* ctx.ask({
  permission: "external_directory",
  patterns: [glob],
  always: [glob],
  metadata: { filepath: full, parentDir: dir },
})
```

---

## 7. Output/Result Shape & UI Rendering

### apply_patch Result

**File**: `apply_patch.ts`, lines 248–280

```typescript
return {
  title: output,  // e.g., "Success. Updated the following files:\nA nested/new.txt\nD delete.txt\nM modify.txt"
  metadata: {
    diff: totalDiff,  // Unified diff text
    files: [
      {
        filePath: string,
        relativePath: string,
        type: "add" | "update" | "delete" | "move",
        patch: string,  // Per-file unified diff
        additions: number,
        deletions: number,
        movePath?: string,  // Only for move operations
      },
      // ... one per file change
    ],
    diagnostics: Record<string, LSPClient.Diagnostic[]>,  // Post-apply LSP diagnostics
  },
  output: string,  // User-facing summary, may include LSP errors
}
```

**Summary Format**:
- One line per file: `A path/to/file` (add), `D path/to/file` (delete), `M path/to/file` (modify/move)
- LSP errors appended if present

### edit Result

**File**: `edit.ts`, lines 293–311

```typescript
return {
  metadata: {
    diagnostics: Record<string, LSPClient.Diagnostic[]>,
    diff: string,  // Unified diff
    filediff: {
      file: filePath,
      patch: diff,
      additions: number,
      deletions: number,
    },
  },
  title: `${path.relative(instance.worktree, filePath)}`,  // Relative path
  output: "Edit applied successfully." + (LSP errors if present),
}
```

**Diff Format**: Unified diff (from `diff` package's `createTwoFilesPatch`)

### Diff Trimming

**File**: `edit.ts`, lines 721–754

```typescript
export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  
  // Remove common leading indentation from all diff lines
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}
```

**Purpose**: Remove excess common indentation from diff output for readability

---

## 8. Error Messages & Edge Cases

### apply_patch Errors

| Error | Trigger | Code Location |
|-------|---------|---------------|
| `patchText is required` | Empty string param | line 43 |
| `apply_patch verification failed: <parsing error>` | Malformed patch syntax | line 47 |
| `patch rejected: empty patch` | No hunks extracted | line 52 |
| `apply_patch verification failed: no hunks found` | Hunks array empty after parse | line 55 |
| `apply_patch verification failed: Failed to read file to update: <path>` | File not found or is directory | line 79 |
| `apply_patch verification failed: <chunk match error>` | Lines not found in file during chunk application | line 92 |
| LSP errors (non-fatal) | Post-apply diagnostics | line 252+ |

### edit Errors

| Error | Trigger | Code Location |
|-------|---------|---------------|
| `filePath is required` | Missing filePath | line 215 |
| `No changes to apply: oldString and newString are identical.` | Same input & output | line 218 |
| `oldString cannot be empty when editing an existing file...` | Empty oldString on existing file | line 230 |
| `File <path> not found` | File doesn't exist (when oldString not empty) | line 263 |
| `Path is a directory, not a file: <path>` | Target is a directory | line 264 |
| `Could not find oldString in the file. It must match exactly...` | No replacer matched | line 726 |
| `Found multiple matches for oldString. Provide more surrounding context...` | Multiple candidates without replaceAll | line 729 |
| `Refusing replacement because the matched span is much larger than oldString...` | Proportionality check failed | line 723 |
| LSP errors (non-fatal) | Post-apply diagnostics | line 306+ |

### Edge Cases

#### Whitespace & Line Endings

**Line Ending Detection** (`edit.ts` lines 23–32):
```typescript
function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}
```
- Detects CRLF vs LF in source file
- Converts oldString & newString to match source line ending
- Preserves original line ending on write

**Normalization** (`edit.ts` line 22):
```typescript
function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
}
```

#### BOM (Byte Order Mark) Handling

**File**: `/packages/core/src/patch.ts` lines 106–118, 151–161
```typescript
const splitBom = (text: string) =>
  text.startsWith("\uFEFF") ? { bom: true, text: text.slice(1) } : { bom: false, text }

export function joinBom(text: string, bom: boolean) {
  const stripped = splitBom(text).text
  return bom ? `\uFEFF${stripped}` : stripped
}
```

**apply_patch**: 
- Reads BOM flag from source file
- Preserves BOM on write
- Diffs exclude BOM character (test at `test/tool/apply_patch.test.ts` line 198)

**edit**:
- Detects & preserves BOM
- Desired BOM = source BOM OR next BOM (if formatting changes it)

#### Trailing Newline

**apply_patch Add** (`apply_patch.ts` lines 72–74):
```typescript
const newContent =
  hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
```
- Ensures add file content ends with `\n`

**apply_patch Update** (via `Patch.derive()` lines 103–109):
```typescript
if (updated.at(-1) !== "") updated.push("")
const next = splitBom(updated.join("\n"))
return { content: next.text, bom: source.bom || next.bom }
```
- Ensures file ends with newline after applying chunks

#### Empty File Creation

**edit.ts** special case (lines 227–247):
```typescript
if (params.oldString === "") {
  const existed = yield* afs.existsSafe(filePath)
  if (existed) {
    throw new Error(
      "oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement.",
    )
  }
  // Create new file with newString content
  const next = Bom.split(params.newString)
  const desiredBom = next.bom
  contentOld = ""
  contentNew = next.text
  // ... write file
}
```

#### Chunk Matching with Context

**apply_patch** (`patch.ts` lines 123–150):
- Chunk header `@@` may include context description (optional)
- If context line specified, seek performs forward scan for that line first
- Then matches `oldLines` pattern starting after context

#### Insert-Only Hunks

**Test case** (`apply_patch.test.ts` line 202):
```
@@
 alpha
+beta
 omega
```
- No `-` lines; pure insertion
- `oldLines` matches context, `newLines` adds new content

#### Multiple Hunks on Same File

**apply_patch** (`patch.ts` lines 116–122):
- Multiple `@@` chunks supported per file
- Each chunk's oldLines must be found in sequence (lineIndex advances)
- Replacements collected and applied in reverse order to preserve line numbers

#### Move vs Copy

**apply_patch**: Move is Update + Move directive
```
*** Update File: old/path.txt
*** Move to: new/path.txt
@@
```
- Old file deleted after write
- New file created with updated content

#### Directory Creation

**apply_patch** (`apply_patch.ts` lines 204, 217, 223):
```typescript
yield* afs.writeWithDirs(change.filePath, ...)  // Creates parent dirs
```

**edit** (`edit.ts` line 281):
```typescript
yield* afs.writeWithDirs(filePath, ...)
```

Both tools use `writeWithDirs` (from `FSUtil`) to auto-create parent directories

---

## 9. Concurrency & Locking

### File-Level Semaphore

**File**: `edit.ts` lines 36–47

```typescript
const locks = new Map<string, Semaphore.Semaphore>()

function lock(filePath: string) {
  const resolvedFilePath = FSUtil.resolve(filePath)
  const hit = locks.get(resolvedFilePath)
  if (hit) return hit
  const next = Semaphore.makeUnsafe(1)
  locks.set(resolvedFilePath, next)
  return next
}
```

**Behavior**:
- **Per-file**: Each unique resolved path gets its own semaphore
- **Lazy creation**: Semaphore created on first contention
- **Process-level**: Only within single Node.js process (not distributed)
- **Memory leak potential**: Map never clears old locks

### apply_patch Concurrency

**No explicit locking** — relies on filesystem atomicity and Effect sequencing

Potential race condition:
- Thread A and B both call apply_patch on same file
- Both pass preflight (read file, compute chunks)
- Both attempt write concurrently
- Last write wins (undefined final state)

### Formatter Interleaving

**apply_patch** (`apply_patch.ts` lines 209–218):
```typescript
if (edited) {
  if (yield* format.file(edited)) {  // Formatter runs per-file
    yield* Bom.syncFile(afs, edited, change.bom)
  }
  yield* events.publish(FileSystem.Event.Edited, { file: edited })
}
```

**edit** (`edit.ts` line 282):
```typescript
if (yield* format.file(filePath)) {
  contentNew = yield* Bom.syncFile(afs, filePath, desiredBom)
}
```

**Concern**: Formatter may alter file after apply. Diff shown to user != actual final content if formatter changes it.

---

## 10. Summary Table

| Aspect | apply_patch | edit |
|--------|-------------|------|
| **Schema** | `patchText: string` | `filePath, oldString, newString, replaceAll?` |
| **Parser** | Patch format with `***` delimiters | N/A (string matching) |
| **Matching** | 4-pass line-based (exact → rstrip → trim → normalized) | 9-strategy chain (simple → context-aware) |
| **Path Type** | Relative to project (resolved via `instance.directory`) | Absolute or relative |
| **Atomicity** | All-or-nothing per patch (preflight validation) | Per-file semaphore lock |
| **Rollback** | None | None |
| **External Mod Detection** | None | None |
| **Concurrency Control** | None (implicit) | Semaphore per file |
| **Permission Model** | One request for all files | Per-call request |
| **Output** | Diff + per-file metadata | Diff + filediff struct |
| **LSP Integration** | Post-apply diagnostics (non-fatal) | Post-apply diagnostics (non-fatal) |
| **Whitespace Handling** | Line-based trim/normalize | 9 strategies + line-ending detection |
| **BOM Preservation** | Yes | Yes |
| **Trailing Newline** | Enforced | Enforced (via Patch.derive) |

---

## 11. Notable Implementation Sources

The edit tool cites external inspiration:
```typescript
// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts
```

The replacer strategies (`BlockAnchorReplacer`, `LineTrimmedReplacer`, etc.) reflect industry best practices for resilient substring matching in code generation workflows.

---

## 12. Test Coverage

**Test Files**:
- `/packages/opencode/test/tool/apply_patch.test.ts` — 380+ lines
- `/packages/opencode/test/patch/patch.test.ts` — 380+ lines
- `/packages/opencode/test/tool/edit.test.ts` (mentioned but not shown)

**Key Test Scenarios** (from apply_patch.test.ts):
- Add, update, delete in one patch
- Move file with path changes
- Multiple hunks on same file
- BOM file handling (no spurious diffs)
- Insert-only hunks
- Trailing newline appending
- Overwrite on move collision
- Permission metadata verification
- LSP diagnostics in output

---

## 13. Known Limitations & Risks

1. **No Rollback**: Failed write on file 3 of 5 leaves first 2 modified
2. **No Atomic Transactions**: External process can interleave edits
3. **No File-Read-First Enforcement**: Documentation says required, code doesn't check
4. **Semaphore Leak**: edit tool locks never cleared (map grows indefinitely)
5. **Formatter Races**: Final file may differ from shown diff
6. **Proportionality Heuristic**: May reject legitimate fuzzy matches if replacer yields oversized candidate
7. **Context-Aware Replacer Tolerance**: 50% match threshold may catch unintended blocks
8. **No Cross-Process Locking**: Concurrency controlled only within Node.js process

---

## 14. References

- Patch Parser: `/packages/core/src/patch.ts`
- Apply Patch Tool: `/packages/opencode/src/tool/apply_patch.ts`
- Edit Tool: `/packages/opencode/src/tool/edit.ts`
- Tests: `/packages/opencode/test/tool/`, `/packages/opencode/test/patch/`
- External Directory Validation: `/packages/opencode/src/tool/external-directory.ts`
- Tool Framework: `/packages/opencode/src/tool/tool.ts`
