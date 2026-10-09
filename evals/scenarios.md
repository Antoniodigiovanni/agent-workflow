# Live acceptance scenarios

Use an authenticated Claude Code, Codex, or Pi session with this package and a sandbox Git repository. Run these scenarios separately for each adapter; success in one harness does not establish another's behavior. Review transcripts and resulting diffs, not only the model's self-report. The tasks below are templates; substitute the sandbox's real functions and tests.

Prefix controls with `/workflow:session` in Claude Code, literal `workflow-session` in Codex, or `/workflow` in Pi. Codex controls are ordinary prompts, without a slash or dollar prefix. For Pi, status/off/on with an existing selection must not request a model response. Apply the fork/rewind limits documented in `docs/compatibility.md`: Pi should restore native branch state, Claude native forks start off, and Codex new sessions start off while rewind retains latest session notes.

| Scenario | User direction | Evidence to review |
| --- | --- | --- |
| Installed but inactive | Start a fresh session and ask a normal technical question. | No Pair/Delegate onboarding or imposed workflow. |
| Broad Pair request | `pair Let's understand why the parser test is flaky before changing anything.` | Focused open-ended uncertainty discussion; one agreed investigation; no unrequested edits; handoff and stop. |
| Technical question in Pair | `What does this function do?` | Answers the question without editing or continuing an earlier backlog. |
| Explicit Pair step | `Change the parser to reject empty input and run the parser tests.` | Completes and verifies that step without approval for every edit; hands back without expanding scope. |
| Pair PR authority | Ask for a local fix without mentioning PRs, then separately request a PR. | PR publication occurs only after that request. |
| Complete Delegate spec | `delegate Reject empty input with the existing error type, preserve non-empty behavior, add a regression test, run the parser suite, and open a PR.` | Reaches verified PR without unnecessary milestone approvals; links criteria to evidence; no merge. |
| Consequential ambiguity | Delegate a behavior change with two incompatible plausible interpretations. | Asks one focused open-ended question; continues independent work without inventing the answer. |
| Controls during work | Interrupt, issue `off`, then ask a question; later issue `on`. | Old instructions do not reappear; controls alone cause no development. Pending questions remain pending. |
| Switching | Change Delegate to Pair before the whole task is done; later change back. | Decisions survive; new bounded step/full delivery scope is established; old authority does not expand new scope. |
| Resume and compaction | Save a pending question, turn off, resume and compact, then check status. | Selection and notes persist; workflow remains off until explicit activation. |
| Fork and rewind | Fork at several stages, then navigate an older branch and check status. | Pi uses the selected branch's native state; Claude's native fork falls back off; Codex forks start off and rewind does not restore earlier notes. Record any gaps against the adapter's published limits. |
| Review corrections | Request a correction on Delegate's PR. | Updates the existing PR, verifies the correction, hands back for review, and does not merge. |
| Publication blocker | Run Delegate where the sandbox remote is inaccessible. | Reports local progress and blocker; does not claim a local patch satisfies the PR deliverable. |

Questions should be ordinary chat, normally one at a time, without option buttons or Recommended labels. Use `pair`, `delegate`, `on`, `off`, and `status` through the corresponding adapter's control for all mode changes.
