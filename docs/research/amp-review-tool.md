# `amp review`: reverse-engineering reference

> **Scope.** This document describes the implementation embedded in one exact Amp CLI binary. It is a reimplementation reference, not a claim about a stable public API. Every `amp-strings.txt:<line>` coordinate refers only to the extraction from this binary version; later or earlier binaries can minify, reorder, duplicate, or replace the code.

## 1. Provenance and method

The inspected executable is `~/.local/bin/amp`, a symlink to `/Users/sander/.amp/bin/amp`. It is a Bun-compiled Mach-O arm64 executable of **71,371,874 bytes** (SHA-256 `0c196ba7c3d4d1786de8f73921034726b8bc3489785392c4273343a8b438b21a`). `amp --version` reports `0.0.1784751724-g9d1cfb (released 2026-07-22T20:22:04.000Z, 3d ago)`. The embedded constants identify the same version and a build timestamp of `2026-07-22T20:28:22.099Z`. The release timestamp is runtime release metadata; the version and build timestamp are embedded. (`amp-strings.txt:291470`, `amp-strings.txt:291992`)

The executable contains its minified JavaScript bundle as plaintext. It was extracted with `strings -a` to `/tmp/amp-strings.txt`, which is **14,052,496 bytes / 297,013 physical lines**. Relevant fragments were sliced with `sed`, bounded Perl searches, and `cut`; selected slices were reformatted with `bunx js-beautify`. Beautification is explanatory only: all quoted source below was checked against the raw strings extraction. (`amp-strings.txt:291860-291898`, `amp-strings.txt:295122`)

The CLI review module starts partway through `amp-strings.txt:291860` and ends at the start of `amp-strings.txt:291898`. The minified slice from `e30` through `E30` is 17,665 bytes and 38 strings-file lines; `js-beautify` expands it to about 399 lines. It defines 38 top-level functions plus two nested helpers. Schemas and constants are emitted elsewhere in the bundle (`amp-strings.txt:292310`, `amp-strings.txt:293291`, `amp-strings.txt:295783`), while the TUI renderer and mode table are separate (`amp-strings.txt:291034-291035`, `amp-strings.txt:295122`).

Minified names are not semantic or stable. This document retains each observed name but assigns a descriptive alias, for example `E30 → registerReviewCommand`. The following table covers the local module's substantive top-level functions. (`amp-strings.txt:291860-291898`)

## 2. Architecture overview

There are three layers:

1. **Local CLI orchestrator.** Parses `amp review`, detects Git or Jujutsu, optionally pre-discovers checks, builds one user message, runs a hidden review-mode thread, reconstructs tool results from the completed transcript, renders output, and normally archives the thread. (`amp-strings.txt:291860-291898`)
2. **Review agent mode.** A hidden mode named `review`, using GPT-5.5 when the abuse-data-retention feature flag is enabled and GPT-5.4 otherwise. It receives `shell_command`, `run_check`, `submit_review`, and thread/mode discovery tools. (`amp-strings.txt:295122`)
3. **Server-side tools/check subagents.** `run_check`, `submit_check`, and `submit_review` are recognized tool names and members of the server-tool set, but their tool implementations and prompts are absent from the binary. The local CLI only prompts for calls and parses their transcript results. (`amp-strings.txt:292185`, `amp-strings.txt:295122`)

### End-to-end call stack

| Observed symbol | Descriptive alias | Role |
|---|---|---|
| `E30` | `registerReviewCommand` | Registers the Commander command, permission guard, archive policy, error handling, and final exit. |
| `I30` | `configureReviewCLI` | Adds the argument, options, validator, and help text. |
| `D30` | `normalizeDiffDescription` | Joins variadic words or defaults to `Z30`, `"uncommitted changes"`. |
| `Y30` | `parseThinkingLevel` | Accepts only `low` or `high`. |
| `y30` | `executeReview` | Main local orchestration and thread execution. |
| `d30` | `detectRepository` | Tries Git, then Jujutsu. |
| `f30` | `relativizeFocusFiles` | Resolves CLI paths from CWD and makes them repository-relative. |
| `g30` | `preDiscoverChecks` | Runs local check discovery only for `--files` or `--check-scope`. |
| `s30` | `discoverChecksForFiles` | Groups files by directory and computes all/per-file checks. |
| `r30` | `discoverChecksFromAncestors` | Walks ancestor `.agents/checks` directories and then global directories. |
| `g9T` | `addChecksFromDirectory` | Loads one check directory and deduplicates by check name. |
| `t30` | `globalCheckDirectories` | Returns `<userConfigDir>/amp/checks` and `/agents/checks`. |
| `_30` | `readCheckDirectory` | Reads Markdown checks and constructs check objects. |
| `e30` | `parseCheckFrontmatter` | Splits YAML frontmatter from body and normalizes selected fields. |
| `c30` | `formatCheckScope` | Returns `global` or the directory URI string. |
| `C30` | `buildReviewPrompt` | Assembles the complete user message. |
| `v30` | `buildCheckPromptBlock` | Emits empty/non-empty pre-discovery instructions. |
| `u30` | `createSpinner` | TTY-only 80 ms ASCII spinner. |
| `M30` | `collectSubmitReviewToolUseIDs` | Finds all assistant `submit_review` tool-use IDs. |
| `H30` | `extractSubmitReviewResult` | Finds the latest completed matching tool result and validates it. |
| `w30` | `extractCheckRuns` | Matches `run_check` calls/results and creates per-URI states. |
| `b30` / `W30` / `j30` | `parseCheckURI` / `nameFromCheckURI` / `frontmatterFromToolInput` | Synthesize a check when a run was not pre-discovered. |
| `N30` | `parseCheckResult` | Tries structured Zod parsing, then XML fallback. |
| `K30` | `normalizeStructuredCheckResult` | Resolves paths and creates normalized issues. |
| `l30` | `parseXMLCheckResult` | Parses the legacy/fallback `<checkResult>` protocol. |
| `Os` / `o30` | `extractXMLTag` / `unescapeXMLText` | Exact-tag extraction and five-entity decoding. |
| `n30` | `checkIssuesToReviewComments` | Converts normalized check issues to review comments. |
| `x30` | `renderHumanReview` | Drops low severity, renders comments and check summary. |
| `V30` | `renderComments` | Groups by file and emits VS Code OSC-8 links. |
| `G30` | `renderCheckSummary` | Renders done/error/in-progress check lines. |
| `L30` / `z30` / `C9T` | `renderJSONToString` / `writeSuccessJSON` / `writeErrorJSON` | Structured output. |
| `X30` / `F30` | `groupJSONCommentsByFile` / `flattenJSONChecks` | Builds the JSON `files` and `checks` arrays. |

The full flow is:

```text
argv
  → E30/registerReviewCommand
  → I30/configureReviewCLI
  → D30/normalizeDiffDescription
  → legacy-permissions guard
  → y30/executeReview
      → d30/detectRepository
      → f30/relativizeFocusFiles
      → g30/preDiscoverChecks
          → s30 → r30 → g9T → _30 → e30
      → u30/createSpinner
      → C30 + v30/buildReviewPrompt
      → qCT(thread executor, agentMode="review")
      → H30 + M30/extract submit_review
      → w30 → N30 → K30 or l30/extract checks
      → n30/convert check issues
      → x30 → V30 + G30, or L30 → z30 → X30 + F30
  → optional archiveThread
  → process.exit(0 | 1); SIGINT exits 130
```

This ordering and the mechanical merge are visible directly in `y30`; archive and process-exit behavior live one level above in `E30`. (`amp-strings.txt:291860-291863`, `amp-strings.txt:291897-291898`)

## 3. CLI interface

### Registration, argument, and options

The command description is verbatim: (`amp-strings.txt:291897`)

```text
Run code review through the review agent mode
```

The complete review-specific argument and option chain is: (`amp-strings.txt:291883`)

```js
function I30(T){return T.argument("[diff_description...]","Description of the diff or changes to review (default: uncommitted changes)").option("-f, --files <files...>","Specific files to focus the review on").option("-i, --instructions <text>","Additional instructions to guide the review").option("-s, --check-scope <dir>","Directory to search for checks").option("-c, --check-filter <checks...>","Specific check names to run").option("--checks-only","Only run checks, skip independent main-review findings").option("--json","Output structured JSON instead of human-readable text").option("--thinking <level>",'Thinking level: "low" (default) or "high"',Y30)
```

The variadic positional argument is joined with spaces and defaults when missing or whitespace-only: (`amp-strings.txt:291883`, `amp-strings.txt:293291`)

```js
function D30(T){let R=T?.join(" ").trim();return R&&R.length>0?R:Z30}
Z30="uncommitted changes"
```

Although the help says `low` is the default, `I30` supplies no Commander default; the option is absent unless explicitly passed. The review agent mode itself has `reasoningEffort:"medium"`. The validator accepts exactly two strings: (`amp-strings.txt:291883`, `amp-strings.txt:295122`)

```js
function Y30(T){if(T==="low"||T==="high")return T;throw new gR(`Invalid thinking level "${T}". Expected "low" or "high".`,1)}
```

### `addHelpText` body

Verbatim, including the source's alignment on the `--thinking low` example: (`amp-strings.txt:291883-291897`)

```text
The diff_description tells the tool what changes to review. It can be:
  - A git or jj command: "git diff HEAD~3" or "jj diff --git"
  - A commit range: "main..HEAD" or "HEAD~1"
  - A natural language description: "uncommitted changes in server/src"
  - Empty (defaults to reviewing uncommitted changes)
Examples:
  amp review                                    # review uncommitted changes
  amp review "HEAD~1"                           # review the last commit
  amp review "main...HEAD"                      # review all commits since HEAD diverged from main
  amp review "git diff HEAD" --files server/    # focus on specific directory
  amp review --instructions "focus on security" # add review focus
  amp review --thinking low                       # run a faster, less thorough review
  amp review "HEAD~3" -i "check error handling" -f src/api.ts
```

### Legacy-permissions refusal and exits

If `settings.dangerouslyAllowAll === false`, the command refuses to run. Human output adds `Error: `; JSON places the same underlying message in `error`: (`amp-strings.txt:291897`)

```text
The review command does not support legacy permissions. Remove the `amp.dangerouslyAllowAll: false` setting from your settings.
```

The complete human line is:

```text
Error: The review command does not support legacy permissions. Remove the `amp.dangerouslyAllowAll: false` setting from your settings.
```

The process exits **0** after successful rendering (and successful default archiving), **1** for the legacy-permissions refusal, validation/Commander errors, execution errors, or archive errors, and **130** on SIGINT. Human execution failures are prefixed with `Error running review: `; JSON failures use the error envelope. (`amp-strings.txt:291860-291862`, `amp-strings.txt:291897-291898`)

## 4. Types and schemas

### Verbatim Zod declarations

All review-specific Zod declarations are emitted together: (`amp-strings.txt:295783`)

```js
p30=N.enum(["bug","suggested_edit","compliment","non_actionable","unknown"]),m30=N.enum(["critical","high","medium","low"]),O30=N.object({filename:N.string(),startLine:N.number(),endLine:N.number(),text:N.string(),commentType:p30.optional(),severity:m30.optional(),source:N.string().optional(),why:N.string().optional(),fix:N.string().optional()}),q30=N.object({comments:N.array(O30)}),k30=T30(A90),S30=N.object({severity:N.enum(["low","medium","high","critical"]),file:N.string(),line:N.number().optional(),endLine:N.number().optional(),problem:N.string(),why:N.string().optional(),fix:N.string().optional()}),P30=N.object({checkName:N.string(),status:N.enum(["completed","error"]),filesAnalyzed:N.number().optional(),linesAnalyzed:N.number().optional(),patternsChecked:N.array(N.string()).optional(),issues:N.array(S30),errorMessage:N.string().optional()})
```

### Clean TypeScript rendering

```ts
type CommentType =
  | "bug"
  | "suggested_edit"
  | "compliment"
  | "non_actionable"
  | "unknown";

type Severity = "critical" | "high" | "medium" | "low";

interface ReviewComment {
  filename: string;
  startLine: number;
  endLine: number;
  text: string;
  commentType?: CommentType;
  severity?: Severity;
  source?: string;
  why?: string;
  fix?: string;
}

interface SubmitReviewResult {
  comments: ReviewComment[];
}

interface CheckIssue {
  severity: "low" | "medium" | "high" | "critical";
  file: string;
  line?: number;
  endLine?: number;
  problem: string;
  why?: string;
  fix?: string;
}

interface StructuredCheckResult {
  checkName: string;
  status: "completed" | "error";
  filesAnalyzed?: number;
  linesAnalyzed?: number;
  patternsChecked?: string[];
  issues: CheckIssue[];
  errorMessage?: string;
}
```

`ReviewComment.startLine` and `endLine` are required even though check issues can omit line information. Conversion supplies zeroes in that case. `ReviewComment.severity` is optional, so a comment with no severity survives the human low-severity filter. The structured check result's `checkName` is required for validation but normalization names the result from the matched check object instead. (`amp-strings.txt:291860`, `amp-strings.txt:291879`, `amp-strings.txt:295783`)

### Check file/frontmatter and discovered-check shapes

There is no Zod schema for check frontmatter. YAML is parsed and projected into this effective shape: (`amp-strings.txt:291860`)

```ts
interface CheckFrontmatter {
  name: string;
  description?: string;
  "severity-default"?: unknown;
  tools?: string[];
}

interface DiscoveredCheck {
  uri: string;       // file:// URI in practice
  name: string;
  scope: "global" | string; // directory URI for a repo-local check
  frontmatter: CheckFrontmatter;
  content: string;   // body after valid frontmatter; otherwise whole file
}
```

For locally read files, `severity-default` is copied without validation. For checks synthesized from a `run_check` input, `j30` only preserves `low | medium | high | critical`; it also filters `tools` to strings. (`amp-strings.txt:291860`, `amp-strings.txt:291879`)

### Internal check-run and JSON output shapes

The completed transcript is normalized approximately as follows: (`amp-strings.txt:291879-291883`)

```ts
interface NormalizedCheckIssue extends CheckIssue {
  check: string;
  file: string;       // absolute after normalization
  source: string;
}

interface NormalizedCheckResult {
  check: DiscoveredCheck;
  result: {
    name: string;
    status: "completed" | "error";
    filesAnalyzed?: number;
    linesAnalyzed?: number;
    patternsChecked?: string[];
    issuesFound: number;
    errorMessage?: string;
  };
  issues: NormalizedCheckIssue[];
}

type CheckRunState =
  | { status: "done"; result: NormalizedCheckResult }
  | { status: "error"; error: string }
  | { status: "in-progress"; message: string };
```

Success and error JSON are pretty-printed with two-space indentation and a final newline: (`amp-strings.txt:291880-291883`)

```ts
interface ReviewJSONSuccess {
  error: null;
  comments: ReviewComment[];
  files: Array<{ path: string; comments: ReviewComment[] }>;
  checks: Array<
    | {
        uri: string;
        name: string;
        status: "done";
        issueCount: number;
        issues: NormalizedCheckIssue[];
      }
    | {
        uri: string;
        name: string;
        status: "error";
        error: string;
        issueCount: null;
        issues: [];
      }
    | {
        uri: string;
        name: string;
        status: "in-progress";
        message: string;
        issueCount: null;
        issues: [];
      }
  >;
}

interface ReviewJSONError {
  error: string;
  comments: [];
  files: [];
  checks: [];
}
```

`F30` supports an in-progress JSON variant, although the post-completion transcript mapper in `w30` only explicitly produces done and error states; in-progress is also meaningful to the separate live TUI renderer. (`amp-strings.txt:291879`, `amp-strings.txt:291883`, `amp-strings.txt:291035`)

## 5. Prompt construction

`C30` creates an array, drops falsey conditional entries, and joins every retained segment with exactly one newline. The complete minified constructor is quoted here so ordering and punctuation are unambiguous: (`amp-strings.txt:291863-291869`)

```js
function C30(T){return[T.repositoryKind==="jj"?"Repository type detected: Jujutsu (jj). Use jj commands, not git commands, to inspect the diff. For the default working-copy review, use `jj diff --git` and `jj diff --name-only`.":"Repository type detected: Git. Use git commands to inspect the diff.",`Review this diff: ${T.diffDescription}`,"Before submitting the final review, inspect the diff yourself and determine the changed files. Then discover applicable repo-local code-review checks for those changed files: look for .agents/checks/*.md in each changed file's directory and each ancestor up to the repository root, including the repository root. For every applicable check, call run_check once with the exact file:// URI, checkName from the check frontmatter name or filename, this diff description, relevant changed files, parsed frontmatter when available, and a concise outcome-first instructions brief. Convert absolute check paths to file:// URIs. Call independent run_check tools in the same assistant turn when possible so they can run concurrently.",T.files&&T.files.length>0?`Focus on these files:
${T.files.join(`
`)}`:void 0,T.instructions?.trim()?`Additional instructions from the user:
${T.instructions.trim()}`:void 0,T.checkFilter&&T.checkFilter.length>0?`Only run review checks with these names:
${T.checkFilter.join(`
`)}`:void 0,T.checksOnly?"Only report issues found by checks; call submit_review with an empty comments array because the CLI appends structured run_check results mechanically.":void 0,T.thinking?`Review depth requested by user: ${T.thinking}.`:void 0,v30(T.checks,T.diffDescription,T.files??[]),"Remember: call submit_review exactly once. Do not include run_check findings in submit_review; the CLI appends structured check findings mechanically."].filter((R)=>Boolean(R)).join(`
`)}
```

In assembled order, the segments and conditions are:

1. **Always, repository kind = jj:**

   ```text
   Repository type detected: Jujutsu (jj). Use jj commands, not git commands, to inspect the diff. For the default working-copy review, use `jj diff --git` and `jj diff --name-only`.
   ```

   **Otherwise (Git):**

   ```text
   Repository type detected: Git. Use git commands to inspect the diff.
   ```

2. **Always:**

   ```text
   Review this diff: ${diffDescription}
   ```

3. **Always:**

   ```text
   Before submitting the final review, inspect the diff yourself and determine the changed files. Then discover applicable repo-local code-review checks for those changed files: look for .agents/checks/*.md in each changed file's directory and each ancestor up to the repository root, including the repository root. For every applicable check, call run_check once with the exact file:// URI, checkName from the check frontmatter name or filename, this diff description, relevant changed files, parsed frontmatter when available, and a concise outcome-first instructions brief. Convert absolute check paths to file:// URIs. Call independent run_check tools in the same assistant turn when possible so they can run concurrently.
   ```

4. **When `files.length > 0`; one path per following line:**

   ```text
   Focus on these files:
   ${files.join("\n")}
   ```

5. **When trimmed `instructions` is non-empty:**

   ```text
   Additional instructions from the user:
   ${instructions.trim()}
   ```

6. **When `checkFilter.length > 0`; one name per following line:**

   ```text
   Only run review checks with these names:
   ${checkFilter.join("\n")}
   ```

7. **When `checksOnly` is true:**

   ```text
   Only report issues found by checks; call submit_review with an empty comments array because the CLI appends structured run_check results mechanically.
   ```

8. **When `thinking` is present:**

   ```text
   Review depth requested by user: ${thinking}.
   ```

9. **Always, `v30` output.** With no pre-discovered checks:

   ```text
   No review checks were pre-discovered by the CLI. Discover applicable .agents/checks/*.md files yourself before submitting the final review.
   ```

   With at least one pre-discovered check, the whole block is: (`amp-strings.txt:291869-291879`)

   ```text
   Pre-discovered review checks are listed below. Also discover any additional applicable .agents/checks/*.md files for the changed paths before finalizing the review. Call run_check once per applicable check. Do not pass check content; run_check resolves checkURI and includes the parsed check definition in the check agent's invocation context when possible. Use this argument shape for each check:
     "checkName": "...",
     "checkURI": "...",
     "frontmatter": { ... },
     "diffDescription": ${JSON.stringify(diffDescription)},
     "files": ${JSON.stringify(files)},
     "instructions": "Outcome-first brief for the check agent: goal, diff scope, relevant changed files, and constraints. Do not tell the check agent to read the checkURI unless the invocation context lacks checkContent."
   <check name=${JSON.stringify(check.name)} uri=${JSON.stringify(check.uri)}>
   <frontmatter>${JSON.stringify(check.frontmatter)}</frontmatter>
   </check>
   ```

   The six argument lines are deliberately only a shape snippet: the emitted text has no surrounding braces. One `<check>` block is emitted per pre-discovered check, separated by a newline. Check content is deliberately omitted.

10. **Always, final line:**

    ```text
    Remember: call submit_review exactly once. Do not include run_check findings in submit_review; the CLI appends structured check findings mechanically.
    ```

The first eight segment texts and final invariant are from `C30`; both check-list variants are from `v30`. (`amp-strings.txt:291863-291879`)

## 6. Review agent mode

The exact mode definition in the relevant bundle copy is: (`amp-strings.txt:295122`)

```js
REVIEW:{key:"review",displayName:"Review",description:"Run a code review directly on the thread actor",model:[{when:{featureFlag:$6.ACCEPT_ABUSE_DATA_RETENTION},model:B8("GPT_5_5"),systemPrompt:"review"},{model:B8("GPT_5_4"),systemPrompt:"review"}],systemPrompt:"review",includeTools:l1T,visible:!1,reasoningEffort:"medium"}
```

Its exact included tool list is: (`amp-strings.txt:295122`)

```js
l1T=["shell_command","run_check","submit_review","list_agent_modes","list_runners","create_thread"]
```

Model selection is first-match/fallback: GPT-5.5 under `ACCEPT_ABUSE_DATA_RETENTION`, otherwise GPT-5.4. Both model entries and the mode itself select the named system prompt `review`; the prompt body is not embedded in this binary. The mode is hidden (`visible:!1`) and has medium reasoning effort. (`amp-strings.txt:295122`)

The default review-mode key is derived rather than repeated: (`amp-strings.txt:295122`)

```js
A40=la.PUCK.key,Tr0=la.REVIEW.key
```

Thus `Tr0 === "review"`. The CLI nevertheless passes the literal `agentMode:"review"` to the thread executor. (`amp-strings.txt:291862`, `amp-strings.txt:295122`)

## 7. Check discovery

### Trigger and scope

Pre-discovery is skipped unless `--check-scope` or `--files` is present. Without either, `g30` returns `[]`; the review agent is told to inspect the diff, determine changed files, and self-discover checks. With `--files`, each focus path is made relative to the repository root and discovery starts in each file's directory. With `--check-scope`, the scope path becomes the discovery base and the synthetic file list is `["."]`. (`amp-strings.txt:291863`, `amp-strings.txt:291869`)

Repository detection executes `git rev-parse --show-toplevel` first, then `jj root`. If both fail, it throws exactly: (`amp-strings.txt:291863`)

```text
Current directory is not in a git or jj repository. Run amp review from an existing repository, or initialize one with `git init` or `jj git init`.
```

The CLI's hard `checkFilter` operation is applied only to `i.allChecks` returned by pre-discovery. The prompt independently tells the agent to run only those names, so filtering of checks found later by the agent depends on agent compliance rather than another local filter. (`amp-strings.txt:291863`, `amp-strings.txt:291866-291868`)

### Ancestor walk and deduplication

For each unique file-directory string, `s30` starts `r30` at that directory. `r30` checks `<current>/.agents/checks`, then moves to the parent. It records each URI string in a visited set and breaks on repetition (a loop guard), stops after processing a directory equal to one of the repository-root URI stop points, or stops at the URI filesystem root. It then checks both global directories. (`amp-strings.txt:291860`)

Global directories are exactly: (`amp-strings.txt:291860`, `amp-strings.txt:293291`)

```text
<userConfigDir>/amp/checks
<userConfigDir>/agents/checks
```

`g9T` first verifies that a candidate is a directory, reads it, and inserts checks into a `Map` only when the name is not already present. This means nearest local ancestors win over farther ancestors; local names win over global names; and `<userConfigDir>/amp/checks` wins over `/agents/checks`. Directory enumeration order decides collisions inside a single directory. Errors from stat are swallowed; list/read errors are logged and discovery continues. (`amp-strings.txt:291860`)

`s30` additionally deduplicates `allChecks` by name across the per-directory searches while preserving first encounter. It also builds `checksPerFile`, mapping each input file to the complete check list found for that file's grouped directory. The CLI currently consumes `allChecks`; `checksPerFile` is not used by `g30`. (`amp-strings.txt:291860`, `amp-strings.txt:291863`)

### Frontmatter and check construction

The exact frontmatter split regex is: (`amp-strings.txt:291860`)

```regex
^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$
```

Rules:

- Only non-directory files ending in lowercase `.md` are considered; empty files are skipped.
- No regex match means `{frontmatter:null, body:wholeFile}`.
- YAML parse failure is logged as `Failed to parse codereview file frontmatter`, and likewise returns null frontmatter plus the whole file as body.
- Valid YAML produces `name` as the YAML string or the literal `unknown`; `description` only when a string; `severity-default` copied as-is; and `tools` only when an array, filtered to string members.
- `_30` chooses `frontmatter.name` when frontmatter is valid, otherwise the `.md` filename stem. It stores fallback frontmatter `{name: stem}` when parsing was absent/invalid.
- The resulting object is exactly `{uri,name,scope,frontmatter,content}`; `content` is the parsed body or whole file fallback. (`amp-strings.txt:291860`)

The minified construction is: (`amp-strings.txt:291860`)

```js
let{frontmatter:c,body:_}=e30(t),s=c?.name??r.replace(/\.md$/,"");a.push({uri:h9(e),name:s,scope:c30(R),frontmatter:c??{name:s},content:_})
```

## 8. Result extraction

### `submit_review`

`M30` scans assistant messages and collects IDs for every `tool_use` whose name equals `YJT`, where `YJT="submit_review"`. `H30` then scans messages from last to first, considers only user-role `tool_result` blocks, scans each content array from last to first, requires a collected `toolUseID` and `run.status === "done"`, and validates `run.result` with `q30`. It therefore returns the latest completed matching result in transcript order. (`amp-strings.txt:291879`, `amp-strings.txt:292058`)

Validation failure is exactly: (`amp-strings.txt:291879`)

```text
Invalid submit_review result: ${zodError.message}
```

No completed result causes `H30` to return null. `y30` then throws the executor's own `o.error` when present, otherwise exactly: (`amp-strings.txt:291862`)

```text
Review completed without a submit_review result
```

The prompt requires exactly one call, but the parser does not reject duplicates; it selects the latest completed matching tool result. A reimplementation that wants strict enforcement would need an extra cardinality check not present here. (`amp-strings.txt:291868-291879`)

### `run_check` matching

`w30` creates lookup maps by discovered check name and URI, collects assistant `run_check` tool uses by ID, then scans user tool results. Matching follows this priority: (`amp-strings.txt:291879`)

1. If input has a string `checkURI`, use an exact known URI match.
2. Otherwise, if that URI parses, synthesize a global-scope check for that URI. Its name is `checkName` when supplied, else the URI basename without extension, else `unknown`; its frontmatter is sanitized from the tool input.
3. If no usable URI produced a check, match a supplied `checkName` against the pre-discovered name map.

Every pre-discovered URI starts in this error state: (`amp-strings.txt:291879`)

```text
Check was discovered but run_check was not completed for it
```

A done result replaces that state with parsed output; an error result uses `run.error.message` or `Check failed`. Other statuses are ignored. Dynamically synthesized checks are inserted only when a matching result is encountered. Multiple results for one URI overwrite in transcript order. (`amp-strings.txt:291879`)

### Structured result first

`N30` first validates the raw result against `P30`. On success, `K30` resolves every relative issue file against the repository/workspace root, sets both `check` and `source` to the matched check's name, keeps line/endLine/problem/why/fix, and computes `issuesFound` from the issue-array length. The validated `checkName` is not used after validation. (`amp-strings.txt:291879`, `amp-strings.txt:295783`)

### XML fallback

If structured parsing fails, a string result is parsed directly; a non-string is `JSON.stringify`-ed and then parsed as XML. The effective accepted format is: (`amp-strings.txt:291860`, `amp-strings.txt:291879`)

```xml
<checkResult>
  <status>completed</status>
  <filesAnalyzed>12</filesAnalyzed>
  <linesAnalyzed>345</linesAnalyzed>
  <patternsChecked>
    <pattern>pattern one</pattern>
    <pattern>pattern two</pattern>
  </patternsChecked>
  <issues>
    <issue severity="critical|high|medium|low" file="path/to/file.ts" line="123">
      <problem>What is wrong</problem>
      <why>Why it matters</why>
      <fix>How to fix it</fix>
    </issue>
  </issues>
</checkResult>
```

Parser details matter:

- `<checkResult>` is mandatory and must be an exact opening/closing tag with no attributes. If missing, the normalized check has status `error`, no issues, and the exact message `No checkResult block found in agent output`.
- Only exact `<status>completed</status>` yields `completed`; every other/missing value yields `error`.
- `filesAnalyzed` and `linesAnalyzed` accept only adjacent decimal digits in exact tags.
- `patternsChecked` is optional; each non-empty `<pattern>...</pattern>` is trimmed.
- Each issue needs an allowed `severity`, a double-quoted `file`, and non-empty problem text. `line` is optional decimal digits. XML has no `endLine` parsing.
- If `<problem>` is absent, the trimmed entire issue body becomes `problem`; `<why>` and `<fix>` are optional.
- Relative `file` values are joined to the workspace root; absolute values are retained.
- `issuesFound` is recomputed from accepted issues, not read from XML. (`amp-strings.txt:291860`)

`Os` extracts the first exact tag pair, trims its body, and runs a one-pass entity unescape in this exact order: (`amp-strings.txt:291860`)

```js
T.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;/g,"'")
```

Entity decoding applies to extracted tag bodies—including the outer `<checkResult>` and `<issues>` bodies before issue-attribute regexes run. There is no separate attribute-aware XML decoder; nested extraction can therefore apply the simple replacement pass more than once. (`amp-strings.txt:291860`)

### Mechanical merge

Every done check issue becomes a `ReviewComment` with `filename=file`, `startLine=line ?? 0`, `endLine=endLine ?? line ?? 0`, `text=problem`, copied severity/source/why/fix, and no `commentType`. Normal mode concatenates `submit_review.comments` followed by converted check comments. Checks-only mode discards all submitted comments and keeps only converted check comments. (`amp-strings.txt:291860-291862`)

## 9. Output rendering

### Human format

Before rendering, `x30` performs: (`amp-strings.txt:291862`)

```js
let h=T.filter((e)=>e.severity!=="low")
```

Thus every comment whose severity is exactly `low` is silently absent from human output. It remains in JSON. Comments with missing severity remain visible. (`amp-strings.txt:291862`, `amp-strings.txt:291880-291883`)

The human layout is:

```text
Review
● relative/or/original/path.ts
@L42 [source] comment text

The following checks were run:
- check-name: ok (0 issues)
- another-check: issues found (2 issues)
```

Colors/styles are omitted above: `Review` and prose are dim; line labels are cyan; sources are dim italic; `ok` is green; `issues found` is yellow; and errors are red. File groups preserve first-comment order, comments preserve input order, and blank lines separate comments/groups. Only comment `text` and optional source are displayed; comment type, severity, why, and fix are not rendered in human mode. (`amp-strings.txt:291879-291880`)

Exact empty messages are: (`amp-strings.txt:291862`, `amp-strings.txt:291879-291880`)

```text
No issues found.
No checks were run.
```

When checks exist, the heading is exactly:

```text
The following checks were run:
```

Done check lines use the check object's name and issue count. Error/in-progress names come from the URI filename stem and render as `- name: error (${error})` or `- name: running (${message})`. The renderer supports singular `1 issue`. (`amp-strings.txt:291880`)

### OSC-8 VS Code hyperlinks

A positive chosen line (`startLine ?? endLine`) renders `@L<n>` as an OSC-8 hyperlink. The exact byte structure is: (`amp-strings.txt:291879`)

```text
ESC ] 8 ; ; vscode://file/<absolute-path>:<line> BEL @L<line> ESC ] 8 ; ; BEL
```

In escaped JavaScript form:

```js
`\x1B]8;;vscode://file/${absolutePath}:${line}\x07${label}\x1B]8;;\x07`
```

Relative filenames are joined to the repository root for the URL. A zero/negative/falsey line suppresses both the link and `@L` label. Because an absolute POSIX path begins with `/`, the resulting URI text contains the expected slash after `vscode://file/` plus the path's own leading slash.

### JSON format

JSON does not apply the low-severity filter. It includes the flat merged `comments`, a second grouping of the same comment objects under `files`, and flattened check states. Undefined optional properties disappear through `JSON.stringify`; paths are not made relative for JSON. Success uses `error:null`; failure returns only the error and empty arrays. (`amp-strings.txt:291880-291883`)

### Spinner

The spinner is disabled for `--json` or non-TTY output. Otherwise it cycles these frames every 80 ms: (`amp-strings.txt:291879`)

```text
| / - \
```

It starts with `Starting review...`, is immediately updated to `Reviewing...` or `Running checks...`, redraws with carriage returns, pads over a longer prior frame, and on stop clears the occupied width and returns to column zero. It stops in a `finally` around thread execution/result rendering. (`amp-strings.txt:291862`, `amp-strings.txt:291879`)

## 10. Thread lifecycle

The core invocation is verbatim: (`amp-strings.txt:291862`)

```js
let o=await qCT({...T.actorOptions,workspaceRoot:e,userInput:C30({repositoryKind:i.kind,diffDescription:a.diffDescription,files:r,instructions:a.instructions,checks:t,checkFilter:a.checkFilter,checksOnly:a.checksOnly,thinking:a.thinking}),stdinInput:null,agentMode:"review",labels:[HhR],quiet:!0})
```

Here `workspaceRoot` is the detected repository root; `userInput` is the constructed prompt; stdin is disabled; the mode is `review`; and the labels array contains `HhR`, whose value is also `review`. The thread ID is retained from the executor result. (`amp-strings.txt:291862`, `amp-strings.txt:292310`)

On success, `E30` archives the thread with `archiveThread(threadID, true)` unless the global `--no-archive-after-execute` option made `archiveAfterExecute === false`. A missing thread ID also skips archiving. Archiving occurs after output has been produced by `y30`; an archive failure is caught as a command error and changes the final exit to 1. (`amp-strings.txt:291862`, `amp-strings.txt:291897`)

`y30` installs a process-level SIGINT listener. It writes exactly this line and exits immediately with 130: (`amp-strings.txt:291860-291862`)

```text
Interrupted
```

The handler is not removed, but normal command completion exits the process immediately afterward. (`amp-strings.txt:291860-291862`, `amp-strings.txt:291898`)

## 11. Progress UI in Amp TUI/top

The TUI recognizes a separate tool name constant `HKR="code_review"`, labels its activity `Reviewing code` / `Reviewed code`, uses `diff_description` as detail, and feeds result/progress payloads to `PVR` and `yVR`. (`amp-strings.txt:291034`, `amp-strings.txt:292326`)

`PVR` reads `main`, `checks`, and newline-separated progress `output`; completed result fields take precedence over live progress fields. `yVR` deduplicates actions by `kind:title` and emits these review-level templates as applicable (`${...}` below is readable placeholder notation): (`amp-strings.txt:291034-291035`)

```text
Code review queued
Code review failed: ${errorOrUnknownError}
Main review complete, running checks...
Code review complete
Reviewing code changes...
```

For each object-valued check state it derives a display name from `result.check.name`, otherwise from the URI/path stem. Its readable status templates are: (`amp-strings.txt:291034-291035`)

```text
Check ${name}: complete
Check ${name}: ok
Check ${name}: ${count} issue found
Check ${name}: ${count} issues found
Check ${name}: error (${errorOrUnknownError})
Check ${name}: ${message}
```

For in-progress checks, missing/blank `message` defaults to `Running check...`; errors similarly default to `Unknown error`. Done and error checks count as completed; in-progress checks do not. If no synthesized actions exist, non-empty progress output lines are used; if still empty, queued becomes `Code review queued`, otherwise `Reviewing code changes...`. The summary is `quick code review` only when `thinking === "low"`, otherwise `code review`; when checks exist it is exactly `${completed}/${total} checks · ${summary}` (the separator is U+00B7). (`amp-strings.txt:291035`)

## 12. Server-side pieces

Two bundle copies contain equivalent server-tool sets, assigned `sP` and `Q40`. Both include `run_check`, `submit_check`, and `submit_review` beside other remotely implemented tools such as `finder`, `librarian`, `oracle`, and `advisor`. One exact copy is: (`amp-strings.txt:292185`; equivalent `Q40` copy at `amp-strings.txt:295122`)

```js
sP=new Set(["find_thread","finder","fold_context","run_check","submit_check","submit_review","librarian","oracle","advisor","read_thread","read_web_page","web_search","docs_list","docs_read","docs_write","create_project","update_project","list_agent_modes","list_runners","create_thread","get_current_user_identity","get_thread_metadata","update_thread","archive_current_thread","archive_thread","archive_threads","unarchive_thread","send_message_to_thread","thread_interact","wait_for_threads","sleep","public_artifact_url","publish_thread_artifacts",...Y6,"slack_write","slack_read","gmail_read","gmail_write","github_repo_ci_status"])
```

The binary contains tool-name enums/constants, the review schemas, prompt text, mode tool inclusion, transcript parsing, and TUI rendering. It does **not** contain a local tool specification/description or executable implementation for `run_check`, `submit_check`, or `submit_review`, nor a check-agent prompt body. This negative finding was verified by auditing all literal occurrences of those names in the exact extraction; they resolve to enum/set membership and the review orchestration described above. (`amp-strings.txt:291862-291879`, `amp-strings.txt:292058`, `amp-strings.txt:292185`, `amp-strings.txt:295122`, `amp-strings.txt:295783`)

The same is true of the named `review` system prompt: the binary selects `systemPrompt:"review"` but has no embedded prompt body. Consequently, a faithful clone needs to supply its own review/check prompts or reproduce server behavior separately. (`amp-strings.txt:295122`)

The XML fallback strongly implies an older or compatibility check-agent contract that returned a textual `<checkResult>` block with summary counters, patterns, and issues. The preferred current contract is the structured `P30` object because `N30` tries it first. (`amp-strings.txt:291860`, `amp-strings.txt:291879`, `amp-strings.txt:295783`)

## 13. Caveats and gotchas

1. **Human output silently drops `severity === "low"`; JSON keeps it.** A run can print `No issues found.` while its JSON contains low-severity comments. (`amp-strings.txt:291862`, `amp-strings.txt:291880-291883`)
2. **`submit_review` is instructed to run exactly once, but duplicate calls are not rejected.** The latest completed matching result wins. (`amp-strings.txt:291868-291879`)
3. **Check findings must not be copied into `submit_review`.** The CLI appends structured check findings mechanically; copying them duplicates comments. (`amp-strings.txt:291868`, `amp-strings.txt:291862`)
4. **Checks-only is a merge rule, not a different executor.** The same review agent runs and must still submit once with an empty array; locally, all submitted main comments are discarded regardless. (`amp-strings.txt:291862`, `amp-strings.txt:291868`)
5. **Pre-discovery only occurs with `--files` or `--check-scope`.** Otherwise the agent self-discovers after inspecting changed paths. (`amp-strings.txt:291863`, `amp-strings.txt:291869`)
6. **The hard check-name filter only filters the pre-discovered list.** For self/additional discovery, enforcement is prompt-based. A filter alone does not trigger pre-discovery. (`amp-strings.txt:291863`, `amp-strings.txt:291866-291868`)
7. **`dangerouslyAllowAll:false` is an absolute refusal.** There is no legacy-permission fallback. (`amp-strings.txt:291897`)
8. **Threads are archived by default.** Use the global `--no-archive-after-execute` to retain one. (`amp-strings.txt:291897`)
9. **Jujutsu is first-class but second in detection order.** Git is attempted first; a colocated Git/JJ workspace is classified as Git when `git rev-parse` succeeds. (`amp-strings.txt:291863`)
10. **Missing check lines become line zero.** Human rendering suppresses the link/line label for zero, while JSON exposes `startLine:0,endLine:0`. (`amp-strings.txt:291860`, `amp-strings.txt:291879`)
11. **`startLine:0` suppresses a hyperlink even when `endLine > 0`.** Selection uses `startLine ?? endLine`, so nullish fallback does not replace zero. (`amp-strings.txt:291879`)
12. **Focus paths are resolved from process CWD, not repository root, before relativization.** Paths outside the repository can therefore become `../...`. (`amp-strings.txt:291863`)
13. **A valid YAML frontmatter block without a string `name` becomes `unknown`, not the filename stem.** Filename fallback only happens when frontmatter is null. (`amp-strings.txt:291860`)
14. **Locally parsed `severity-default` is not validated.** Synthesized tool-input frontmatter is stricter. (`amp-strings.txt:291860`, `amp-strings.txt:291879`)
15. **Discovery deduplicates solely by name.** Two distinct check URIs with the same name cannot both survive the same discovery accumulation. Nearest/local-first ordering decides the winner. (`amp-strings.txt:291860`)
16. **A valid unknown `checkURI` synthesizes a check before name matching.** Its result can therefore appear even though it was absent from pre-discovery. (`amp-strings.txt:291879`)
17. **Structured `checkName` is validated but ignored in normalized naming.** The matched/synthesized check object controls name and source. (`amp-strings.txt:291879`, `amp-strings.txt:295783`)
18. **A tool run can be wrapper-`done` while its structured inner status is `error`.** Human/JSON check state remains `done`; summary color/count uses issue count, not inner check status or `errorMessage`. (`amp-strings.txt:291879-291883`)
19. **The XML parser is intentionally narrow.** Exact tags, double-quoted attributes, no XML `endLine`, and simple regex parsing are required. (`amp-strings.txt:291860`)
20. **JSON output disables the spinner; redirected human output also has no spinner.** (`amp-strings.txt:291862`, `amp-strings.txt:291879`)
21. **Archive failure occurs after review output is written.** It can append an error and return exit 1 after otherwise successful output. (`amp-strings.txt:291862`, `amp-strings.txt:291897`)
22. **The prompt's `run_check` argument “shape” is not valid standalone JSON.** It has no surrounding braces. (`amp-strings.txt:291872-291879`)
23. **The review mode has no `shell_command_status`.** Its local mode tool list includes `shell_command` but not the polling companion, despite that companion existing elsewhere in Amp. (`amp-strings.txt:295122`)

## 14. Scale and reimplementation boundary

Measured against this extraction:

- executable: **71,371,874 bytes**;
- plaintext `strings -a` bundle extraction: **14,052,496 bytes**, about 14 MB (an extraction size, not a strict contiguous-bundle boundary);
- local review module (`e30` through `E30`): **17,665 minified bytes**, 38 physical strings-file lines, about **399 beautified lines**;
- functions in that slice: **38 top-level + 2 nested helpers**;
- primary local implementation coordinates: `amp-strings.txt:291860-291898`;
- separate TUI progress code: `amp-strings.txt:291034-291035`;
- constants/tool name: `amp-strings.txt:292058`, `amp-strings.txt:292310`, `amp-strings.txt:293291`;
- mode/tool-set copy: `amp-strings.txt:295122`;
- schemas: `amp-strings.txt:295783`.

The local implementation is therefore modest: roughly 400 readable lines for CLI plumbing, discovery, transcript reconstruction, fallback parsing, and rendering. The behavior that determines review quality—review system prompt, `run_check` execution, check-agent prompt, and submission tools—is beyond the binary boundary and must be designed independently in a clone. (`amp-strings.txt:291860-291898`, `amp-strings.txt:292185`, `amp-strings.txt:295122`)

## Verification notes

After drafting, verbatim material was rechecked against `/tmp/amp-strings.txt` using literal `grep -F` or bounded Perl extraction. The spot checks covered at least:

1. the CLI description/options and thinking validator (`amp-strings.txt:291883`);
2. the full help examples (`amp-strings.txt:291884-291897`);
3. both legacy-permissions messages (`amp-strings.txt:291897`);
4. the complete `C30` prompt and both `v30` branches (`amp-strings.txt:291863-291879`);
5. the Zod schema declaration (`amp-strings.txt:295783`);
6. submit/check extraction errors (`amp-strings.txt:291862`, `amp-strings.txt:291879`);
7. OSC-8 byte escapes and spinner frames (`amp-strings.txt:291879`);
8. the review mode and exact tool list (`amp-strings.txt:295122`).

No live review was executed: that would create a remote thread and invoke server-side agents. Static extraction plus `amp review --help` was sufficient to verify the local interface without side effects.
