import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { SessionStore, stateDirectory } from '../core/store.mjs';
import { checkpoint } from '../core/state.mjs';
import { handleHook, parseControl } from '../adapters/codex/hook.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-codex-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SessionStore(directory);
  const hook = (event, extra = {}) => handleHook({ session_id: 'session-a', hook_event_name: event, ...extra }, store);
  const control = (args, extra = {}) => hook('UserPromptSubmit', { prompt: `workflow-session ${args}`, ...extra });
  return { directory, store, hook, control, state: async () => (await store.read('session-a')).state };
}

test('Codex inactive sessions do not inject workflow; prose and skills do not select modes', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.hook('SessionStart', { source: 'startup' }), {});
  for (const prompt of ['Explain this code', 'Please delegate this', '$workflow-session pair', '/other:session pair', 'workflow-session-other pair']) {
    assert.deepEqual(await f.hook('UserPromptSubmit', { prompt }), {});
    assert.equal((await f.state()).mode, null);
  }
  assert.equal(parseControl('please use workflow-session pair'), null);
});

test('Codex exact user prompts select and render only the chosen contract', async t => {
  const f = await fixture(t);
  const result = await f.control('pair Inspect parser');
  assert.equal((await f.state()).mode, 'pair');
  assert.match(result.hookSpecificOutput.additionalContext, /# Pair/);
  assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /# Delegate/);
  assert.match(result.hookSpecificOutput.additionalContext, /adapters\/codex\/cli/);
  await f.control('delegate Fix parser', { agent_id: 'child' });
  assert.equal((await f.state()).mode, 'pair');
});

test('Codex status, activation, resume, and compaction grant no development authority', async t => {
  const f = await fixture(t);
  for (const args of ['', 'on']) {
    assert.match((await f.control(args)).hookSpecificOutput.additionalContext, /Do not start development/);
  }
  await f.control('delegate Implement');
  await f.store.update('session-a', record => {
    record.state = checkpoint(record.state, { pendingQuestion: 'Which format?' }, record.state.revision);
  });
  const before = await f.state();
  assert.match((await f.control('status')).hookSpecificOutput.additionalContext, /end this turn/);
  assert.deepEqual(await f.state(), before);
  await f.control('off');
  for (const source of ['resume', 'compact']) {
    const result = await f.hook('SessionStart', { source });
    assert.match(result.hookSpecificOutput.additionalContext, /Agent Workflow is off/);
    assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /# Delegate/);
  }
  assert.match((await f.control('on')).hookSpecificOutput.additionalContext, /On restores context only/);
  assert.equal((await f.state()).pendingQuestion, 'Which format?');
});

test('Codex stale tools use the supported deny output and current turns keep normal permissions', async t => {
  const f = await fixture(t);
  await f.control('delegate Implement', { turn_id: 'old' });
  await f.control('off', { turn_id: 'new' });
  const result = await f.hook('PreToolUse', { turn_id: 'old', tool_name: 'Bash' });
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(result.continue, undefined);
  assert.deepEqual(await f.hook('PreToolUse', { turn_id: 'new' }), {});
  assert.deepEqual(await f.hook('Stop'), {});
});

test('Codex filesystem state is separate from Claude and new session IDs start off', async t => {
  const f = await fixture(t);
  assert.notEqual(stateDirectory({}), stateDirectory({}, 'codex'));
  assert.equal(stateDirectory({ CODEX_HOME: '/tmp/codex' }, 'codex'), '/tmp/codex/agent-workflows/sessions');
  await f.control('delegate Implement');
  assert.deepEqual(await f.hook('SessionStart', { session_id: 'fork-b', source: 'startup' }), {});
  assert.equal((await f.store.read('fork-b')).state.active, false);
});

test('Codex invalid controls and corrupt state block the prompt without resetting notes', async t => {
  const f = await fixture(t);
  await f.control('pair Inspect');
  await assert.rejects(f.control('wrong'), /Unknown action/);
  assert.equal((await f.state()).mode, 'pair');
  await writeFile(f.store.path('session-a'), '{broken');
  for (const event of ['UserPromptSubmit', 'PreToolUse']) {
    const result = spawnSync(process.execPath, ['adapters/codex/hook.mjs'], {
      input: JSON.stringify({ session_id: 'session-a', hook_event_name: event, prompt: 'workflow-session delegate Task' }),
      encoding: 'utf8', env: { ...process.env, WORKFLOW_STATE_DIR: f.directory },
    });
    const output = JSON.parse(result.stdout);
    if (event === 'PreToolUse') assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    else assert.equal(output.decision, 'block');
  }
});
