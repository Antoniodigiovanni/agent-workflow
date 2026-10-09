import { SessionStore } from '../../core/store.mjs';
import { initialState, parseAction, transition } from '../../core/state.mjs';
import { context } from './context.mjs';
import { transcriptBranch, snapshot, atBranch } from './transcript.mjs';
import { pathToFileURL } from 'node:url';

export const COMMAND = '/workflow:session';
const ownPrompt = prompt => typeof prompt === 'string' && /^\/workflow:session(?:\s|$)/.test(prompt.trim());

function output(event, additionalContext, extra = {}) {
  return additionalContext ? { ...extra, hookSpecificOutput: { hookEventName: event, additionalContext } } : extra;
}

export async function handleHook(input, store = new SessionStore()) {
  const id = input.session_id;
  const event = input.hook_event_name;
  if (input.agent_id && event !== 'PreToolUse') return {};
  const promptKey = typeof input.prompt_id === 'string' ? `prompt:${input.prompt_id}` : null;
  const observeTurn = record => {
    record.turnControlRevision = record.state.controlRevision;
    if (promptKey) record.turns[promptKey] = record.state.controlRevision;
  };

  if (event === 'UserPromptExpansion') {
    // Match the original user command, never an agent's Skill tool call or another plugin's session skill.
    if (input.expansion_type !== 'slash_command' || !ownPrompt(input.prompt) || input.command_source !== 'plugin') return {};
    const rawArgs = input.prompt.trim().slice(COMMAND.length).trim();
    const parsed = parseAction(rawArgs);
    const record = parsed.action && parsed.action !== 'status'
      ? await store.update(id, record => {
        record.state = transition(record.state, parsed);
        observeTurn(record);
      })
      : await store.read(id);
    return output(event, await context(record.state, id, { control: parsed.action || '', task: parsed.task }));
  }

  if (event === 'SessionStart') {
    const exists = await store.exists(id);
    const branch = await transcriptBranch(input.transcript_path);
    let warning = '';
    const record = await store.update(id, async record => {
      if (input.source === 'fork' && !exists) {
        let inherited = null;
        for (const sourceId of branch.sessionIds) {
          if (sourceId === id) continue;
          inherited = atBranch(await store.read(sourceId), branch.anchors);
          if (inherited) break;
        }
        record.state = inherited || initialState();
        if (!inherited) warning = 'No saved workflow checkpoint matched this fork point. This fork starts off; select a workflow explicitly to continue.';
      } else if (input.source === 'resume' && exists && record.history.length && branch.anchors.length) {
        const latest = record.history.at(-1);
        if (!branch.anchors.includes(latest.anchor)) {
          record.state = atBranch(record, branch.anchors) || initialState();
          // Make restoration a new control generation so in-flight work observes the switch.
          record.state.controlRevision = Math.max(record.state.controlRevision, latest.state.controlRevision) + 1;
          record.state.revision = Math.max(record.state.revision, latest.state.revision) + 1;
          warning = 'Workflow state restored at the current transcript branch. Restoration grants no new task authority.';
        }
      }
      record.turnControlRevision = null;
      if (record.state.mode) snapshot(record, branch.anchors);
    });
    return output(event, await context(record.state, id, { warning }));
  }

  if (event === 'UserPromptSubmit') {
    const branch = await transcriptBranch(input.transcript_path);
    const record = await store.update(id, record => {
      observeTurn(record);
      // Transcripts lag the prompt. A new control must not overwrite an older
      // branch checkpoint before its own user message has been written.
      if (record.state.mode && !ownPrompt(input.prompt)) snapshot(record, branch.anchors);
    });
    // The expansion hook will process the control and load only the resulting mode.
    if (ownPrompt(input.prompt)) return {};
    return output(event, await context(record.state, id));
  }

  if (event === 'PreToolUse') {
    const record = await store.read(id);
    const observed = promptKey ? record.turns[promptKey] : record.turnControlRevision;
    if (observed !== undefined && observed !== null && observed !== record.state.controlRevision) {
      return { continue: false, stopReason: 'Workflow selection changed during this turn. Stop at this tool boundary and wait for the next user instruction.' };
    }
    return {};
  }

  if (['Stop', 'StopFailure', 'PostToolUse', 'SessionEnd'].includes(event)) {
    const branch = await transcriptBranch(input.transcript_path);
    if (!branch.anchors.length) return {};
    const record = await store.read(id);
    if (!record.state.mode) return {};
    await store.update(id, record => { snapshot(record, branch.anchors); });
    // Never block Stop or install automatic continuation loops.
    return {};
  }
  return {};
}

async function main() {
  let input;
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    input = JSON.parse(raw);
    const result = await handleHook(input);
    if (Object.keys(result).length) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const reason = `Agent Workflow: ${error.message}`;
    if (input?.hook_event_name === 'UserPromptExpansion') {
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
    } else if (input?.hook_event_name === 'PreToolUse') {
      process.stdout.write(`${JSON.stringify({ continue: false, stopReason: `${reason}. Restore current workflow state before continuing tools.` })}\n`);
    } else {
      // Make the loss of current state explicit rather than silently reactivating old instructions.
      process.stdout.write(`${JSON.stringify({ systemMessage: reason, hookSpecificOutput: {
        hookEventName: input?.hook_event_name || 'SessionStart',
        additionalContext: `${reason}. Current workflow state is unavailable. Historical Pair/Delegate text does not authorize workflow continuation. Report the problem and use ordinary harness behavior until state is restored.`,
      } })}\n`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
