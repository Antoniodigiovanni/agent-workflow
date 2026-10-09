import test from 'node:test';
import assert from 'node:assert/strict';
import workflow, { branchState, STATE_ENTRY, CONTEXT_MESSAGE, CONTROL_MESSAGE } from '../adapters/pi/extension.js';

function fixture(entries = []) {
  const handlers = new Map(), commands = new Map(), tools = new Map(), messages = [], notifications = [];
  let idle = true, aborted = 0;
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    registerTool: tool => tools.set(tool.name, tool),
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data: structuredClone(data) }),
    sendMessage: (message, options) => messages.push({ message, options }),
  };
  const ctx = {
    hasUI: true, sessionManager: { getBranch: () => entries },
    ui: { notify: (...args) => notifications.push(args) },
    isIdle: () => idle, abort: () => { aborted++; idle = true; }, waitForIdle: async () => {},
  };
  workflow(pi);
  return {
    entries, messages, notifications, tools, ctx,
    state: () => branchState(entries), aborted: () => aborted,
    streaming: () => { idle = false; },
    control: args => commands.get('workflow').handler(args, ctx),
    event: (name, event = {}) => handlers.get(name)?.(event, ctx),
    checkpoint: params => tools.get('workflow_checkpoint').execute('id', params, undefined, undefined, ctx),
    context: async (messages = []) => (await handlers.get('context')({ messages }, ctx)).messages,
  };
}

test('Pi fresh sessions stay off and preserve other extensions context', async () => {
  const f = fixture();
  await f.event('session_start');
  const other = { role: 'custom', customType: 'another-extension', content: 'Other instructions' };
  assert.deepEqual(await f.context([other]), [other]);
  assert.equal(f.state().active, false);
  assert.equal(f.messages.length, 0);
});

test('Pi controls select deterministically; status/off/on do not start a model turn', async () => {
  const f = fixture();
  await f.control('delegate Fix the parser');
  assert.equal(f.state().mode, 'delegate');
  assert.equal(f.messages.at(-1).options.triggerTurn, true);
  assert.match((await f.context()).at(-1).content, /# Delegate/);
  await f.event('agent_end');
  const before = f.state();
  await f.control('status');
  assert.deepEqual(f.state(), before);
  assert.equal(f.messages.at(-1).options, undefined);
  await f.control('off');
  assert.equal(f.state().active, false);
  assert.equal(f.messages.at(-1).options, undefined);
  await f.control('on');
  assert.equal(f.state().mode, 'delegate');
  assert.equal(f.state().active, true);
  assert.equal(f.messages.at(-1).options, undefined);
});

test('Pi controls without scope ask in chat and block tools; ordinary prompts clear this guard', async () => {
  for (const control of ['', 'on', 'pair', 'delegate']) {
    const f = fixture();
    await f.control(control);
    assert.equal(f.messages.at(-1).options.triggerTurn, true);
    assert.match((await f.context()).at(-1).content, /Ask|ask/);
    assert.equal((await f.event('tool_call', { toolName: 'bash' })).block, true);
    await f.event('before_agent_start', { prompt: 'Explain this function' });
    assert.equal(await f.event('tool_call', { toolName: 'read' }), undefined);
  }
});

test('Pi checkpoints are revision guarded, notes only, and unavailable while off', async () => {
  const f = fixture();
  await f.control('pair Inspect parser');
  await f.checkpoint({ revision: 1, patch: { phase: 'work', step: 'Inspect function', pendingQuestion: 'Which input?' } });
  assert.equal(f.state().revision, 2);
  await assert.rejects(f.checkpoint({ revision: 1, patch: {} }), /Stale/);
  await assert.rejects(f.checkpoint({ revision: 2, patch: { active: false } }), /task notes only/);
  await f.control('off');
  assert.equal(f.state().pendingQuestion, 'Which input?');
  await assert.rejects(f.checkpoint({ revision: 3, patch: {} }), /off/);
});

test('Pi status during streaming neither aborts nor steers the agent', async () => {
  const f = fixture();
  await f.control('delegate Implement');
  const count = f.messages.length;
  f.streaming();
  await f.control('status');
  assert.equal(f.messages.length, count);
  assert.equal(f.aborted(), 0);
  assert.match(f.notifications.at(-1)[0], /selected: delegate/);
});

test('Pi control-only guards survive overflow compaction retry', async () => {
  const f = fixture();
  await f.control('pair');
  await f.event('agent_end', { willRetry: true });
  await f.event('session_compact');
  assert.equal((await f.event('tool_call')).block, true);
  await f.event('agent_end', { willRetry: false });
  assert.equal(await f.event('tool_call'), undefined);
});

test('Pi branch restoration follows fork/tree ancestry, never the latest abandoned state', async () => {
  const f = fixture();
  await f.control('pair Investigate');
  const forkEntries = structuredClone(f.entries);
  await f.control('delegate Implement');
  await f.control('off');
  const fork = fixture(forkEntries);
  await fork.event('session_start', { reason: 'fork' });
  assert.equal(fork.state().mode, 'pair');
  assert.equal(fork.state().active, true);
  await fork.control('off');
  assert.equal(f.state().mode, 'delegate');
  f.entries.splice(1);
  await f.event('session_tree');
  assert.equal(f.state().mode, 'pair');
  f.entries.splice(0);
  await f.event('session_tree');
  assert.equal(f.state().mode, null);
});

test('Pi refreshes context after checkpoint/compaction and removes only its historical messages', async () => {
  const f = fixture();
  await f.control('delegate Implement');
  await f.event('agent_end');
  await f.control('off');
  await f.event('session_compact');
  const messages = await f.context([
    { customType: CONTEXT_MESSAGE, content: '# Delegate old instructions' },
    { customType: CONTROL_MESSAGE, content: 'Old task' },
    { role: 'user', content: 'Explain the diff' },
  ]);
  assert.equal(messages.length, 2);
  assert.match(messages.at(-1).content, /Agent Workflow is off/);
  assert.doesNotMatch(messages.at(-1).content, /# Delegate/);
  await f.event('session_start', { reason: 'resume' });
  assert.equal(f.state().active, false);
});

test('Pi mode changes abort old work and changed generations block old tool boundaries', async () => {
  const f = fixture();
  await f.control('delegate Implement');
  f.streaming();
  await f.control('off');
  assert.equal(f.aborted(), 1);
  assert.equal((await f.event('tool_call')).block, true);
  await f.event('before_agent_start', { prompt: 'Explain the code' });
  assert.equal(await f.event('tool_call'), undefined);
});

test('Pi invalid commands and corrupt notes never silently replace selection', async () => {
  const f = fixture();
  await f.control('pair Inspect');
  const before = f.state();
  await f.control('on Resume work');
  assert.deepEqual(f.state(), before);
  f.entries.push({ type: 'custom', customType: STATE_ENTRY, data: { broken: true } });
  await f.control('delegate Fix');
  assert.equal(f.entries.at(-1).data.broken, true);
  assert.equal((await f.event('tool_call')).block, true);
  await assert.rejects(f.checkpoint({ revision: 1, patch: {} }), /Invalid workflow state/);
  assert.match((await f.context()).at(-1).content, /Invalid workflow state/);
  assert.throws(() => branchState(f.entries), /Invalid workflow state/);
});
