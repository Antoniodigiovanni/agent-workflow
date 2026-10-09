# Trial evidence

## Version 0.2.0 — 2026-10-09

Platform: macOS. Runtime: Node.js 26.8.2. Harnesses: Claude Code 2.1.288, Codex CLI 0.160.0, Pi 0.80.3. No authenticated live model acceptance trial has been completed.

Completed:

- 40 deterministic tests covering shared state, Claude regression behavior, Codex prompts/hooks and supported deny output, Pi native-branch restoration/controls/checkpoints, and standalone package relocation.
- Syntax/JSON checks, skill and hook wiring checks for all three harnesses, resource isolation, and version consistency.
- Three standalone package directories generated from shared source: Claude Code, Codex, and Pi. Relocated runtime/contract loading verified; native Codex and Pi smoke checks also pass against their standalone outputs. npm pack dry-run includes all runtime files and both plugin manifests.
- Claude strict plugin and marketplace validation plus isolated marketplace installation, command discovery, Pair/Delegate selection, off/on/status, resume, and native fork fallback. No authenticated model request.
- Codex isolated installation from the repository's legacy marketplace catalog. The CLI selects `.codex-plugin/plugin.json`, with Codex-specific skill and hooks. Native SessionStart/UserPromptSubmit selection persisted Pair before the model request. Reproducible smoke uses a dummy local endpoint and temporary configuration; no user trust or installation changes.
- Pi isolated CLI local package installation, resource isolation, real SDK extension loading and inactive context; native `/workflow pair` command; JSON-schema-validated `workflow_checkpoint` execution and continuation context; status/off/on without model calls; resume from a native session file; native tree navigation and fork-point inheritance. Model responses come from Pi's offline faux provider; this tests integration, not reasoning or conversational acceptance.

Reproduce with `npm test`, `npm run check`, `npm run package`, `npm run validate:claude`, and the three `smoke:<harness>` commands. Smoke commands are optional when that harness is not installed.

Pending:

Run `evals/scenarios.md` in authenticated sessions against sandbox Git repositories for each adapter. Begin with Pair investigation/handoff, then Delegate through a real PR and review-correction cycle. Exercise live compaction, controls during work, and branch behavior within the documented limits. Record model, task, transcript, diff, checks, PRs, failures, and contract changes. Infrastructure success does not establish model acceptance.

## Version 0.1 — 2026-10-05

Claude Code 2.1.288, Node.js 26.8.2, macOS. Automated state/storage/helper/hooks, syntax/JSON, strict manifests, temporary marketplace installation, and CLI command/resume/fork fallback checks completed without credentials.

The CLI trial established that command expansion precedes UserPromptSubmit and attachment rows participate in transcript ancestry. Native fork SessionStart exposed a new ID and an unpopulated transcript without a source ID, so the adapter starts such forks off. Live model trials remained pending.
