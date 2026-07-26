# Amp `code_review` tool reference

> **Source:** archived Amp npm bundle `@sourcegraph/amp` version `0.0.1780074265-g6cfdc3`
> **Bundle:** `~/.cache/artifacts/npm/sourcegraph-amp/0.0.1780074265-g6cfdc3/package/dist/main.js`
> **Extraction date:** 2026-07-26
> **Pretty-print provenance:** `/tmp/amp-main.pretty.js`, 291,513 lines, generated from that bundle with `npx js-beautify`. The archive is the last npm release verified to contain client-embedded prompts; see `docs/agents/amp-reference.md`.

This document describes the implementation preserved in that exact bundle. Minified identifiers and line numbers refer to `/tmp/amp-main.pretty.js`; they are not public API names.

## Overview and architecture

`code_review` is a builtin, deferred tool that fans one invocation into two concurrent tracks:

1. **Main review:** a Gemini 3.1 Pro Preview subagent reads the diff and related code, then receives a follow-up requiring a `<codeReview>` report.
2. **Checks:** one Claude Haiku 4.5 subagent per discovered Markdown check searches changed lines and emits `<checkResult>`.

`YE4` combines the latest value from both tracks with `G6`. `MRQ` then parses and maps them into the tool's progress/result protocol. The main review and checks do not consume each other's findings; their outputs are combined only after execution.

```text
code_review tool invocation
└─ XE4.fn                              tool adapter
   └─ YE4                              runCodeReview / two-track fan-out
      ├─ qRQ                           normalize arguments
      ├─ main track
      │  ├─ checksOnly? synthetic <codeReview></codeReview>
      │  └─ wRQ                        runMainReview
      │     ├─ WRQ(DE4, cwd, date)     construct system prompt
      │     ├─ L5.run(t$0(...))        run subagent
      │     │  └─ mB["code-review"]   Gemini 3.1 Pro Preview
      │     └─ followUps[]             inject CRQ final-report prompt
      └─ checks track
         └─ EE4 → BE4                  runChecks observable
            ├─ zRQ                     list added/modified files
            │  └─ GRQ → T_0            NL→git argv, validate shell syntax
            ├─ AE4                     resolve checks for target files
            │  └─ DRQ → t94 → YRQ      discover/read/parse checks
            │              └─ ERQ      parse YAML frontmatter
            ├─ fC(...KRQ(check))        run all selected checks concurrently
            │  ├─ XRQ                  construct check system prompt
            │  └─ L5.run(Wz, ...)
            │     └─ mB["codereview-check"]  Claude Haiku 4.5
            └─ retry error checks once (QE4)

G6(main, checks)
└─ MRQ                                  map status and progress
   ├─ ZE4                               parse <codeReview>
   ├─ FE4                               parse each <checkResult>
   └─ ORQ                               collect main-agent tool uses
```

### Identifier map

| Identifier | Descriptive name / role |
|---|---|
| `XE4` | Tool definition and adapter |
| `qRQ` | Normalize tool arguments |
| `JE4` | Normalize string-array arguments, including JSON-encoded arrays |
| `YE4` | Run code review and combine main/check tracks |
| `wRQ` | Run the main review subagent |
| `DE4` / `WRQ` | Main system prompt / cwd-date prompt builder |
| `CRQ` | Final report follow-up prompt |
| `EE4` / `BE4` | Check-runner entry point / implementation |
| `zRQ` | List added or modified target files |
| `GRQ` / `T_0` / `VRQ` | Generate file-list git commands / validate / forbidden-shell regex |
| `AE4` | Resolve checks for target-file directories |
| `DRQ` / `t94` / `YRQ` | Walk scopes / add one checks directory / read checks |
| `ERQ` | Parse check frontmatter |
| `KRQ` / `XRQ` | Run one check / build its system prompt |
| `QE4` | Number of failed-check retry rounds (`1`) |
| `ZE4` / `FE4` | Parse main review XML / check XML |
| `MRQ` | Map combined state to the tool result union |
| `Ri1` / `Pi1` | Main-agent tools / `maxTurns` |
| `vi1` / `Ti1` | Check-agent tools / `maxTurns` |
| `j2Q` / `isA` / `osA` | Builtin skill content / skill definition / tool-to-skill mapping |
| `TN0` / `GbA` | Mode tool eligibility / deferred-tool test |
| `Fb`, `AD` | Minified deferred arrays; both equal `["code_review"]` |
| `EbA`, `qg1` | Pretty-printed equivalents used by Smart/Large and Deep |
| `lV6` / `zT4` / `GT4` | Review CLI options / command registration / main CLI flow |
| `_V6` / `mV6` | Generate diff commands / execute and summarize diff |
| `PV6` / `ZT4` | Summary format prompt / Gemini summary call |
| `xV6` | Canned Smart-mode user message |
| `bV6` / `hV6` / `gV6` | Extract successful tool result / tool error / thread error |
| `Vp0` / `fV6` | Convert check issues / combine review and check comments |
| `SV6` / `kV6` / `yV6` | Render comments / checks / final CLI output |
| `OD4` | Agg Man canonical code-review workflow prompt |

Primary implementation anchors: lines 183130–183980; subagent specs: 158289–158345; CLI: 286950–287500.

## Tool specification (verbatim)

The following is the complete `spec` object embedded in `XE4`:

```javascript
spec: {
    name: "code_review",
    description: `Review code changes, diffs, outstanding changes, or modified files. Use when asked to review changes, check code quality, analyze uncommitted work, or perform a code review.

It takes in a description of the diff or code change that can be used to generate the full diff, which is then reviewed. When using this tool, do not invoke \`git diff\` or any other tool to generate the diff but just pass a natural language description of how to compute the diff in the diff_description argument.

Pass "thinking": "high" for a thorough review with high reasoning depth. Defaults to "low" for a faster review.`,
    inputSchema: {
        type: "object",
        properties: {
            diff_description: {
                type: "string",
                description: "A description of the diff or code change that can be used to generate the full diff. This can include a git or bash command to generate the diff or a description of the diff which can then be used to generate the git or bash command to generate the full diff."
            },
            files: {
                type: "array",
                items: {
                    type: "string"
                },
                description: "Specific files to focus the review on. If empty, all changed files covered by the diff description are reviewed."
            },
            instructions: {
                type: "string",
                description: "Additional instructions to guide the review agent."
            },
            checkScope: {
                type: "string",
                description: "A directory to search for checks. If empty, includes all checks."
            },
            checkFilter: {
                type: "array",
                items: {
                    type: "string"
                },
                description: "A list of specific check names to run. If empty, includes all checks in scope."
            },
            checksOnly: {
                type: "boolean",
                description: "If true, skips the main review agent and only runs checks."
            },
            thinking: {
                type: "string",
                enum: ["low", "high"],
                description: 'Controls review depth. "low" (default) performs a faster review with less reasoning depth. "high" performs a thorough review with high reasoning.'
            }
        },
        required: ["diff_description"]
    },
    source: "builtin"
}
```

The schema deliberately mixes `diff_description` with camel-case check options (`checkScope`, `checkFilter`, `checksOnly`). No `additionalProperties: false` is present.

## Prompts (verbatim)

Static blocks below are runtime prompt text. Dynamic templates retain the bundle's `${...}` interpolation tokens; the interpolation tables explain their values without inventing an instance.

### Main review system prompt — `DE4`

````text
You are an expert senior engineer with deep knowledge of software engineering best practices, security, performance, and maintainability.

Your task is to perform a code review of the provided diff description. The diff description might be a git or bash command that generates the diff or a description of the diff which can then be used to generate the git or bash command to generate the full diff.

After reading the diff, do the following:
1. Write a high-level summary of the changes in the diff.
2. Go file-by-file and review each changed hunk.
3. Comment on what changed in that hunk (including the line range) and how it relates to other
   changed hunks and code, reading any other relevant files. Also call out bugs, hackiness,
   unnecessary code, or too much shared mutable state.
4. Evaluate abstraction fit in both directions: flag unnecessary indirection (over-abstraction)
   and missing abstractions (duplication or branching complexity). For each finding, cite concrete
   locations and recommend exactly one action—simplify/inline or introduce/extract a shared
   concept—only when it improves current code (avoid speculative refactors).

Strongly prefer to restrict your use of git commands to these when getting the diff or determining which files were added/changed/removed:
<referenceCommands>
  <command>
    <description>committed changes on my branch since diverging from the upstream default branch</description>
    <bash>git diff --merge-base origin/HEAD HEAD</bash>
  </command>
  <command>
    <description>all current checkout changes since diverging from upstream (commits + staged + unstaged tracked)</description>
    <bash>git diff --merge-base origin/HEAD</bash>
  </command>
  <command>
    <description>changes since diverging from upstream up to and including staged changes</description>
    <bash>git diff --cached --merge-base origin/HEAD</bash>
  </command>
  <command>
    <description>current checkout tracked changes since divergence, plus a list of newly added untracked files</description>
    <bash>git diff --merge-base origin/HEAD</bash>
    <bash>git ls-files --others --exclude-standard</bash>
  </command>
  <command>
    <description>changes on branch foo since divergence from upstream</description>
    <bash>git diff --merge-base origin/HEAD foo</bash>
  </command>
  <command>
    <description>only filenames changed by this branch since divergence</description>
    <bash>git diff --name-only --merge-base origin/HEAD HEAD</bash>
  </command>
  <command>
    <description>scope diff to a specific path since diverging from upstream</description>
    <bash>git diff --merge-base origin/HEAD <ref-or-empty> -- &lt;pathspec&gt;</bash>
</command>
</referenceCommands>

Avoid commands in this format, unless explicitly asked for:
<avoidCommands>
  <avoidCommand>git diff <base-ref> <head-ref></avoidCommand>
  <avoidCommand>git diff <base-ref>..<head-ref></avoidCommand>
  <avoidCommand>git diff HEAD...origin/HEAD</avoidCommand>
</avoidCommands>

<guidelines>
- Persistence: Low. Do not retry failed tool calls more than 2 times. If a tool call fails twice, move on.
- Remember to look at untracked added files.
- Prefer the most direct path to completing the review. Batch related file reads into as few turns as possible.
- Do not edit or modify files or run any commands that edit or modify files or git state.
- Do not re-read files you have already read.
- Upstream default branch ref: use origin/HEAD. Do not assume main, origin/main, or origin/master.
- If a diff is unexpectedly large, double check you are using the right refs in git invocations.
- If the diff has more than 100 changed files or is more than 10,000 lines long, abort the review and emit a single critical issue stating the diff is too large.
</guidelines>

````

`WRQ` appends one of these exact suffix templates. `new Date().toDateString()` supplies the date at invocation time.

````text

Today's date: ${new Date().toDateString()}
````

When a cwd exists, it instead appends:

````text

Current working directory (cwd): ${A}
Today's date: ${new Date().toDateString()}
````

### Main review user envelope — `wRQ`

````text
Review the following diff: ${A}
````

If nonblank additional instructions exist, this exact text is appended:

````text

Additional instructions from the user:
${B.trim()}
````

If `files` is nonempty, `YE4` first appends this to the normalized instructions string:

````text

Focus on these files:
${$.join(`
`)}
````

### Final report format — `CRQ`

````text
Emit your final report in the following format:

<codeReview>
<comment>
  <filename>the absolute file path (starting with the working directory)</filename>
  <startLine>the starting line number (see line number rules below)</startLine>
  <endLine>the ending line number (see line number rules below)</endLine>
  <severity>one of: critical, high, medium, low</severity>
  <commentType>one of: bug, suggested_edit, compliment, non_actionable</commentType>
  <text>text describing the issue and/or the proposed change to code</text>
  <why>brief explanation of why this matters</why>
  <fix>brief suggestion for how to fix it (optional for compliments)</fix>
</comment>
<comment>...</comment>
<comment>...</comment>
</codeReview>

Line number rules:
- For MODIFIED files: use line numbers from the NEW version (the + side in unified diff headers like @@ -old,count +NEW,count @@)
- For ADDED files: use line numbers from the new file content
- For DELETED files: use startLine=0 and endLine=0 (the file no longer exists, so describe the deletion issue in the text)

Severity levels:
- "critical": Security vulnerability, data loss, crash
- "high": Bug or significant performance issue
- "medium": Code smell, maintainability issue, or minor bug
- "low": Style suggestion, minor improvement, or compliment

Comment types:
- "bug": Points out a bug or defect in the code
- "suggested_edit": Suggests a code change or improvement
- "compliment": Positive feedback praising good code patterns or decisions
- "non_actionable": General observation that doesn't require code changes
````

This is injected as a user follow-up after the main subagent's first tool-complete response.

### Check prompt template — `XRQ`

````text
# ${A.name} Check

${A.content}

${E}

${D}

Working directory: ${B??"unknown"}

## Your Task

1. Review the git diff to see what changed
2. Search for patterns described above ONLY in the changed lines (+ lines in diff)
3. Report issues ONLY for code that was added or modified in this diff
4. Do NOT report issues for unchanged/pre-existing code

## Output Format

End your response with:

<checkResult>
<checkName>${A.name}</checkName>
<status>completed</status>
<filesAnalyzed>NUMBER</filesAnalyzed>
<linesAnalyzed>NUMBER</linesAnalyzed>
<patternsChecked>
<pattern>Brief description of pattern 1</pattern>
<pattern>Brief description of pattern 2</pattern>
</patternsChecked>
<issues>
<issue severity="${J}" file="path/to/file.ts" line="LINE">
<problem>functionName(): What is wrong (include method/function name if applicable)</problem>
<why>Why this matters</why>
<fix>How to fix it</fix>
</issue>
</issues>
</checkResult>

IMPORTANT: The "file" attribute MUST use the EXACT path from the diff header (e.g., "core/src/tools/file.ts"), not just the filename.

## Severity (default: ${J})
- critical: Security vulnerability, data loss, crash
- high: Bug or performance issue
- medium: Code smell or maintainability
- low: Style suggestion
````

Interpolations:

- `${A.name}`: parsed check name.
- `${A.content}`: Markdown body after frontmatter.
- `${E}`: either a newline-joined explicit file list under `## Files to Review`, or “Review all relevant files in the working directory.”
- `${D}`: optional `## Diff Description` section containing the supplied diff description.
- `${B??"unknown"}`: working directory.
- `${J}`: `severity-default` exactly as parsed, or `"medium"` when nullish. The parser does not validate the supplied value.

The exact `${E}` alternatives are:

````text
## Files to Review

${Q.join(`
`)}
````

````text
## Files to Review

Review all relevant files in the working directory.
````

The exact nonempty `${D}` template is:

````text
## Diff Description

Use this description to gather the full diff using git or bash commands:

${$}
````

Otherwise `${D}` is the empty string.

The check's user conversation is exactly:

````text
Run the "${A.name}" code review check.
````

### Natural language to changed-file commands — `GRQ`

````text
You generate git commands to list changed files. Output commands wrapped in <command></command> tags.

Use "git diff --name-only --diff-filter=AM" for tracked files.
Use "git ls-files --others --exclude-standard" for untracked files when appropriate.

Examples:
- "changes since main" →
<command>git diff --name-only --diff-filter=AM main</command>

- "uncommitted changes" →
<command>git diff --name-only --diff-filter=AM</command>
<command>git ls-files --others --exclude-standard</command>

- "changes in last commit" →
<command>git diff --name-only --diff-filter=AM HEAD~1</command>

- "changes between v1.0 and v2.0" →
<command>git diff --name-only --diff-filter=AM v1.0..v2.0</command>

- "staged changes" →
<command>git diff --name-only --diff-filter=AM --cached</command>

Output only the command tags, no explanation.
````

The caller supplies the natural-language diff description as the sole user message.

### Natural language to full-diff commands — `_V6`

````text
You generate git diff commands that show the actual diff content. Output commands in XML format:
<command>git command 1</command>
<command>git command 2</command>

The commands should use `git diff`, `git ls-files`, or `git status` commands to show the full diff output. Output multiple commands if needed.

Output only standalone git commands that can be executed with execFile argument arrays.
Do not use shell syntax: no $(...), backticks, pipes, &&, ||, semicolons, or redirection.
Prefer native git range syntax instead of shell substitution.
In <descriptions>, list alternate description phrases on separate lines.

Examples:
<example>
  <descriptions>
since merge base
since upstream
changes since merge base
changes since merge-base with origin
all changes on this branch
  </descriptions>
  <expectedOutput>
    <command>git diff --merge-base origin/HEAD</command>
    <command>git ls-files --others --exclude-standard</command>
  </expectedOutput>
</example>
<example>
  <descriptions>
changes since merge base with $REF
since diverging from $REF
since $REF
  </descriptions>
  <expectedOutput>
    <command>git diff --merge-base $REF</command>
  </expectedOutput>
</example>
<example>
  <descriptions>
uncommitted changes
show uncommitted tracked changes
  </descriptions>
  <expectedOutput>
    <command>git diff HEAD</command>
  </expectedOutput>
</example>
<example>
  <descriptions>
changes in last commit
show changes introduced by the last commit
  </descriptions>
  <expectedOutput>
    <command>git diff HEAD~1</command>
  </expectedOutput>
</example>
<example>
  <descriptions>
changes since $MY_REF diverged from $OTHER_REF
  </descriptions>
  <expectedOutput>
    <command>git diff --merge-base $OTHER_REF $MY_REF</command>
  </expectedOutput>
</example>
<example>
  <descriptions>
staged changes
show staged changes only
  </descriptions>
  <expectedOutput>
    <command>git diff --cached</command>
  </expectedOutput>
</example>
<example>
  <descriptions>
newly added files
  </descriptions>
  <expectedOutput>
    <command>git ls-files --others --exclude-standard</command>
  </expectedOutput>
</example>

Output only the command tags, no explanation.
````

The CLI supplies its diff description as the sole user message.

### Diff summary format — `PV6`

````text
Provide the following in XML:
<summary>
A one-sentence summary of the change at the product or feature level.

If the change includes multiple specific features or fixes, follow the summary with a bullet point list. For small changes, the one-sentence summary alone is sufficient.

Format:
- First line: One sentence describing the main change and its impact
- Optional: Bullet points for specific features or fixes (only if relevant for larger changes)

Keep it concise and focus on user-facing impact. Do not list individual files or provide detailed technical analysis.
</summary>
<fileOrder>
A list of files in the diff, in the order you'd recommend reviewing them, starting with most important first.
<file>
<filename>path/to/file</filename>
<fileSummary>summary of file diff</fileSummary>
</file>
</fileOrder>

````

`ZT4` sends `${PV6}\n\nDiff:\n${A}` as the user text and uses this exact system instruction:

````text
You are an expert software engineer reviewing code changes.
````

### Builtin skill content — `j2Q`

````text
# Code Review Skill

Run comprehensive code review using the code_review tool.

## Usage

Call `code_review` tool to perform a comprehensive review of code changes or files.

## When to Use

Use this skill when asked to perform a code review or a review of changes to code.

## After the Tool Completes

Display the issues as a concise markdown numbered list. Each item is one line in this format:

1. source (severity) - [file-basename](file-path#range): one sentence summary

Example:

1. security (critical) - [auth.ts](src/auth/auth.ts#L10-L15): JWT secret is hardcoded
2. general (high) - [server.ts](src/server.ts#L42): Missing error handling on database connection

If no issues were found, say so briefly.

Mention which checks were run (if any) and their results.

If issues were found, offer to fix them and make it clear how to reply.

````

Builtin skill description and frontmatter description (identical):

````text
Perform a formal code review. Use ONLY when the user explicitly requests the code-review skill/tool. Do NOT use when "review" appears in other contexts like "review changes for context", "review what happened", or "review commits to find a bug" — those are requests to read/understand code, not to perform a formal code review.
````

### Canned `amp review` message — `xV6`

````text
Use the code_review tool to conduct a code review.

Call code_review exactly once with this argument object:

${$}json
${JSON.stringify(Q,null,2)}
${$}

After the code_review tool call is complete, just say "Review is done." Do not summarize the results or call any other tools.
````

Here `${JSON.stringify(Q,null,2)}` is the generated tool argument object and `${$}` is the literal three-backtick fence string.

### Agg Man canonical workflow prompt — `OD4`

````text
Review the changes with the code review tool.
````

Agg Man routes explicit “review”, “code review”, or “do a code review” requests for a thread to workflow `code_review`; the workflow sends `OD4` verbatim rather than free-form text.

## Types and schemas

### Declared Zod schemas

Faithful TypeScript-ish transcription of `UE4`, `HRQ`, `NRQ`, and `EN$`:

```ts
type CommentType =
  | "bug"
  | "suggested_edit"
  | "compliment"
  | "non_actionable"
  | "unknown";

type Severity = "critical" | "high" | "medium" | "low";

type ReviewComment = {
  filename: string;
  startLine: number;
  endLine: number;
  text: string;
  commentType?: CommentType;
  severity?: Severity;
  source?: string;
  why?: string;
  fix?: string;
};

type CodeReview = {
  comments: ReviewComment[];
};
```

The bundle declares these schemas but `ZE4` itself constructs the return object directly; it does not call `EN$.parse` in this path.

### Check definitions and parsed results

```ts
type CheckFrontmatter = {
  name: string;                    // default "unknown" only when frontmatter exists but name is not a string
  description?: string;
  "severity-default"?: unknown;   // copied without validation
  tools?: string[];                // non-string array entries removed
};

type CheckDefinition = {
  uri: string;                     // URI string used as checkRuns key
  name: string;                    // frontmatter name or filename without .md
  scope: "global" | string;        // global or local scope directory URI
  frontmatter: CheckFrontmatter;
  content: string;
};

type CheckIssue = {
  check: string;
  severity: Severity;
  file: string;                    // absolute after FE4 joins a relative path to workingDir
  line?: number;
  problem: string;
  why?: string;
  fix?: string;
  source: string;
};

type ParsedCheck = {
  check: CheckDefinition;
  result: {
    name: string;
    status: "completed" | "error";
    filesAnalyzed?: number;
    linesAnalyzed?: number;
    patternsChecked?: string[];
    issuesFound: number;
    errorMessage?: string;
  };
  issues: CheckIssue[];
};
```

If no `<checkResult>` block exists, `FE4` returns `status: "error"`, `issuesFound: 0`, and `errorMessage: "No checkResult block found in agent output"` inside an otherwise successfully completed check run.

### Internal run state

The `L5` subagent runner emits these effective shapes to both tracks:

```ts
type ToolUse = {
  id: string;
  tool_name: string;
  status: string;
  input: unknown;
  // completed tool-use records can contain additional run fields
};

type AgentTurn = {
  message?: string;
  reasoning?: string;
  isThinking: boolean;
  activeTools: Map<string, ToolUse>;
};

type AgentStatus =
  | { status: "in-progress"; turns: AgentTurn[]; "~debug"?: unknown }
  | { status: "done"; message: string; turns: AgentTurn[]; "~debug"?: unknown }
  | { status: "error"; message: string; turns: AgentTurn[]; "~debug"?: unknown }
  | { status: "cancelled"; turns: AgentTurn[]; "~debug"?: unknown };

type CombinedReviewState = {
  mainAgentStatus: AgentStatus;
  checkRuns: Array<{
    check: CheckDefinition;
    status: AgentStatus;
  }>;
  workingDir?: string;
};
```

`YE4` seeds the main stream with `{status: "in-progress", turns: []}` and checks with `[]`, so consumers receive immediate progress before subagents produce output.

### `MRQ` output union

```ts
type MappedCheckRun =
  | { status: "done"; result: ParsedCheck }
  | { status: "error"; error: string }
  | { status: "in-progress"; message: string };

type MappedMain =
  | {
      status: "done";
      review: CodeReview;
      toolUses: ToolUse[];
    }
  | {
      status: "in-progress";
      toolUses: ToolUse[];
    };

type CodeReviewToolRun =
  | {
      status: "in-progress" | "done";
      result: {
        main: MappedMain;
        checks: Record<string, MappedCheckRun>; // keyed by check URI
      };
      progress: Array<{
        message?: string;
        reasoning?: string;
        isThinking: boolean;
        tool_uses: ToolUse[];
      }>;
      "~debug": {
        mainAgent: unknown;
        checks: unknown[];
      };
    }
  | {
      status: "error";
      error: { message: string };
    }
  | {
      status: "cancelled";
      reason: "Code review was cancelled";
    };
```

The outer status becomes `done` only when the main status is `done` and every mapped check is `done` or `error`. A check failure therefore does not by itself make the whole tool fail.

## Subagent configuration

| Track | Spec key | Model | `maxTurns` | Tools | `allowMcp` | `allowToolbox` | `retryOnRateLimit` |
|---|---|---|---:|---|---:|---:|---:|
| Main | `code-review` | Gemini 3.1 Pro Preview (`gemini-3.1-pro-preview`) | 24 | `Read`, `Grep`, `glob`, `web_search`, `read_web_page`, `Bash` | false | false | true at `wRQ` invocation |
| Check | `codereview-check` | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | 36 | `Read`, `Grep`, `glob`, `Bash` | false | false | true at `KRQ` invocation |

The main runner maps `thinking: "low"` to Gemini `thinkingLevel: "LOW"`; every other normalized value is `"high"` and maps to `"HIGH"`. `qRQ` normalizes anything other than the exact string `"high"` to `"low"`.

Although both agents have `Bash`, `DE4` explicitly prohibits modifying files or Git state. `XRQ` directs checks to inspect the diff and changed lines only.

## Checks system

### File format and frontmatter

Checks are immediate `.md` children of a `checks` directory; nested directories are skipped. Frontmatter must match this whole-file shape:

```markdown
---
name: check-name
description: optional description
severity-default: medium
tools:
  - Read
---
Markdown check instructions...
```

`ERQ` uses a YAML parser and recognizes only:

- `name`: string; when malformed inside otherwise valid frontmatter, becomes `"unknown"`.
- `description`: optional string.
- `severity-default`: copied as-is, with no enum/type validation.
- `tools`: optional array filtered to string entries.

If the delimiters do not match, or YAML parsing fails, frontmatter is `null` and the entire file remains the body. `YRQ` then derives the name from the `.md` filename. Empty files are ignored.

Only `name` and `severity-default` affect execution/prompting in this implementation. `description` is metadata. `tools` is parsed but **not applied** by `KRQ`; every check receives the fixed `vi1` tool list.

### Discovery locations, order, and precedence

For each target file directory, `DRQ` checks local directories from deepest to shallowest:

```text
<target-file-directory>/.agents/checks
<parent>/.agents/checks
...
<workspace-or-check-scope-root>/.agents/checks
```

It stops after processing the supplied root. It also refuses to walk filesystem roots and special top-level locations (`/`, `/Users`, `/home`, drive roots, `/proc`, `/sys`, `/dev`). After local discovery it checks, in order:

```text
$XDG_CONFIG_HOME/amp/checks       # default ~/.config/amp/checks
$XDG_CONFIG_HOME/agents/checks    # default ~/.config/agents/checks
```

`t94` inserts into a `Map` only when the check name is absent. Therefore **first name wins**:

1. nearest/deepest local check;
2. progressively higher local checks through the scope root;
3. global Amp compatibility location;
4. global Agents location.

Directory entry order decides collisions inside one checks directory. Global discovery is skipped when no `userConfigDir` is supplied.

### Per-file resolution and selection

`AE4` groups target files by directory, discovers checks once per directory, returns a union in `allChecks`, and also builds `checksPerFile: Map<file, CheckDefinition[]>`. `checkFilter`, when present, filters `allChecks` by exact check name.

Materially, `BE4` does not consume `checksPerFile`: every selected check is invoked with the complete target-file list `U`. Per-file directory scoping affects which checks are discovered, but not which subset of files a discovered check receives.

`checkScope`, when truthy, becomes both the Git-command cwd and the local discovery stop root. Otherwise both come from the environment working directory. If neither is available, the checks track throws `No workspace root or scope provided`.

If `files` is supplied, it becomes `targetFiles` directly. Otherwise `zRQ` computes files:

- with no diff description: `git diff --name-only --diff-filter=AM` plus `git ls-files --others --exclude-standard`;
- with a diff description: `GRQ` generates one or more git argv arrays;
- duplicate paths are removed with a `Set`;
- command failures are logged and skipped rather than failing the run.

The `AM` filter intentionally excludes deletions from check target-file discovery, even though the main review format supports deleted files.

### Concurrency and retries

`fC(...checkObservables)` subscribes to all check runs immediately and merges their events; there is no explicit concurrency limit. Initial states for all checks are emitted before execution. After all selected checks finish, `BE4` retries only those whose agent status is exactly `error`.

`QE4 = 1`, so there is one retry round after the initial attempt (at most two agent attempts per check). Retries are again concurrent. Cancelled checks are not retried because the filter matches only `error`.

## Deferred tool and skill gating

`code_review` is omitted from each mode's upfront `includeTools` and placed in `deferredTools`:

| Mode | Pretty identifier | Deferred array | Value |
|---|---|---|---|
| Smart | `EbA` (minified `Fb`) | `deferredTools: EbA` | `["code_review"]` |
| Deep | `qg1` (minified `AD`) | `deferredTools: qg1` | `["code_review"]` |
| Large | `EbA` (minified `Fb`) | `deferredTools: EbA` | `["code_review"]` |

`TN0(tool, mode)` still considers a deferred tool mode-eligible even when it is absent from `includeTools`; `GbA(tool, mode)` identifies it as deferred. The builtin mapping is `osA = { code_review: "code-review" }`.

The builtin skill carries `builtinTools: ["code_review"]`. When the skill is loaded, the skill renderer fetches the tool spec and injects it under a “Builtin Tools” section, making it directly callable. Its gating description is:

````text
Perform a formal code review. Use ONLY when the user explicitly requests the code-review skill/tool. Do NOT use when "review" appears in other contexts like "review changes for context", "review what happened", or "review commits to find a bug" — those are requests to read/understand code, not to perform a formal code review.
````

This separates formal-review requests from ordinary requests to inspect or understand changes.

## `amp review` CLI

### Command, argument, and flags (verbatim)

Command description:

````text
Run a code review through a smart-mode thread
````

| Syntax | Help text | Default / behavior |
|---|---|---|
| `[diff_description...]` | `Description of the diff or changes to review (default: uncommitted changes)` | Joined with spaces; empty becomes `git diff HEAD and newly added untracked files` |
| `-f, --files <files...>` | `Specific files to focus the review on` | Optional variadic list |
| `-i, --instructions <text>` | `Additional instructions to guide the review` | Optional |
| `-s, --check-scope <dir>` | `Directory to search for checks` | Optional |
| `-c, --check-filter <checks...>` | `Specific check names to run` | Optional variadic list |
| `--checks-only` | `Only run checks, skip the main review agent` | false/absent |
| `--summary-only` | `Only generate and print the diff summary, skip full review` | false/absent |
| `--thinking <level>` | `Thinking level: "low" (default) or "high"` | Parser accepts only `low` or `high`; downstream default is `low` |
| global `--dangerously-allow-all` | `Disable all command confirmation prompts (agent will execute all commands without asking)` | false; may also be enabled in settings |

The command's appended help text is:

````text
The diff_description tells the tool what changes to review. It can be:
  - A git command: "git diff HEAD~3"
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
````

### Permission gate

Before summary generation or review, `zT4` requires either the global CLI option or settings value `dangerouslyAllowAll`. Otherwise it prints exactly:

````text
Error: The review command is currently experimental and does not yet support permissions. Rerun with `amp --dangerously-allow-all review` to bypass permissions and execute all tool calls requested by the model.
````

It exits with code `1`. This gate also applies to `--summary-only`.

### CLI flow

1. `GT4` verifies Git and obtains the repository root with `git rev-parse --show-toplevel`.
2. `--files` paths are resolved against the process cwd and converted to paths relative to that root.
3. `mV6` asks Haiku to generate full-diff git commands using `_V6`, validates them with `T_0`, executes them via `execFile("git", argv)` in the repository root, and joins stdout.
4. `ZT4` asks Gemini 3 Flash Preview for the `PV6` summary. It parses both `<summary>` and `<fileOrder>`, but `GT4` prints only the summary and generated command list.
5. Unless `--summary-only`, `GT4` starts a quiet Smart-mode thread with `xV6`, which requires exactly one `code_review` call and no other follow-up work.
6. `bV6` finds assistant `code_review` tool-use IDs, then scans backward for a matching successful user `tool_result`. `hV6` extracts a matching tool error; `gV6` extracts a terminal assistant/thread error.
7. `fV6` combines main comments with `Vp0`-converted check issues, or returns check issues alone for `--checks-only`.
8. `yV6` filters low-severity comments and renders review/check output.

Summary generation failure is printed but does not prevent the full review. Empty diff text yields no summary from `mV6`; `ZT4` itself has a defined empty-diff result (`No differences between the selected revisions.`) when called directly with an empty string.

### Output and hyperlinks

`yV6` applies:

```ts
comments.filter((comment) => comment.severity !== "low")
```

Thus `low` is hidden, while comments with missing severity remain visible. This filtering is CLI presentation only; tool results retain low-severity comments.

`SV6` groups comments by repository-relative filename. Positive line numbers render as an OSC 8 hyperlink whose target is logically:

```text
vscode://file/<absolute-file-path>:<line>
```

The emitted terminal sequence is:

```text
ESC ] 8 ; ; vscode://file/<absolute-file-path>:<line> BEL @L<line> ESC ] 8 ; ; BEL
```

A line of `0` produces no line hyperlink. Check issues use `line` for both start and end (unless an `endLine` happens to exist on the issue object). Main-comment `source` is cleared; check comments retain their check source.

Check summaries render `ok`, `issues found`, `error`, or `running`. Their issue counts are not filtered by severity, so the checks section can report issues even when all corresponding low-severity comments are hidden above.

## TUI progress rendering

The general TUI recognizes `code_review` as a subagent activity with labels `Reviewing code` / `Reviewed code`, detail from trimmed `diff_description`, and `review` actions such as:

```text
Code review queued
Code review failed: <error>
Check <name>: complete
Check <name>: ok
Check <name>: <N> issue(s) found
Check <name>: error (<error>)
Check <name>: <current message>
Main review complete, running checks...
Code review complete
Reviewing code changes...
```

Its summary is `<completed>/<total> checks · quick code review` when `thinking === "low"`, otherwise `<completed>/<total> checks · code review`; with no checks it uses only the review label. Completed and errored checks both increment the completed count.

## Scale and constants

| Constant / location | Value | Meaning |
|---|---:|---|
| `Pi1` | `24` | Main review `maxTurns`, including the final-report follow-up run because the same runner retains turns |
| `Ti1` | `36` | Per-check `maxTurns` |
| `QE4` | `1` | Failed-check retry rounds after the initial run |
| Main prompt guideline | `2` | Do not retry failed tool calls more than 2 times |
| Main prompt threshold | `100` files | Abort above this changed-file count |
| Main prompt threshold | `10,000` lines | Abort above this diff length |
| `GRQ` helper | `30,000 ms` | `AbortSignal.timeout` while creating the Haiku client/call context |
| `GRQ` helper | `2,000` | `max_tokens` |
| `GRQ` helper | `0` | temperature |
| `_V6` helper | `30,000 ms` | `AbortSignal.timeout` |
| `_V6` helper | `2,000` | `max_tokens` |
| `_V6` helper | `0` | temperature |
| `ZT4` summary | `0.1` | Gemini temperature |
| `ZT4` summary | `MINIMAL` | Gemini thinking level |
| Main review | `LOW` / `HIGH` | Gemini thinking levels selected by tool `thinking` |
| `L5` generic rate-limit retry | `3` retries | Enabled for both main/check agents by `retryOnRateLimit: true` |
| `L5` retry delay | `4,000 ms × 2^attempt`, capped at `60,000 ms` | Generic subagent inference backoff |
| `L5` repeated tool error | `3` identical occurrences | Generic subagent abort threshold |
| CLI spinner | `80 ms` | TTY animation interval |
| CLI interrupt | exit `130` | SIGINT exit status |
| CLI argument/gate errors | exit `1` | Invalid thinking, missing permission bypass, or review failure |
| XML deleted-file convention | line `0` | Both `startLine` and `endLine` |

The helper timeout wraps `Bz(..., AbortSignal.timeout(30000))`; command execution itself has no timeout in the shown `GRQ`, `zRQ`, `_V6`, or `mV6` paths.

## Caveats and gotchas

- **Large-diff abort:** `DE4` tells the model to abort above 100 changed files or 10,000 lines and emit one critical issue. This is prompt-enforced, not a preflight count in the tool implementation.
- **Avoided diff forms:** unless explicitly requested, the main agent is told to avoid `git diff <base-ref> <head-ref>`, `git diff <base-ref>..<head-ref>`, and `git diff HEAD...origin/HEAD`.
- **`origin/HEAD` assumption:** reference commands require the remote symbolic default-branch ref. Repositories without a usable `origin/HEAD` can make those commands fail; the prompt forbids assuming `main`, `origin/main`, or `origin/master`.
- **Untracked files:** the main prompt says to remember them. Default check discovery and CLI summary explicitly add `git ls-files --others --exclude-standard`; generated commands depend on the helper output.
- **Deleted files:** main review comments must use `startLine=0` and `endLine=0`. Checks discover files with `--diff-filter=AM`, so deleted files are absent from the default check target list.
- **Lenient main XML:** `BB`/`Hz` use string searches rather than an XML parser. Missing `<codeReview>` means zero comments. Missing fields become empty strings or line `0`; malformed numbers can become `NaN`. Unknown nonempty `commentType` becomes `"unknown"`; invalid severity is omitted. Five XML entities are decoded.
- **Lenient check XML:** status is `completed` only for exact `<status>completed</status>`; otherwise `error`. Issues require recognized severity, a quoted `file`, and nonempty problem/body. Nonmatching issues are silently skipped.
- **Exact check path contract:** `XRQ` says an issue's `file` attribute **must** match the exact diff-header path. `FE4` then treats relative values as relative to the review working directory.
- **Shell-syntax rejection:** `VRQ = /\$\(|`|\|\||&&|[;|<>]/` rejects command substitution, backticks, `||`, `&&`, semicolons, single pipes, and redirection-like `<`/`>`. `T_0` also requires the first whitespace-delimited token to be exactly `git`. It does not invoke a shell; accepted text is split on whitespace into `execFile` argv, so quoting is not shell-parsed.
- **Validator fallback differs by caller:** `T_0` itself falls back to `git diff --name-only --diff-filter=AM`. `_V6` therefore does not reach its apparent two-command `FT4` fallback when all generated commands are rejected, because `T_0` already returns a nonempty file-list command. This can make CLI “full diff” summary input contain filenames rather than diff content.
- **`checksOnly`:** `YE4` substitutes a synthetic successful main status with exactly `<codeReview></codeReview>` and no turns. Checks still run normally.
- **Explicit empty arrays contradict the schema descriptions:** `files: []` is retained as `targetFiles`, so checks do not call `zRQ`, discover no per-file checks, and run none; the main review still reviews the described diff. `checkFilter: []` is truthy in JavaScript and filters out every check. The CLI avoids both cases by omitting empty arrays.
- **Files without instructions inject `undefined`:** `YE4` initializes its instruction accumulator from optional `instructions`, then uses `+=` when a nonempty `files` list exists. If `instructions` is absent, the main agent receives an additional-instructions block beginning with the literal text `undefined` before `Focus on these files:`.
- **Low severity:** only `amp review` output hides `severity === "low"`; the tool/TUI data still includes it.
- **Single check retry:** `QE4 = 1` means one retry, not one total attempt.
- **Helper timeouts:** both Haiku command-generation calls use 30-second abort signals, `max_tokens: 2000`, and temperature `0`.
- **Per-file scoping is discovery-only:** `AE4` builds `checksPerFile`, but `BE4` invokes every selected check with all target files.
- **Frontmatter `tools` is inert here:** parsed check-specific tools do not alter the fixed check-agent tool list.
- **Name collisions:** first discovered name wins, potentially suppressing a farther/global check. Check runs themselves are keyed by URI, not name.
- **Cancelled checks:** check retries select only `error`; `MRQ` maps any non-`done`, non-`error` check—including `cancelled`—to `in-progress`. A cancelled check can therefore leave the aggregate result nonterminal even after the checks observable completes.
- **Check parse error vs agent error:** a done agent response lacking `<checkResult>` maps to a done check run whose nested parsed result says `error`; an agent status `error` maps to a top-level check-run error.
- **Permission bypass:** `amp review`, including `--summary-only`, refuses to run without `--dangerously-allow-all` or the equivalent setting because this experimental command has no permission UI.
- **CLI severity/source behavior:** main sources are discarded for rendering; check sources are retained. Missing severities are displayed because only exact `low` is filtered.
- **No explicit check concurrency limit:** all checks are subscribed concurrently; a large check set can fan out heavily.
- **No check files:** the checks track completes immediately with `[]`; the main track can still complete normally.
- **User rejection in a subagent:** generic `L5` behavior reports a `done` status with “User rejected a tool invocation. Subagent execution aborted.” That text is then fed to XML parsing and can appear as an empty review or check parse error rather than an agent-status error.

## Source index

| Area | Pretty-printed lines |
|---|---:|
| Deferred-tool predicates and mode definitions | 74,940–75,180 |
| Models and subagent specs | 158,289–158,345 |
| Builtin skill and tool mapping | 170,178–170,364 |
| Haiku model alias `qR` | 177,314 |
| XML helpers | 183,027–183,049 |
| Complete tool/check implementation | 183,130–183,980 |
| Agg Man canonical prompt and routing | 190,154–190,208 |
| TUI review activity rendering | 222,823–223,090 |
| `amp review` CLI | 286,950–287,500 |
| Global `--dangerously-allow-all` definition | 289,683 |
