# Compatibility

Version 0.2.0 checked on 2026-10-09 on macOS with Claude Code 2.1.288, Codex CLI 0.160.0, Pi 0.80.3, and Node.js 26.8.2. Shared runtime code uses Node.js 20+ built-ins only. CI runs the deterministic tests/checks on Node 20, 22, and 24. Pi 0.80.3 itself requires Node 22.19+.

| Capability | Claude Code | Codex | Pi |
| --- | --- | --- | --- |
| Native packaging | Strict manifest validation and isolated CLI installation | Isolated CLI marketplace installation; explicit Codex manifest selected | Explicit Pi manifest; real SDK extension loading |
| Session control | `/workflow:session` expansion hook | Literal `workflow-session` user prompt hook; skill is help only | Registered `/workflow` command |
| Fresh session off | Fixtures and real CLI | Fixtures and SessionStart integration | Fixtures and real SDK |
| Pair/Delegate, off/on/status | Fixtures and real CLI before model | Fixtures; native Pair prompt selection before offline request | Fixtures; native Pair selection and off/on/status via SDK |
| Resume | Real CLI same-session restoration | Same-session file restoration fixture | Real SDK reopen from disk |
| Compaction | SessionStart compact fixture | SessionStart compact fixture | Native branch restoration fixture; per-request context refresh; live compaction pending |
| Checkpoint notes | Helper, stale revision, corruption, concurrency tests | Shared helper/state rules and Codex hook fixtures | Real SDK schema validation and checkpoint tool execution |
| Fork | Native fork starts off; available ancestry inheritance fixture | New session IDs start off; no ancestry inheritance | Real native branched-session inheritance at selected ancestry |
| Rewind/tree | Ancestry journal fixture; experimental | Unsupported; latest session notes remain, inspect status and establish intended scope | Real SDK tree navigation plus branch fixtures |
| Mode changes during work | Prompt-generation guard; interrupt normally | Turn-generation deny guard; interrupt normally | Abort/wait before control plus generation guard fixtures |
| Live model behavior | Pending | Pending | Pending; smoke uses an offline faux provider |

No adapter claims to undo a running external operation. Codex hosted tools and specialized paths may bypass local tool hooks; a hook is not a complete enforcement boundary. Workflow rules and notes require model cooperation.

## Harness-specific requirements and limits

Claude hooks must be enabled. `--bare` and `--safe-mode` disable the intended controls. Native fork SessionStart does not expose source ancestry before its transcript exists in the tested release. Such forks explicitly start off; select Pair or Delegate again. Transcript navigation remains experimental because writes and events can lag.

Codex hooks must be enabled and trusted. Plugin hooks are non-managed hooks and are skipped until reviewed/trusted by the host. The package explicitly references Codex hooks so it never loads the Claude hook schema. There is no claimed slash-command expansion integration: literal controls are intercepted in UserPromptSubmit. `$workflow-session` provides help only. New session IDs are isolated; transcript rewind does not restore earlier notes. Native smoke uses a reviewed temporary installation, a per-process hook-trust override, read-only tool sandbox, and a dummy local endpoint; it changes no user installation/trust or credentials.

Pi uses native custom session entries. Ephemeral/no-session mode provides in-memory notes only. `WORKFLOW_STATE_DIR` does not apply. Commands alone do not force model requests for status or off/on with a selection. Bare controls and missing task/mode responses use the chosen model, with tools blocked for the control response. The checkpoint tool remains registered but rejects writes when off; the extension does not override user tool allowlists. Live compaction and interruption of a real task remain pending.

No cloud/remote-session parity, Windows verification, model-level acceptance, automatic merge/deploy, global output style, permission grants, or continuation loop is claimed.

Filesystem corruption is reported rather than silently resetting selection. Claude/Codex state uses a per-session lock: after confirming the process has ended, remove a leftover `.lock` directory from a crashed writer. Pi corruption must be repaired in the affected native branch or the user must start a fresh session.

## Interface references

- [Claude hooks](https://code.claude.com/docs/en/hooks), [skills](https://code.claude.com/docs/en/skills), and [marketplace packaging](https://code.claude.com/docs/en/plugin-marketplaces).
- [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins) and [hook schema, trust, and coverage](https://learn.chatgpt.com/docs/hooks).
- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), and the installed Pi 0.80.3 SDK/docs.
