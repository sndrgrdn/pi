# Apply Patch Implementation: Comprehensive Technical Analysis

**Repository:** `/Users/sander/.cache/checkouts/github.com/openai/codex`  
**Key Crates:** `codex-rs/apply-patch/`, `codex-rs/core/src/tools/handlers/`, `codex-rs/core/src/tools/runtimes/`  
**Analysis Date:** 2026-07-12

---

## 1. TOOL SCHEMA & MODEL INVOCATION

### 1.1 Tool Definition
**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/handlers/apply_patch_spec.rs`

The tool is defined as a **Freeform Tool** (not JSON/structured parameters):
```rust
pub fn create_apply_patch_freeform_tool(include_environment_id: bool) -> ToolSpec {
    ToolSpec::Freeform(FreeformTool {
        name: "apply_patch".to_string(),
        description: "Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.".to_string(),
        format: FreeformToolFormat {
            r#type: "grammar".to_string(),
            syntax: "lark".to_string(),
            definition,  // Lark grammar, potentially with `*** Environment ID` clause
        },
    })
}
```

### 1.2 Invocation Forms
**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/invocation.rs`

The model can invoke `apply_patch` via two forms:

#### Direct Invocation (argv form):
```
[cmd, body]  where cmd ∈ {"apply_patch", "applypatch"}
Example:
["apply_patch", "*** Begin Patch\n*** Add File: foo\n+content\n*** End Patch"]
```

#### Shell Heredoc Form (bash/powershell/cmd):
```
["bash", "-lc", "apply_patch <<'EOF'\n*** Begin Patch\n...\n*** End Patch\nEOF"]
["bash", "-c", "apply_patch <<'EOF'\n...\nEOF"]
["powershell.exe", "-Command", "apply_patch <<'EOF'\n...\nEOF"]
["pwsh", "-NoProfile", "-Command", "apply_patch <<'EOF'\n...\nEOF"]
["cmd.exe", "/c", "apply_patch <<'EOF'\n...\nEOF"]
```

With optional `cd` prefix (bash, powershell, cmd only):
```
["bash", "-lc", "cd foo && apply_patch <<'EOF'\n...\n*** End Patch\nEOF"]
```

The connector must be `&&` (not `;`, `||`, or `|`).

**Related code:** `maybe_parse_apply_patch()` at line 85-99; `parse_shell_script()` at line 46-60; Tree-sitter bash query at lines 174-217.

### 1.3 Handler Dispatch
**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/handlers/apply_patch.rs`

Handler routes verified patches to the ApplyPatchRuntime:
- Calls `codex_apply_patch::verify_apply_patch_args()` to validate against filesystem
- Computes required file write permissions
- Delegates to `ApplyPatchRuntime` under orchestrator (approval + sandboxing)

---

## 2. PATCH ENVELOPE GRAMMAR

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/handlers/apply_patch.lark`

### 2.1 Lark Grammar (Canonical Format)
```lark
start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF
```

### 2.2 Extended Grammar (Multi-environment)
When `include_environment_id=true`, the grammar is augmented:
```lark
start: begin_patch environment_id? hunk+ end_patch
environment_id: "*** Environment ID: " filename LF
```
- Optional `*** Environment ID: <id>` line after `*** Begin Patch`
- Only one environment ID allowed; cannot be empty

### 2.3 Key Markers

| Marker | Role | Notes |
|--------|------|-------|
| `*** Begin Patch` | Patch envelope start | Stripped in lenient heredoc mode |
| `*** End Patch` | Patch envelope end | Optional trailing LF |
| `*** Add File: <path>` | File creation hunk | Lines prefixed with `+` |
| `*** Delete File: <path>` | File deletion hunk | No payload |
| `*** Update File: <path>` | File modification hunk | Contains change chunks |
| `*** Move to: <path>` | Rename/relocate within Update | Optional; must follow `*** Update File` |
| `@@` or `@@ <context>` | Change chunk marker | Groups old/new lines within Update |
| ` ` (space prefix) | Context line | Unchanged in both old/new |
| `-` prefix | Old line | Removed from file |
| `+` prefix | New line | Added to file |
| `*** End of File` | Trailing EOF marker | Signals modification at file end |

### 2.4 Patch Structure Example
```
*** Begin Patch
*** Add File: src/hello.txt
+hello
+world
*** Update File: src/config.py
*** Move to: src/settings.py
@@ class Config
-    debug = False
+    debug = True
 # end of config
@@
-old_value
+new_value
*** Delete File: legacy/old.py
*** End Patch
```

---

## 3. PARSING STRATEGY: LENIENT & STRICT MODES

**Files:**
- Core parser: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/parser.rs`
- Streaming parser: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/streaming_parser.rs`

### 3.1 Parse Modes

#### Strict Mode
- Enforces exact `*** Begin Patch` and `*** End Patch` boundaries
- Rejects heredoc wrapper syntax (`<<EOF`, `<<'EOF'`, etc.)
- **Currently disabled globally:** `const PARSE_IN_STRICT_MODE: bool = false;` (line 34, parser.rs)

#### Lenient Mode (Default)
- Primary use case: GPT-4.1 models emit heredoc syntax in function calls
- **Heredoc unwrapping:** Detects and strips `<<EOF`, `<<'EOF'`, `<<\"EOF\"` wrappers
  - First line must be one of: `<<EOF`, `<<'EOF'`, `<<"EOF"`
  - Last line must match pattern `*EOF` (ends with `EOF`)
  - Minimum 4 lines required (2 for markers, 2 for patch content)
- **Fallback logic:** If heredoc strip fails, retries in strict mode
- **Code:** `check_patch_boundaries_lenient()` at lines 125–145; `check_start_and_end_lines_strict()` at lines 147–167

Example lenient input → parsed output:
```rust
Input:  "<<'EOF'\n*** Begin Patch\n*** Add File: foo\n+hi\n*** End Patch\nEOF\n"
Output: ["*** Begin Patch", "*** Add File: foo", "+hi", "*** End Patch"]
```

### 3.2 Streaming Parser
**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/streaming_parser.rs`

Supports incremental parsing for real-time progress:
- **State machine:** `StreamingParserMode` tracks: `NotStarted → StartedPatch → {AddFile|DeleteFile|UpdateFile} → EndedPatch`
- **API:** `push_delta(delta: &str)` consumes character-by-character, returns hunks as they complete
- **Line ending handling:** Normalizes `\r\n` (CRLF) and `\r` by stripping via `line.strip_suffix('\r')`
- **Empty line handling after EOF marker:** Permits trailing whitespace-only lines after `*** End of File`

Key state transitions:
```rust
process_line() match (state) {
    NotStarted if trimmed == "*** Begin Patch" → StartedPatch
    StartedPatch if trimmed == "*** Add File: {path}" → AddFile
    AddFile if line starts with '+' → append to contents
    UpdateFile if trimmed == "@@" or "@@ {context}" → new UpdateFileChunk
    UpdateFile if line starts with ' ', '-', '+' → append to current chunk
    UpdateFile if trimmed == "*** End of File" → mark chunk.is_end_of_file = true
    * if trimmed == "*** End Patch" → EndedPatch
}
```

### 3.3 Line Ending & Whitespace Handling

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/streaming_parser.rs`, line 113–116

```rust
let mut line = std::mem::take(&mut self.line_buffer);
line.truncate(line.strip_suffix('\r').map_or(line.len(), str::len));
```

- Strips trailing `\r` before processing; preserves `\n` semantics
- Permits patch markers to have **whitespace padding** (e.g., `  *** Begin Patch  `)
- Streaming parser uses `line.trim()` for marker detection; preserves raw line for content

### 3.4 Heredoc Extraction
**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/invocation.rs`, lines 174–250

Uses **Tree-sitter Bash query** to extract heredoc from shell scripts. Supports:

1. **Direct form:**
   ```bash
   apply_patch <<'EOF'
   *** Begin Patch
   ...
   *** End Patch
   EOF
   ```

2. **cd + && form:**
   ```bash
   cd /some/path && apply_patch <<'EOF'
   ...
   EOF
   ```

**Constraints:**
- `cd` must be standalone command (no flags, single positional path argument)
- Connector must be `&&` (not `;` or `||`)
- `apply_patch` command name can be `apply_patch` or `applypatch`
- No other top-level commands allowed (e.g., no `echo ... &&` prefix)

**Returns:** `(heredoc_body: String, workdir: Option<String>)`

---

## 4. CONTEXT MATCHING ALGORITHM

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/seek_sequence.rs`

### 4.1 Matching Hierarchy

Function `seek_sequence()` attempts to locate a pattern (`old_lines`) in file content with **progressive relaxation**:

1. **Exact Match (Pass 1)**
   - Line-by-line byte-exact comparison: `lines[i..i+pattern.len()] == pattern`

2. **Right-Strip Match (Pass 2)**
   - Ignores trailing whitespace: `line.trim_end() == pattern.trim_end()`
   - Accounts for inconsistent trailing spaces/tabs

3. **Trim Match (Pass 3)**
   - Ignores leading AND trailing whitespace: `line.trim() == pattern.trim()`
   - Handles indentation variations

4. **Unicode Normalization Match (Pass 4)**
   - Normalizes Unicode punctuation to ASCII equivalents
   - Mappings (lines 45–66):

| Unicode | ASCII | Code Points |
|---------|-------|-------------|
| Dashes | `-` | U+2010–U+2015, U+2212 |
| Single quotes | `'` | U+2018–U+201B |
| Double quotes | `"` | U+201C–U+201F |
| Spaces | ` ` | U+00A0, U+2002–U+200A, U+202F, U+205F, U+3000 |

**Rationale:** Allows ASCII patches to match against source files containing fancy Unicode dashes/quotes (e.g., EN DASH U+2013).

### 4.2 Search Parameters

```rust
fn seek_sequence(
    lines: &[String],      // source file lines (split by \n)
    pattern: &[String],    // old_lines from chunk
    start: usize,          // search start offset
    eof: bool,             // is_end_of_file flag
) -> Option<usize>
```

**start:** Search begins at index `start`, advancing linearly
**eof:** If true, prioritizes matching at file end (EOF anchoring):
```rust
let search_start = if eof && lines.len() >= pattern.len() {
    lines.len() - pattern.len()  // Try end-of-file first
} else {
    start
};
```

If EOF match fails, falls back to linear search from `start`.

### 4.3 Chunk-to-File Reconciliation
**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 636–706

Within `compute_replacements()`:

```rust
for chunk in chunks {
    // A. change_context narrows search location
    if let Some(ctx_line) = &chunk.change_context {
        if let Some(idx) = seek_sequence(original_lines, &[ctx_line], line_index, false) {
            line_index = idx + 1;  // Search continues after context line
        } else {
            return Err(...);  // Context required; failure is fatal
        }
    }

    // B. old_lines matched with progressive leniency
    let mut pattern = &chunk.old_lines;
    let mut found = seek_sequence(original_lines, pattern, line_index, chunk.is_end_of_file);

    // C. EOF-specific retry: strip trailing empty string (file terminator)
    if found.is_none() && pattern.last().is_some_and(String::is_empty) {
        pattern = &pattern[..pattern.len() - 1];
        found = seek_sequence(original_lines, pattern, line_index, chunk.is_end_of_file);
    }

    if let Some(start_idx) = found {
        replacements.push((start_idx, pattern.len(), chunk.new_lines.clone()));
        line_index = start_idx + pattern.len();  // Advance for next chunk
    } else {
        return Err("Failed to find expected lines...");
    }
}
```

**Key behaviors:**
- **change_context (@@) is mandatory** for location if specified; missing raises error
- **old_lines is mandatory** for Update hunks; failure halts application
- **EOF handling:** If chunk has `is_end_of_file=true`, pattern matching prioritizes file end, but falls back to `line_index` search if no EOF match
- **Trailing empty line:** Automatically retried without final empty sentinel (accounts for `\n` representation quirk)

### 4.4 Ambiguity & Uniqueness
- **No ambiguity detection:** First match (earliest `index` in file) is used; no uniqueness guarantee
- **Search is linear:** Once `line_index` advances, prior positions cannot be matched (prevents backward searches)

---

## 5. PATH HANDLING

**Files:**
- Parser: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/parser.rs`
- Invocation: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/invocation.rs`

### 5.1 Relative vs. Absolute Paths

Paths in patch can be **relative or absolute**:

```
*** Add File: config.txt                    # Relative to cwd
*** Update File: /etc/hosts                 # Absolute (platform-native)
*** Delete File: ../sibling/file.py         # Relative with parent ref
```

### 5.2 Path Resolution

**File:** `codex-rs/apply-patch/src/parser.rs`, line 85–91

```rust
impl Hunk {
    pub fn resolve_path(&self, cwd: &PathUri) -> Result<PathUri, PathUriParseError> {
        let path = match self {
            Hunk::UpdateFile { path, .. } => path,
            Hunk::AddFile { .. } | Hunk::DeleteFile { .. } => self.path(),
        };
        cwd.join(&path.to_string_lossy())  // PathUri::join handles relative/absolute
    }
}
```

**cwd Resolution Logic:**

1. **Explicit workdir from `cd` command** (if heredoc parsing):
   - Resolved relative to original `cwd`
   - Updated `cwd = original_cwd.join(&workdir)?`

2. **Hunk paths**:
   - Relative paths: joined with resolved `cwd`
   - Absolute paths: returned as-is (PathUri::join detects and returns absolute unchanged)

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/invocation.rs`, lines 118–125

```rust
let effective_cwd = workdir
    .as_ref()
    .map(|dir| cwd.join(dir))
    .transpose()?
    .unwrap_or_else(|| cwd.clone());
```

### 5.3 Move Destination Paths

For Update hunks with `*** Move to:`, destination is resolved against **effective_cwd**:

```rust
move_path
    .map(|path| effective_cwd.join(&path.to_string_lossy()))
    .transpose()?
```

### 5.4 PathUri Type

`PathUri` is a file URI abstraction supporting both POSIX and Windows paths:
- `from_host_native_path()`: Converts filesystem path to URI
- `to_path_buf()`: Converts back to filesystem path
- `inferred_native_path_string()`: Returns user-facing path representation
- `join()`: Handles relative/absolute joining per platform convention

---

## 6. ATOMICITY & FAILURE HANDLING

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 432–663

### 6.1 Application Model

**Per-file application with committed delta tracking:**

```rust
pub async fn apply_hunks_to_files(
    hunks: &[Hunk],
    cwd: &PathUri,
    fs: &dyn ExecutorFileSystem,
    sandbox: Option<&FileSystemSandboxContext>,
    delta: &mut AppliedPatchDelta,  // Accumulates committed changes
) -> anyhow::Result<AffectedPaths>
```

Changes are applied sequentially. **Not all-or-nothing** at the patch level:
- Each hunk (file operation) is processed in order
- Committed changes are tracked in `delta`
- If a hunk fails, **partial success delta is returned** alongside error

### 6.2 Failure Propagation

When an operation fails:
```rust
macro_rules! try_write {
    ($result:expr) => {
        match $result {
            Ok(value) => value,
            Err(error) => {
                delta.exact = false;  // Mark delta as non-exact
                return Err(anyhow::Error::from(error));
            }
        };
    };
}
```

**delta.exact flag:**
- `true` if all changes were successfully committed and no filesystem quirks occurred
- `false` if:
  - A write operation failed mid-sequence
  - File metadata checks failed (symlinks, directories)
  - Permission issues prevented reading existing content for overwrite detection

### 6.3 Committed Delta Structure

```rust
pub struct AppliedPatchDelta {
    changes: Vec<AppliedPatchChange>,  // Ordered list of committed changes
    exact: bool,                        // Reflects whether delta is complete
}

pub enum AppliedPatchFileChange {
    Add { content: String, overwritten_content: Option<String> },
    Delete { content: String },
    Update {
        move_path: Option<PathBuf>,
        old_content: String,
        overwritten_move_content: Option<String>,
        new_content: String,
    },
}
```

**Fields:**
- `overwritten_content`: Previous content if Add overwrote existing file
- `overwritten_move_content`: Previous content at move destination
- `old_content`: Original file content before Update
- `new_content`: Final file content after Update

### 6.4 Partial Failure Example

**Scenario:** Three-file patch, second write fails due to permission:

```
Hunk 1 (Add):  src/a.txt        ✓ Created
Hunk 2 (Update): src/b.txt      ✗ Permission denied
Hunk 3 (Delete): src/c.txt      (not reached)

Result:
  - ApplyPatchFailure {
      error: IoError { ... },
      delta: AppliedPatchDelta {
        changes: [
          AppliedPatchChange { path: src/a.txt, change: Add { ... } }
        ],
        exact: false
      }
    }
```

The handler uses the delta to report which files were modified before failure.

### 6.5 Move Operation Atomicity Risk

Move (Update with `*** Move to:`) is **not atomic**:

1. Write new content to destination
2. Remove source file

If step 2 fails (e.g., locked source):
```rust
if let Err(error) = fs.remove(&path_uri, ...) {
    delta.exact &= remove_failure_was_side_effect_free(...).await;
    return Err(error);
}
```

The destination file is left in place; source remains. Delta includes the destination write as committed.

### 6.6 Preflight Checks

**No explicit preflight validation.** Verification happens inline:

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/invocation.rs`, lines 102–141

```rust
async fn try_verify_apply_patch_args(...) -> Result<ApplyPatchAction, ApplyPatchError> {
    for hunk in hunks {
        match hunk {
            Hunk::AddFile { contents, .. } => {
                // No check: file may or may not exist
                changes.insert(path, ApplyPatchFileChange::Add { content: contents });
            }
            Hunk::DeleteFile { .. } => {
                let content = fs.read_file_text(&path, sandbox).await?;  // Checks existence
                changes.insert(path, ApplyPatchFileChange::Delete { content });
            }
            Hunk::UpdateFile { chunks, .. } => {
                let ApplyPatchFileUpdate { unified_diff, content, .. } =
                    unified_diff_from_chunks(&path, &chunks, fs, sandbox).await?;
                // ↑ Reads file, validates chunk matching
                changes.insert(...);
            }
        }
    }
}
```

Verification reads files and validates patch applicability **during verification**, not just at execution time.

---

## 7. ERROR REPORTING & MESSAGE SHAPE

**Files:**
- Error types: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 27–80
- Parser errors: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/parser.rs`, lines 60–68
- Handler: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/handlers/apply_patch.rs`

### 7.1 Error Type Hierarchy

```rust
pub enum ApplyPatchError {
    ParseError(ParseError),
    IoError(IoError),
    ComputeReplacements(String),
    PathUri(PathUriParseError),
    ImplicitInvocation,
}

pub enum ParseError {
    InvalidPatchError(String),
    InvalidHunkError { message: String, line_number: usize },
}

pub struct IoError {
    context: String,
    source: std::io::Error,
}

pub struct ApplyPatchFailure {
    error: ApplyPatchError,
    delta: AppliedPatchDelta,  // Partial success
}
```

### 7.2 Error Messages Sent to Model

Handler reports errors via `FunctionCallError::RespondToModel(msg)`:

```rust
match codex_apply_patch::verify_apply_patch_args(...).await {
    MaybeApplyPatchVerified::Body(changes) => { /* success */ }
    MaybeApplyPatchVerified::CorrectnessError(parse_error) => {
        Err(FunctionCallError::RespondToModel(format!(
            "apply_patch verification failed: {parse_error}"
        )))
    }
    MaybeApplyPatchVerified::ShellParseError(error) => {
        Err(FunctionCallError::RespondToModel(
            "apply_patch handler received invalid patch input".to_string(),
        ))
    }
    MaybeApplyPatchVerified::NotApplyPatch => {
        Err(FunctionCallError::RespondToModel(
            "apply_patch handler received non-apply_patch input".to_string(),
        ))
    }
}
```

### 7.3 Execution Stderr Messages

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 318–349

During execution, errors are written to stderr:

```rust
match parse_patch(patch) {
    Ok(source) => source.hunks,
    Err(e) => {
        match &e {
            InvalidPatchError(message) => {
                writeln!(stderr, "Invalid patch: {message}")?;
            }
            InvalidHunkError { message, line_number } => {
                writeln!(stderr, "Invalid patch hunk on line {line_number}: {message}")?;
            }
        }
        return Err(ApplyPatchFailure::without_delta(...));
    }
}
```

### 7.4 Specific Error Message Examples

| Condition | Error Message |
|-----------|---------------|
| Missing begin marker | `"The first line of the patch must be '*** Begin Patch'"` |
| Missing end marker | `"The last line of the patch must be '*** End Patch'"` |
| Empty update hunk | `"Update file hunk for path 'file.py' is empty"` |
| Context line not found | `"Failed to find context 'def foo():' in file.py"` |
| Old lines mismatch | `"Failed to find expected lines in file.py:\n<old_lines_text>"` |
| File read failure | `"Failed to read file to update /path/to/file: <io_error>"` |
| File write failure | `"Failed to write file /path/to/file: <io_error>"` |
| Delete non-existent file | `"Failed to delete file /path/to/file: No such file or directory"` |
| Delete directory | `"Failed to delete file /path/to/dir: path is a directory"` |
| Implicit invocation | `"patch detected without explicit call to apply_patch. Rerun as [\"apply_patch\", \"<patch>\"]"` |
| Environment ID empty | `"apply_patch environment_id cannot be empty"` |
| Environment ID duplicate | `"apply_patch environment_id cannot be specified more than once"` |

---

## 8. RESULTS & DIFFS: REPORTING TO MODEL & UI

**Files:**
- Handler: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/handlers/apply_patch.rs`
- Runtime: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/runtimes/apply_patch.rs`
- Protocol conversion: `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 801–856

### 8.1 Execution Output Shape

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/runtimes/apply_patch.rs`, lines 163–197

```rust
pub struct ApplyPatchRuntimeOutput {
    pub exec_output: ExecToolCallOutput,
    pub delta: AppliedPatchDelta,
}

// ExecToolCallOutput:
pub struct ExecToolCallOutput {
    pub exit_code: i32,                    // 0 = success, 1 = failure
    pub stdout: StreamOutput,              // Stdout from apply_patch binary
    pub stderr: StreamOutput,              // Stderr (error messages or logs)
    pub aggregated_output: StreamOutput,   // stdout + stderr combined
    pub duration: Duration,                // Execution time
    pub timed_out: bool,                   // Timeout flag
}
```

### 8.2 Success Output (stdout)

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 817–831

Printed via `print_summary()`:

```rust
pub fn print_summary(affected: &AffectedPaths, out: &mut impl io::Write) -> io::Result<()> {
    writeln!(out, "Success. Updated the following files:")?;
    for path in &affected.added {
        writeln!(out, "A {}", path.display())?;
    }
    for path in &affected.modified {
        writeln!(out, "M {}", path.display())?;
    }
    for path in &affected.deleted {
        writeln!(out, "D {}", path.display())?;
    }
    Ok(())
}
```

**Example stdout:**
```
Success. Updated the following files:
A src/hello.txt
M README.md
D legacy/old.py
```

### 8.3 Streaming Progress Events

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/handlers/apply_patch.rs`, lines 57–98

When feature `ApplyPatchStreamingEvents` is enabled, the tool emits progress as patch arguments arrive:

```rust
fn consume_diff(&mut self, turn: &TurnContext, call_id: String, diff: &str) -> Option<EventMsg> {
    if !turn.config.features.enabled(Feature::ApplyPatchStreamingEvents) {
        return None;
    }
    self.push_delta(call_id, diff).map(EventMsg::PatchApplyUpdated)
}
```

Events include:
```rust
pub struct PatchApplyUpdatedEvent {
    pub call_id: String,
    pub changes: HashMap<PathBuf, FileChange>,  // Partial hunks so far
}

pub enum FileChange {
    Add { content: String },
    Delete { content: String },
    Update {
        unified_diff: String,      // Formatted change chunks
        move_path: Option<PathBuf>,
    },
}
```

**Diff format for Update:**
```
@@ [context_line]
-old_line_1
+new_line_1
-old_line_2
+new_line_2
*** End of File
```

### 8.4 Unified Diff Generation

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 766–805

```rust
pub async fn unified_diff_from_chunks_with_context(
    path: &PathUri,
    chunks: &[UpdateFileChunk],
    context: usize,  // context_radius (default: 1)
    fs: &dyn ExecutorFileSystem,
    sandbox: Option<&FileSystemSandboxContext>,
) -> Result<ApplyPatchFileUpdate, ApplyPatchError> {
    let AppliedPatch {
        original_contents,
        new_contents,
    } = derive_new_contents_from_chunks(path, chunks, fs, sandbox).await?;
    
    let text_diff = TextDiff::from_lines(&original_contents, &new_contents);
    let unified_diff = text_diff.unified_diff()
        .context_radius(context)
        .to_string();
    
    Ok(ApplyPatchFileUpdate {
        unified_diff,
        original_content: original_contents,
        content: new_contents,
    })
}
```

Uses the `similar` crate's `TextDiff` to generate standard unified diff format with configurable context lines.

### 8.5 Post-Execution Protocol Report

Handler converts committed delta to protocol representation:

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/apply-patch/src/lib.rs`, lines 834–860

```rust
pub fn convert_apply_patch_to_protocol(
    committed: &AppliedPatchDelta,
) -> ApplyPatchDeltaProtocol {
    ApplyPatchDeltaProtocol {
        exact: committed.is_exact(),
        changes: committed.changes().iter().map(|change| {
            match &change.change {
                AppliedPatchFileChange::Add { content, overwritten_content } => {
                    FileChangeProtocol::Add {
                        path: change.path.clone(),
                        content: content.clone(),
                        overwritten: overwritten_content.clone(),
                    }
                }
                AppliedPatchFileChange::Delete { content } => {
                    FileChangeProtocol::Delete {
                        path: change.path.clone(),
                        content: content.clone(),
                    }
                }
                AppliedPatchFileChange::Update { ... } => {
                    // Includes old_content, new_content, move details
                }
            }
        }).collect(),
    }
}
```

### 8.6 Model-Facing Output

**File:** `/Users/sander/.cache/checkouts/github.com/openai/codex/codex-rs/core/src/tools/context.rs` (referenced in handler)

Tool output wrapper:
```rust
pub struct ApplyPatchToolOutput { /* ... */ }

impl ApplyPatchToolOutput {
    pub fn from_text(text: String) -> Self { /* ... */ }
}
```

The text content (stdout + stderr from execution) is returned to the model as the tool call result.

---

## 9. SUMMARY TABLE: Key Components

| Component | File Path | Key Functions |
|-----------|-----------|---------------|
| **Core Library** | `codex-rs/apply-patch/src/lib.rs` | `apply_patch()`, `apply_hunks()`, `compute_replacements()`, `print_summary()` |
| **Parser** | `codex-rs/apply-patch/src/parser.rs` | `parse_patch()`, `check_patch_boundaries_lenient()`, `Hunk::resolve_path()` |
| **Streaming Parser** | `codex-rs/apply-patch/src/streaming_parser.rs` | `StreamingPatchParser::push_delta()`, state machine transitions |
| **Context Matching** | `codex-rs/apply-patch/src/seek_sequence.rs` | `seek_sequence()` with 4-pass matching hierarchy |
| **Invocation** | `codex-rs/apply-patch/src/invocation.rs` | `maybe_parse_apply_patch_verified()`, `extract_apply_patch_from_bash()` (Tree-sitter) |
| **Handler** | `codex-rs/core/src/tools/handlers/apply_patch.rs` | `ApplyPatchHandler::handle_call()`, `intercept_apply_patch()` |
| **Runtime** | `codex-rs/core/src/tools/runtimes/apply_patch.rs` | `ApplyPatchRuntime::run()`, approval flow, sandboxing |
| **Spec/Grammar** | `codex-rs/core/src/tools/handlers/apply_patch.{spec.rs,lark}` | Lark grammar definition, freeform tool spec |

---

## 10. APPENDIX: Notable Edge Cases & Design Decisions

### 10.1 Trailing Empty Line Semantics
**Problem:** When files are split by `\n`, the trailing newline yields an empty final element.

**Solution:** Parser **strips the trailing empty element** from split lines:
```rust
let mut original_lines: Vec<String> = original_contents.split('\n').collect();
if original_lines.last().is_some_and(String::is_empty) {
    original_lines.pop();
}
```

This means chunk patterns with trailing empty strings (representing EOF newlines) are automatically retried without the sentinel:
```rust
if found.is_none() && pattern.last().is_some_and(String::is_empty) {
    pattern = &pattern[..pattern.len() - 1];
    found = seek_sequence(...);
}
```

### 10.2 Unicode Normalization
Patch lines authored with ASCII dashes can match source files with fancy Unicode dashes (EN DASH, etc.) due to the 4th pass normalization. This mirrors `git apply` behavior.

### 10.3 Change Context is Required (if present)
If a chunk specifies `change_context` (the `@@ ...` line), it **must be found** in the file or the patch fails. This anchors chunk application to specific function/class definitions.

### 10.4 Relative Path Handling in cd
When using `cd <path> &&` in heredoc, the path is **not** shell-evaluated; it's extracted as a literal string and joined with the original cwd via PathUri::join(). No symlink resolution or environment variable expansion occurs.

### 10.5 No Dry-Run Mode
The implementation has **no dry-run or preview mode**. Verification (verify_apply_patch_args) performs chunk matching and generates unified diffs for inspection, but execution is fully committed to filesystem.

---

**End of Report**
