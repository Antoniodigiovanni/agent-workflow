import { initialState, validateState, parseAction, transition, checkpoint } from '../../core/state.mjs';
import { context, status } from '../../core/context.mjs';

export const STATE_ENTRY = 'agent-workflow:state:v1';
export const CONTEXT_MESSAGE = 'agent-workflow:context';
export const CONTROL_MESSAGE = 'agent-workflow:control';

// Read only the active branch: getEntries() includes abandoned branches.
export function branchState(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'custom' && entry.customType === STATE_ENTRY) return structuredClone(validateState(entry.data));
  }
  return initialState();
}

const noteProperties = {
  phase: { type: 'string' }, scope: { type: 'string' }, step: { type: 'string' },
  decisions: { type: 'array', items: { type: 'string' } },
  acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  pendingQuestion: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  prs: { type: 'array', items: { type: 'string' } },
};

export default function workflow(pi) {
  let state = initialState();
  let failure = null;
  let turnGeneration = null;
  let pendingControl = null;
  let controlOnly = false;
  const restore = ctx => {
    try { state = branchState(ctx.sessionManager.getBranch()); failure = null; }
    catch (error) { failure = `Agent Workflow: ${error.message}. Restore the current branch's workflow state before continuing.`; }
    return state;
  };
  const persist = next => { pi.appendEntry(STATE_ENTRY, next); state = next; };
  const refresh = (_event, ctx) => {
    restore(ctx);
    turnGeneration = null; pendingControl = null; controlOnly = false;
    if (failure && ctx.hasUI) ctx.ui.notify(failure, 'error');
  };
  pi.on('session_start', refresh);
  pi.on('session_tree', refresh);
  pi.on('session_compact', (_event, ctx) => { restore(ctx); });

  pi.registerCommand('workflow', {
    description: 'Pair or Delegate for this session: pair, delegate, on, off, status',
    handler: async (args, ctx) => {
      try {
        const parsed = parseAction(args);
        if (parsed.action === 'status') {
          restore(ctx);
          if (failure) throw new Error(failure);
          // A streaming sendMessage would steer the agent and request another
          // model iteration. Report directly instead of affecting active work.
          if (!ctx.isIdle() && ctx.hasUI) ctx.ui.notify(status(state), 'info');
          else pi.sendMessage({ customType: CONTROL_MESSAGE, content: status(state), display: true },
            ctx.isIdle() ? undefined : { deliverAs: 'nextTurn' });
          return;
        }
        // A new selection stops old work before writing its control checkpoint.
        if (!ctx.isIdle()) { ctx.abort(); await ctx.waitForIdle(); }
        restore(ctx);
        if (failure) throw new Error(failure);
        if (parsed.action) persist(transition(state, parsed));
        if (['off', 'on'].includes(parsed.action) && (parsed.action !== 'on' || state.mode)) {
          pendingControl = null;
          pi.sendMessage({ customType: CONTROL_MESSAGE, content: `${status(state)}\nNo task resumed.`, display: true });
          return;
        }
        pendingControl = { control: parsed.action || '', task: parsed.task };
        turnGeneration = state.controlRevision;
        controlOnly = !parsed.task;
        pi.sendMessage({
          customType: CONTROL_MESSAGE,
          content: parsed.task || 'The user requests a workflow selection response. Ask for the missing collaboration mode or task in ordinary chat, then wait.',
          display: true,
        }, { triggerTurn: true });
      } catch (error) {
        const message = `Agent Workflow: ${error.message}`;
        if (ctx.hasUI) ctx.ui.notify(message, 'error');
        else pi.sendMessage({ customType: CONTROL_MESSAGE, content: message, display: true });
      }
    },
  });

  pi.on('before_agent_start', (_event, ctx) => {
    restore(ctx);
    turnGeneration = state.controlRevision;
    // sendMessage(triggerTurn) runs the agent directly without this event.
    // This event is an ordinary user prompt, superseding any failed control turn.
    pendingControl = null;
    controlOnly = false;
  });
  pi.on('context', async (event, ctx) => {
    restore(ctx);
    const content = failure || await context(state, {
      harness: 'Pi',
      checkpointHelp: `Save task notes with workflow_checkpoint using revision ${state.revision} and a patch containing task fields only. It cannot select a mode or reactivate an off workflow. Use its returned revision for the next checkpoint.`,
      ...pendingControl,
    });
    // Replace only our own context on every request, including continuation
    // after a checkpoint or compaction. Historical text cannot reactivate off.
    const messages = event.messages.filter(message => message.customType !== CONTEXT_MESSAGE && message.customType !== CONTROL_MESSAGE);
    if (content) messages.push({ role: 'custom', customType: CONTEXT_MESSAGE, content, display: false, timestamp: Date.now() });
    return { messages };
  });
  pi.on('tool_call', (_event, ctx) => {
    restore(ctx);
    const reason = failure || (controlOnly ? 'Workflow selection alone does not authorize tools; answer in chat and wait.' :
      turnGeneration !== null && turnGeneration !== state.controlRevision ? 'Workflow selection changed during this turn. Wait for new user direction.' : null);
    if (reason) return { block: true, reason };
  });
  pi.on('agent_end', event => {
    if (!event.willRetry) { pendingControl = null; controlOnly = false; turnGeneration = null; }
  });

  pi.registerTool({
    name: 'workflow_checkpoint', label: 'Workflow checkpoint',
    description: 'Save task notes in the active Pair/Delegate workflow. Does not select modes or turn a workflow on. Use the current revision from workflow context.',
    parameters: {
      type: 'object', required: ['revision', 'patch'], additionalProperties: false,
      properties: {
        revision: { type: 'integer', minimum: 0 },
        patch: { type: 'object', additionalProperties: false, properties: noteProperties },
      },
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error('Checkpoint canceled');
      restore(ctx);
      if (failure) throw new Error(failure);
      const next = checkpoint(state, params.patch, params.revision);
      persist(next);
      return { content: [{ type: 'text', text: JSON.stringify(next) }], details: { revision: next.revision } };
    },
  });
}
