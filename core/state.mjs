export const MODES = ['pair', 'delegate'];
export const ACTIONS = [...MODES, 'on', 'off', 'status'];
export const PHASES = {
  pair: ['orient', 'agree-step', 'work', 'verify', 'hand-back'],
  delegate: ['align-scope', 'implement', 'verify-review', 'publish-prs', 'awaiting-review', 'correct', 'blocked'],
};

export function initialState() {
  return {
    version: 1, revision: 0, controlRevision: 0,
    active: false, mode: null, phase: null,
    scope: '', step: '', decisions: [], acceptanceCriteria: [],
    pendingQuestion: null, prs: [],
  };
}

export function validateState(state) {
  if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Number.isSafeInteger(state.controlRevision) || state.controlRevision < 0 ||
      typeof state.active !== 'boolean' || !(state.mode === null || MODES.includes(state.mode)) ||
      (state.active && state.mode === null) ||
      !(state.phase === null || (state.mode && PHASES[state.mode].includes(state.phase)))) {
    throw new Error('Invalid workflow state');
  }
  for (const key of ['scope', 'step']) {
    if (typeof state[key] !== 'string' || state[key].length > 20000) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['decisions', 'acceptanceCriteria', 'prs']) {
    if (!Array.isArray(state[key]) || state[key].length > 100 ||
        state[key].some(value => typeof value !== 'string' || value.length > 20000)) {
      throw new Error(`Invalid ${key}`);
    }
  }
  if (!(state.pendingQuestion === null || (typeof state.pendingQuestion === 'string' && state.pendingQuestion.length <= 20000))) {
    throw new Error('Invalid pending question');
  }
  return state;
}

export function parseAction(args = '') {
  const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { action: null, task: '' };
  const [, action, task = ''] = match;
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action: ${action}. Use pair, delegate, on, off, or status.`);
  if (!MODES.includes(action) && task.trim()) throw new Error(`${action} does not accept a task.`);
  return { action, task: task.trim() };
}

export function transition(state, { action, task = '' }) {
  validateState(state);
  if (!action || action === 'status' || (action === 'on' && !state.mode)) return structuredClone(state);
  const next = structuredClone(state);
  if (MODES.includes(action)) {
    const switched = next.mode !== action;
    next.mode = action;
    next.active = true;
    if (switched || task) next.phase = action === 'pair' ? 'orient' : 'align-scope';
    // A mode switch preserves decisions, but the next step must be established again.
    if (switched) next.step = '';
    if (task) {
      next.scope = task;
      next.step = '';
      next.pendingQuestion = null;
      next.acceptanceCriteria = [];
      next.prs = [];
    }
  } else {
    next.active = action === 'on';
  }
  next.revision++;
  next.controlRevision++;
  return validateState(next);
}

const CHECKPOINT_FIELDS = ['phase', 'scope', 'step', 'decisions', 'acceptanceCriteria', 'pendingQuestion', 'prs'];

export function checkpoint(state, patch, expectedRevision) {
  validateState(state);
  if (!state.active) throw new Error('Workflow is off; task checkpoints are suspended.');
  if (expectedRevision !== state.revision) throw new Error('Stale checkpoint; read current status before retrying.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(key => !CHECKPOINT_FIELDS.includes(key))) {
    throw new Error('Checkpoint may update task notes only, never activation or mode.');
  }
  const next = { ...structuredClone(state), ...structuredClone(patch), revision: state.revision + 1 };
  return validateState(next);
}
