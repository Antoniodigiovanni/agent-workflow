# Shared workflows, native adapters

Version 0.2 extends the Claude-first implementation with Pi and Codex in the same repository. Pair and Delegate have one behavioral source; each harness owns its integration and persistence lifecycle.

## What co-lives

- `workflows/common.md`, `pair.md`, and `delegate.md`: the sole maintained collaboration contracts.
- `core/state.mjs`: state schema, validation, parsing, transitions, revision-guarded task checkpoints.
- `core/context.mjs`: current-state receipts, selected contract loading, and control-response instructions. Adapter-specific checkpoint guidance is supplied as a parameter.
- `core/store.mjs` and `helper.mjs`: atomic filesystem storage and notes-only helper logic reused by Claude and Codex. Default directories remain separate.
- `adapters/<harness>/`: native event handling, commands, helper entrypoints, and harness-specific skill or hook configuration.
- Root package manifests, documentation, acceptance scenarios, and tests: one version and one release source.

Installation enables discovery, not activation. Fresh sessions start off. Pair ends at the current agreed step; Delegate ends at verified PRs and human review. No mode changes permissions, installs automatic subagents, or grants merging/deployment authority.

The common context renderer never selects a workflow. Only explicit user controls pass through the shared transition function. Checkpoint helpers/tools update task fields only; they cannot change mode, reactivate off, or accept stale writes.

## What is intentionally not reused

Lifecycle events and transcript parsing are not interchangeable. Claude's UserPromptExpansion, Codex's hook output schema, and Pi's extension API need separate adapters. Sharing these would hide differences rather than remove duplication.

Persistence follows the native interfaces available:

| Adapter | Selection boundary | Persistence/restoration | Model checkpoint mechanism |
| --- | --- | --- | --- |
| Claude Code | Exact plugin slash-command expansion | Per-session file plus Claude ancestry journal | Notes-only CLI helper |
| Codex | Exact literal user prompt in UserPromptSubmit | Per-session file, resume/compact by ID | Same helper logic with Codex directory |
| Pi | Native registered `/workflow` command | Custom entries on native current branch | Native `workflow_checkpoint` tool |

Pi does not emulate Claude hooks or keep a second filesystem journal. `getBranch()` gives the actual visible ancestry, including retained custom entries across compaction; forks and tree navigation restore the corresponding state. `getEntries()` would include abandoned branches and is deliberately not used.

Codex does not parse its unstable transcript format or pretend to support an undocumented expansion event. `workflow-session ...` is ordinary user text intercepted before the model. The `$workflow-session` skill explains this control and has no authority to mutate state. A new session ID starts off; rewind retains the latest notes for that ID and requires explicit user verification/reselection.

## Integration behavior

Claude preserves the existing eight-hook lifecycle, exact user-only command recognition, prompt generations, and experimental ancestry restoration. Its context/helper wrappers now call the shared renderer/helper rather than maintain their own copies.

Codex uses SessionStart, UserPromptSubmit, and PreToolUse. Each prompt records its control generation using `turn_id`. A stale tool request returns the supported `permissionDecision: deny` output, not Claude's `continue: false` shape. Model checkpoints cannot select modes. Subagent hooks do not mutate parent state; normal harness permission handling remains in charge. No Stop continuation hook is installed.

Pi registers the command and a notes-only tool. A control that changes activation or selection aborts old work and waits for idle before appending state. Status reads without starting a model turn. Off/on with a selection report directly; bare controls and selection without a task ask in ordinary chat and block tools for that response. Command-triggered custom messages run the agent directly, so the command captures its control generation without relying on `before_agent_start`, which only runs for ordinary prompts in Pi 0.80.3.

Pi refreshes current workflow context in the `context` event before every model request. It removes its own old custom control/context messages, preserves other extensions' messages, and injects the latest selected contract or off receipt. It does not overwrite the base system prompt, mutate active tool permissions, or replace compaction summaries. Native entries persist task notes separately from model context. Corrupt entries block checkpoints/tools and expose the error instead of resetting state.

State notes still depend on model cooperation. Deterministic storage does not prove scope adherence, a correct answer, or a successful handoff. These need live acceptance trials.

## Packaging decision

Keep one source repository and three native package descriptors at the root:

- `.claude-plugin/plugin.json` plus the existing marketplace and Claude hook/skill paths.
- `.codex-plugin/plugin.json`, explicitly referencing Codex skill/hook paths inside `adapters/codex/`. Codex supports the existing legacy marketplace location.
- `package.json` with an explicit Pi resource manifest. Empty skills/prompts/themes lists prevent discovery of another harness's resources.

There are no separately versioned npm workspaces and no runtime dependency on another adapter. `npm run package` generates standalone `dist/claude-code`, `dist/codex`, and `dist/pi` directories. Each contains its selected adapter, packaging metadata, and the same shared source. Maintainers edit canonical files; generated copies are ignored by Git. Packaging tests load the relocated runtimes and verify contracts resolve from inside each package.

This repository remains private to npm publishing; local/Git package installation and generated directories are supported. No registry publication or marketplace update is performed by the build.

## Next evidence

Authenticated live trials remain pending for all adapters: Pair investigation/handoff, Delegate implementation through a PR, review correction, interruption, and compaction during a conversation. Native integration smoke checks are useful evidence but do not establish model-level acceptance. Record harness/version, model, transcripts, diffs, checks, PRs, and observed failures using the evaluation rubric.
