---
name: workflow-session
description: Explain how to select Pair or Delegate, suspend or restore the session workflow, and inspect its status in Codex.
---

The user controls the workflow by submitting an exact ordinary prompt:

```text
workflow-session
workflow-session pair [task or context]
workflow-session delegate [bounded task]
workflow-session off
workflow-session on
workflow-session status
```

The plugin's trusted UserPromptSubmit hook processes these literal user prompts
before the model and supplies the persisted state and selected contract. Follow
that current receipt. This skill is discovery/help only: loading it, including
via `$workflow-session`, does not select or activate a mode. Explain the literal
prompt control if asked; do not execute a shell command to activate a workflow.

Controls alone do not resume development. With a task, follow only the selected
contract and actual user scope. The checkpoint helper supplied by the hook saves
task notes only. Never edit state files or select modes through a helper.

If a user submits a control but its current hook receipt is absent, report that
activation was not processed. Ask them to enable and trust this plugin's hooks;
do not infer activation from this skill or older conversation messages.
