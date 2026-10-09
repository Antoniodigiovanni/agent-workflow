# Agent Workflow

Choose how you collaborate with Claude Code, Codex, or Pi, separately for each session:

- **Pair:** complete the current agreed investigation, decision, or implementation step, report the result, and wait.
- **Delegate:** implement and verify a bounded task through PRs, then stop for review. Feedback starts a correction cycle; merging and deployment require separate instructions.

Installation makes the controls available. Fresh sessions start **off**. Mode selection does not change harness permissions or enable automatic subagents.

## One repository, three packages

The repository itself supports all three installers. Each harness has its own entrypoint and integration files; workflow contracts and state transitions are shared.

| Harness | Package entrypoint | Session control | State storage |
| --- | --- | --- | --- |
| Claude Code | `.claude-plugin/plugin.json` | `/workflow:session` | External per-session JSON files |
| Codex | `.codex-plugin/plugin.json` | Literal prompt `workflow-session` | Separate external per-session JSON files |
| Pi | `package.json` → `pi.extensions` | `/workflow` | Native custom entries on the current session branch |

For separate distributable directories, run `npm run package`. It builds `dist/claude-code/`, `dist/codex/`, and `dist/pi/`. Each includes its own adapter and a copy of the same shared core and contracts; none imports files from its parent or another package. These are generated outputs, not additional maintained copies.

Requires Node.js 20+ for this package. The installed harness may require a newer runtime; Pi 0.80.3 requires Node.js 22.19+. Checked with Claude Code 2.1.288, Codex CLI 0.160.0, and Pi 0.80.3. See [compatibility](docs/compatibility.md) for evidence and limits.

## Install in Claude Code

For a local checkout:

```sh
claude plugin marketplace add /absolute/path/to/agent-workflows
claude plugin install workflow@agent-workflow
```

Or test without installation:

```sh
claude --plugin-dir /absolute/path/to/agent-workflows
```

The existing GitHub marketplace source remains `Antoniodigiovanni/agent-workflow`. Start a new session after installation. Hooks must be enabled; `--bare` and `--safe-mode` do not provide these controls.

```text
/workflow:session
/workflow:session pair [task or context]
/workflow:session delegate [bounded task]
/workflow:session off
/workflow:session on
/workflow:session status
```

## Install in Codex

```sh
codex plugin marketplace add /absolute/path/to/agent-workflows
codex plugin add workflow@agent-workflow
```

Restart or reload the host as appropriate, then enable and review/trust the plugin's hooks using Codex's normal controls. Non-managed plugin hooks require trust. The plugin uses an explicit Codex hook path, so Claude hooks are not loaded into Codex. The existing `.claude-plugin/marketplace.json` is a supported legacy catalog location; Codex selects `.codex-plugin/plugin.json` from the same package root.

Submit these as **ordinary text prompts**, with no slash or dollar prefix:

```text
workflow-session
workflow-session pair [task or context]
workflow-session delegate [bounded task]
workflow-session off
workflow-session on
workflow-session status
```

`$workflow-session` loads the Codex help skill; it does not select a mode. Only exact literal user controls mutate state in the UserPromptSubmit hook. This avoids assuming Claude's slash-command expansion event exists in Codex. Ordinary prose and model skill calls do not select modes.

Codex restores notes by session ID on resume and compaction. New session IDs, including forks, start off. Branch rewind does not restore earlier workflow notes: check status and explicitly establish the intended scope again. No stable transcript ancestry interface is assumed.

## Install in Pi

```sh
pi install /absolute/path/to/agent-workflows
```

After these changes are published, the same repository can be installed with `pi install git:github.com/Antoniodigiovanni/agent-workflow`. The Pi manifest explicitly loads only the Pi extension; it does not discover Claude's skill directory. The package has no runtime npm dependencies.

For a quick trial without installation:

```sh
pi -e /absolute/path/to/agent-workflows/adapters/pi/extension.js
```

```text
/workflow
/workflow pair [task or context]
/workflow delegate [bounded task]
/workflow off
/workflow on
/workflow status
```

The extension saves state with Pi's native `appendEntry` API and reads only `getBranch()`. Resume, forks, tree navigation, and compaction therefore use the state at the visible branch, not the latest state on an abandoned branch. Ephemeral Pi sessions keep notes in memory only.

Status and off/on with an existing selection report their result without a model request. Bare controls, `on` without a selection, and selecting a mode without a task start a conversational response for the missing information; tools are blocked for that response. Selection with a task starts the requested work. A changing control aborts an active turn and waits for it to become idle before saving the new selection. Already-running external operations are not undone.

The model saves notes through `workflow_checkpoint`, which accepts a current revision and task fields only. It cannot select a workflow or turn one on. The extension refreshes current context before every model request, including continuation after a checkpoint or compaction, and removes only its own historical control/context messages.

## Control semantics

| Action | Result |
| --- | --- |
| No argument | Ask in ordinary chat how the user wants to collaborate; no default selection. |
| `pair` | Select Pair. With context, establish or execute one bounded step. |
| `delegate` | Select Delegate. With a task, establish the complete delivery scope and acceptance criteria. |
| `off` | Suspend workflow instructions while preserving the selected mode, notes, and source edits. |
| `on` | Restore selection and context, then wait for direction; ask for a mode if none was selected. |
| `status` | Report activation, selection, phase, scope, step, and pending question without development. |

Controls alone do not resume unfinished work. Switching modes retains accepted decisions while establishing the new scope. Questions remain questions and do not authorize implementation.

Delegate with a task authorizes task-related branches, commits, push, and PR creation within normal permissions. It stops for review and never merges or deploys by virtue of the mode. A blocked PR publication is incomplete delivery. Pair selection alone does not authorize PR publication.

## Session state

Claude notes are stored under `~/.claude/agent-workflows/sessions/`, or `CLAUDE_CONFIG_DIR`. Codex notes are stored under `~/.codex/agent-workflows/sessions/`, or `CODEX_HOME`. `WORKFLOW_STATE_DIR` overrides the complete filesystem state directory for the invoking adapter; use separate overrides when testing multiple harnesses. Pi does not use that override or these filesystem stores.

State lives outside installed plugin caches and working projects. File-backed updates use revision checks, atomic replacement, local user-only file permissions, and a per-session lock. Corrupt state is reported instead of silently resetting selection. Pi applies the same state validation and revision rules to native entries.

Claude's native fork limitation remains: the tested CLI does not expose source ancestry before the fork transcript exists, so forks start off with a notice. Available transcript ancestry is fixture-tested; rewind handling remains experimental. See [compatibility](docs/compatibility.md).

## Develop and verify

```sh
npm test
npm run check
npm run package
npm run validate:claude
npm run smoke:claude
npm run smoke:codex
npm run smoke:pi
```

The smoke commands require the corresponding installed harness. They use temporary configuration without changing user installations. Claude tests pre-model integration without credentials; Codex uses a dummy offline endpoint; Pi uses its real SDK with an offline faux provider. They verify integration, not live model behavior. `WORKFLOW_PI_PACKAGE_DIR` can locate a Pi SDK installed outside the usual npm layout.

The built packages can also be smoke-tested with `node scripts/smoke-codex.mjs dist/codex` and `node scripts/smoke-pi.mjs dist/pi`.

[Trial notes](docs/trial-notes.md) distinguish completed checks from pending live trials. [Scenarios](evals/scenarios.md) and the [rubric](evals/rubric.md) define behavioral acceptance. [Design](docs/design.md) explains what is shared and what stays in each adapter.
