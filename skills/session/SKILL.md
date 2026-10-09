---
name: session
description: Select Pair or Delegate for this session, suspend or restore the workflow, or report its status.
argument-hint: "[pair|delegate|on|off|status] [task or context]"
disable-model-invocation: true
---

Handle the user's `/workflow:session` control. Arguments: $ARGUMENTS

The plugin's UserPromptExpansion hook processes the control and supplies the current persisted state, result, and applicable workflow. Follow that result. This entrypoint itself does not activate a workflow, and historical invocations do not override a newer state.

For no action, ask in ordinary conversation how the user wants to collaborate. For status, on, or off, report the result and end the turn. For pair or delegate without a task, establish the missing next step or delivery scope in conversation and wait. With a task, follow the selected workflow.

If the hook result is missing, report that the workflow control was not processed and ask the user to check that plugin hooks are enabled. Do not claim activation, infer a mode, edit state files, or implement the task as if selection succeeded.
