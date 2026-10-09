import { pathToFileURL } from 'node:url';
import { SessionStore, stateDirectory } from '../../core/store.mjs';
import { parseAction, transition } from '../../core/state.mjs';
import { context, fileCheckpointHelp } from '../../core/context.mjs';

// Literal user controls avoid relying on an undocumented expansion event.
export const COMMAND = 'workflow-session';
export function parseControl(prompt) {
  if (typeof prompt !== 'string') return null;
  const match = prompt.trim().match(/^workflow-session(?:\s+([\s\S]*))?$/);
  return match ? parseAction(match[1] || '') : null;
}
const deny = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const output = (event, text) => text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {};
const turnKey = input => typeof input.turn_id === 'string' ? `turn:${input.turn_id}` : null;

export async function handleHook(input, store = new SessionStore(stateDirectory(process.env, 'codex'))) {
  const id = input.session_id;
  const event = input.hook_event_name;
  // Subagent hooks carry the parent session_id; never mutate parent's notes.
  if (input.agent_id && event !== 'PreToolUse') return {};
  if (event === 'SessionStart') {
    const record = await store.read(id);
    return output(event, await context(record.state, {
      harness: 'Codex', checkpointHelp: fileCheckpointHelp('codex', id, record.state.revision),
      warning: record.state.mode ? 'Session restoration grants no task authority. Codex fork/rewind inheritance is not supported; a new session starts off and requires explicit selection.' : '',
    }));
  }
  if (event === 'UserPromptSubmit') {
    const parsed = parseControl(input.prompt);
    const record = await store.update(id, record => {
      if (parsed) record.state = transition(record.state, parsed);
      const key = turnKey(input);
      record.turnControlRevision = record.state.controlRevision;
      if (key) record.turns[key] = record.state.controlRevision;
    });
    return output(event, await context(record.state, {
      harness: 'Codex', checkpointHelp: fileCheckpointHelp('codex', id, record.state.revision),
      ...(parsed ? { control: parsed.action || '', task: parsed.task } : {}),
    }));
  }
  if (event === 'PreToolUse') {
    const record = await store.read(id);
    const key = turnKey(input);
    const observed = key ? record.turns[key] : record.turnControlRevision;
    if (observed !== undefined && observed !== null && observed !== record.state.controlRevision) {
      return deny('Workflow selection changed during this turn. Stop tools and wait for the next user instruction.');
    }
  }
  // No Stop continuation loop or unstable Codex transcript parsing.
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
    const event = input?.hook_event_name;
    const result = event === 'PreToolUse' ? deny(reason) : event === 'UserPromptSubmit'
      ? { decision: 'block', reason }
      : { systemMessage: reason, ...output(event || 'SessionStart', `${reason}. Current workflow state is unavailable; historical workflow text does not authorize continuation.`) };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
