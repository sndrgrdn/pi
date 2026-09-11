# CONTEXT

Glossary of domain terms for the custom pi extensions in this repo (web tooling, bash backgrounding, compaction continuation, context window capping).

## Web tooling language

The table below covers the web tooling domain (custom pi extensions: `webfetch`, `websearch`).

| Term | Canonical definition | Notes |
| --- | --- | --- |
| Web fetch (`webfetch`) | Retrieving the content of one specific URL. One URL in, one document out. | The opposite of web search along the discovery axis. |
| Web search (`websearch`) | Discovery: asking a search engine for up-to-date information beyond the model's knowledge. Many candidate pages in, ranked results out. | Answers "what exists?"; web fetch answers "what is at this address?". |
| Search engine | A web search backend that answers a query with results (Exa, Parallel). | Never "provider": that word is reserved for model providers in pi. |
| Query | The search input string. The only parameter web search takes. | |
| Result | One search hit: `{ url, title?, content?, time.published? }`. | |
| Engine selection | The configured default search engine. A user preference, not a per-query choice. | |
| Credential | An API key for a search engine, resolved from the environment or `auth.json` under the engine's id. | Keys are optional; both engines work without one. |
| Truncation | The rule that tool output is bounded. Oversized bodies are parked out-of-band (temp file) rather than truncated silently. | |

## Bash backgrounding language

**Background process**:
A command whose tool call returned while the command kept running.
_Avoid_: job, task, child process

**Foreground**:
The phase while a command's tool call is still waiting for the command to finish.
_Avoid_: blocking, sync phase

**Auto-background**:
Moving a still-running foreground command to the background after the auto-background delay (30 seconds).
_Avoid_: backgrounding (ambiguous: that word also names the resulting state)

**Immediate background**:
Starting a command in the background right away via `background: true`, skipping the foreground phase entirely.
_Avoid_: background=true (the parameter spelling, not the concept)

**Timeout**:
Deliberately unsupported. A command that outlives the auto-background delay is backgrounded, never killed by a deadline.
_Avoid_: (none: the word should not appear in this domain at all)

**Cancel**:
Terminating a background process with `bash_cancel`. SIGKILLs the process group, children included. Only valid while the process is running.
_Avoid_: kill, terminate, stop

**Cancelled**:
The state of a process we SIGKILLed (via cancel, or session cleanup).
_Avoid_: killed, dead

**Completed**:
The state of a process that ended without our intervention: an exit code, or a signal (shown as "exited (signal)").
_Avoid_: exited, done

**Abort**:
Cancelling the tool call itself (a turn abort). Kills only the foreground phase; background processes survive.
_Avoid_: cancel (reserved for `bash_cancel`)

**Status wait**:
The optional `wait_seconds` bound on `bash_status`: the call blocks until the process completes or the bound expires, then returns the state and output. It observes without stopping; `bash_cancel` preempts it.
_Avoid_: polling (still used informally), timeout (reserved for the banned concept)

**Id**:
A background process's pid, used as the key for `bash_status` and `bash_cancel`.
_Avoid_: shell-N

**Output file**:
The lossless temp file holding a background process's full output; the status tool shows a capped tail plus the file path.

**Session scope**:
Background processes live for the session; shutdown kills every still-running one.

## Compaction continuation language

**Compaction**:
The pi session compaction that collapses history into a compaction entry.

**Continuation**:
The follow-up message sent after compaction, telling the model to resume the task from the session branch instead of waiting for a user prompt.
_Avoid_: resume prompt

## Context window capping language

**Context window cap**:
The policy applied by `cap-context-window`: every model's effective window becomes `min(200000, declared window)`.
_Avoid_: limit (ambiguous with output-token limits)

**Declared window**:
The `contextWindow` value a model or provider catalog advertises.

**Effective window**:
The window pi uses for compaction and output clamping after the cap.

**Undeclared window**:
A model with no `contextWindow`; the composer default is 128000, below the cap, so it is never clamped.

**Native provider wrap**:
Capping a built-in or native-extension provider by wrapping its `getModels()`. Refreshed catalogs are capped automatically because the composer re-reads the base provider on every call.

**Config-style re-registration**:
Capping a provider registered as `{ name, models, refreshModels }` by re-registering its config with capped `models` and a capped `refreshModels`. Required because the composer re-applies the raw config above any wrapped base.
