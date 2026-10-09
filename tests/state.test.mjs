import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, parseAction, transition, checkpoint, validateState } from '../core/state.mjs';

test('installation has no selection and is inactive', () => {
  const state = initialState();
  assert.equal(state.active, false);
  assert.equal(state.mode, null);
  assert.deepEqual(transition(state, parseAction('on')), state);
  assert.deepEqual(transition(state, parseAction('')), state);
});

test('explicit selection activates just the requested workflow', () => {
  for (const mode of ['pair', 'delegate']) {
    const state = transition(initialState(), parseAction(`${mode} A bounded task\nwith specifics`));
    assert.equal(state.active, true);
    assert.equal(state.mode, mode);
    assert.equal(state.scope, 'A bounded task\nwith specifics');
    assert.equal(state.controlRevision, 1);
  }
});

test('off preserves notes and on restores without resolving a pending question', () => {
  const selected = transition(initialState(), parseAction('pair Investigate the failure'));
  const working = checkpoint(selected, { phase: 'agree-step', decisions: ['Preserve the public API'], pendingQuestion: 'Which version fails?' }, selected.revision);
  const off = transition(working, parseAction('off'));
  assert.equal(off.active, false);
  for (const key of ['mode', 'phase', 'scope', 'decisions', 'pendingQuestion']) assert.deepEqual(off[key], working[key]);
  const on = transition(off, parseAction('on'));
  assert.equal(on.active, true);
  assert.equal(on.pendingQuestion, 'Which version fails?');
});

test('switches retain decisions while establishing the new scope', () => {
  let state = transition(initialState(), parseAction('delegate Fix the failure'));
  state = checkpoint(state, { decisions: ['Use the existing parser'], phase: 'implement', step: 'Fix parser' }, state.revision);
  state = transition(state, parseAction('pair'));
  assert.deepEqual(state.decisions, ['Use the existing parser']);
  assert.equal(state.scope, 'Fix the failure');
  assert.equal(state.step, '');
  assert.equal(state.phase, 'orient');
  state = transition(state, parseAction('delegate Implement the agreed fix'));
  assert.deepEqual(state.decisions, ['Use the existing parser']);
  assert.equal(state.scope, 'Implement the agreed fix');
  assert.equal(state.phase, 'align-scope');
});

test('status is read-only and controls reject typos and unsolicited tasks', () => {
  const state = transition(initialState(), parseAction('delegate Task'));
  assert.deepEqual(transition(state, parseAction('status')), state);
  for (const args of ['deliver Task', 'pairs', 'on do work', 'off discard files', 'status fix it']) assert.throws(() => parseAction(args));
});

test('checkpoints cannot change mode or revive off state and reject stale writes', () => {
  const selected = transition(initialState(), parseAction('pair Task'));
  assert.throws(() => checkpoint(selected, { mode: 'delegate' }, selected.revision));
  assert.throws(() => checkpoint(selected, { active: true }, selected.revision));
  assert.throws(() => checkpoint(selected, { phase: 'publish-prs' }, selected.revision));
  assert.throws(() => checkpoint(selected, { decisions: [42] }, selected.revision));
  const updated = checkpoint(selected, { phase: 'work' }, selected.revision);
  assert.throws(() => checkpoint(updated, { step: 'Old step' }, selected.revision), /Stale/);
  const off = transition(updated, parseAction('off'));
  assert.throws(() => checkpoint(off, { phase: 'verify' }, off.revision), /off/);
  assert.equal(updated.controlRevision, selected.controlRevision);
});

test('corrupted state fails validation', () => {
  assert.throws(() => validateState({ ...initialState(), active: true }));
  assert.throws(() => validateState({ ...initialState(), revision: -1 }));
});
