# Agent Workflow

Explicit Pair and Delegate workflows for Claude Code sessions. Fresh sessions start off.

Pair completes the current agreed step and hands back; Delegate completes a bounded task through verified PRs and stops for review. Neither mode grants merge or deployment authority.

## Install

```sh
claude plugin marketplace add /absolute/path/to/agent-workflow
claude plugin install workflow@agent-workflow
```

## Controls

```text
/workflow:session
/workflow:session pair [task or context]
/workflow:session delegate [bounded task]
/workflow:session off
/workflow:session on
/workflow:session status
```

Controls alone do not resume development. Hooks must be enabled. Session notes are stored outside the project under the Claude configuration directory. Native forks start off when source ancestry is unavailable; rewind restoration is experimental.

## Verify

```sh
npm test
npm run check
npm run validate:claude
npm run smoke:claude
```

Requires Node.js 20+. CLI smoke verifies integration without authenticated model calls; live model behavior remains unevaluated.
