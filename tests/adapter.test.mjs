import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { SessionStore, validateSessionId } from '../core/store.mjs';
import { checkpoint } from '../core/state.mjs';
import { handleHook } from '../adapters/claude-code/hook.mjs';
import { transcriptBranch } from '../adapters/claude-code/transcript.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SessionStore(join(directory, 'state'));
  const transcript = join(directory, 'session.jsonl');
  const input = { session_id: 'session-a', cwd: directory, transcript_path: transcript };
  const hook = (event, extra = {}) => handleHook({ ...input, hook_event_name: event, ...extra }, store);
  const control = args => hook('UserPromptExpansion', {
    command_name: 'workflow:session', command_source: 'plugin', expansion_type: 'slash_command',
    command_args: args, prompt: `/workflow:session ${args}`,
  });
  const transcriptRows = rows => writeFile(transcript, rows.map(row => JSON.stringify({ type: 'user', sessionId: 'session-a', ...row })).join('\n') + '\n');
  return { directory, store, input, hook, control, transcriptRows };
}

test('installed but inactive injects no workflow or onboarding', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.hook('SessionStart', { source: 'startup' }), {});
  assert.deepEqual(await f.hook('UserPromptSubmit', { prompt: 'Explain this code' }), {});
  assert.deepEqual(await f.hook('PreToolUse', { tool_name: 'Read' }), {});
  assert.deepEqual(await f.hook('Stop'), {});
});

test('selection is deterministic, scoped to the exact user command', async t => {
  const f = await fixture(t);
  await f.hook('SessionStart', { source: 'startup' });
  const result = await f.control('pair Investigate the failure');
  assert.equal((await f.store.read('session-a')).state.mode, 'pair');
  const text = result.hookSpecificOutput.additionalContext;
  assert.match(text, /Pair — developing together/);
  assert.doesNotMatch(text, /Delegate — delivering for review/);
  await f.hook('UserPromptSubmit', { prompt: 'I wonder whether delegating would help' });
  await f.hook('UserPromptExpansion', { prompt: '/other:session delegate', command_source: 'plugin', expansion_type: 'slash_command' });
  await f.hook('UserPromptExpansion', { prompt: '/workflow:session delegate', command_source: 'project', expansion_type: 'slash_command' });
  assert.equal((await f.store.read('session-a')).state.mode, 'pair');
});

test('bare command, on without selection, and status do not start development', async t => {
  const f = await fixture(t);
  for (const args of ['', 'on']) {
    const text = (await f.control(args)).hookSpecificOutput.additionalContext;
    assert.match(text, /Ask in ordinary chat/);
    assert.match(text, /Do not start development/);
    assert.equal((await f.store.read('session-a')).state.mode, null);
  }
  await f.control('delegate Build a parser');
  const before = (await f.store.read('session-a')).state;
  const text = (await f.control('status')).hookSpecificOutput.additionalContext;
  assert.match(text, /Report the control result briefly, then end this turn/);
  assert.deepEqual((await f.store.read('session-a')).state, before);
  for (const mode of ['pair', 'delegate']) {
    const result = await f.control(mode);
    assert.match(result.hookSpecificOutput.additionalContext, /Mode selection alone does not resume work/);
  }
});

test('off survives resume and compaction and overrides historical instructions', async t => {
  const f = await fixture(t);
  await f.control('delegate Build a parser');
  await f.store.update('session-a', record => {
    record.state = checkpoint(record.state, { pendingQuestion: 'Which input format?', decisions: ['Keep dependencies unchanged'] }, record.state.revision);
  });
  await f.control('off');
  for (const source of ['resume', 'compact']) {
    const result = await f.hook('SessionStart', { source });
    assert.match(result.hookSpecificOutput.additionalContext, /Agent Workflow is off/);
    assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /# Delegate/);
    assert.equal((await f.store.read('session-a')).state.pendingQuestion, 'Which input format?');
  }
  const restored = await f.control('on');
  assert.match(restored.hookSpecificOutput.additionalContext, /On restores context only/);
  assert.equal((await f.store.read('session-a')).state.pendingQuestion, 'Which input format?');
});

test('sessions and worktrees stay independent', async t => {
  const f = await fixture(t);
  await f.control('delegate Build a parser');
  for (const [id, cwd] of [['session-b', f.directory], ['session-c', join(f.directory, 'worktree')]]) {
    const result = await handleHook({ ...f.input, session_id: id, cwd, hook_event_name: 'SessionStart', source: 'startup' }, f.store);
    assert.deepEqual(result, {});
    assert.equal((await f.store.read(id)).state.mode, null);
  }
  assert.equal((await f.store.read('session-a')).state.mode, 'delegate');
});

test('available fork lineage inherits its checkpoint and evolves independently', async t => {
  const f = await fixture(t);
  await f.control('pair Investigate a failure');
  await f.transcriptRows([{ uuid: 'a', parentUuid: null }]);
  await f.hook('Stop');
  await f.control('delegate Fix the failure');
  await f.transcriptRows([{ uuid: 'a', parentUuid: null }, { uuid: 'b', parentUuid: 'a' }]);
  await f.hook('Stop');
  await f.control('off');
  await f.transcriptRows([{ uuid: 'a', parentUuid: null }, { uuid: 'b', parentUuid: 'a' }, { uuid: 'c', parentUuid: 'b' }]);
  await f.hook('Stop');
  await f.transcriptRows([{ uuid: 'a', parentUuid: null }, { uuid: 'b', parentUuid: 'a' }]);
  const fork = { ...f.input, session_id: 'fork-b', hook_event_name: 'SessionStart', source: 'fork' };
  await handleHook(fork, f.store);
  const state = (await f.store.read('fork-b')).state;
  assert.equal(state.mode, 'delegate');
  assert.equal(state.active, true);
  await handleHook({ ...fork, hook_event_name: 'UserPromptExpansion', command_source: 'plugin', expansion_type: 'slash_command', prompt: '/workflow:session pair' }, f.store);
  assert.equal((await f.store.read('session-a')).state.active, false);
  assert.equal((await f.store.read('fork-b')).state.mode, 'pair');
});

test('fork without matching notes starts off explicitly', async t => {
  const f = await fixture(t);
  await f.transcriptRows([{ uuid: 'unknown', parentUuid: null }]);
  const result = await handleHook({ ...f.input, session_id: 'new-fork', hook_event_name: 'SessionStart', source: 'fork' }, f.store);
  assert.equal((await f.store.read('new-fork')).state.active, false);
  assert.match(result.hookSpecificOutput.additionalContext, /No saved workflow checkpoint matched/);
});

test('a new control cannot overwrite an older transcript checkpoint while its prompt is unwritten', async t => {
  const f = await fixture(t);
  await f.control('pair Investigate');
  await f.transcriptRows([{ uuid: 'pair-handoff', parentUuid: null }]);
  await f.hook('Stop');
  await f.control('off');
  await f.hook('UserPromptSubmit', { prompt: '/workflow:session off' });
  const record = await f.store.read('session-a');
  assert.equal(record.state.active, false);
  assert.equal(record.history[0].state.active, true);
  assert.equal(record.history[0].anchor, 'pair-handoff');
});

test('resume of a rewound branch restores its notes instead of later selection', async t => {
  const f = await fixture(t);
  await f.control('pair Investigate');
  await f.transcriptRows([{ uuid: 'a', parentUuid: null }]);
  await f.hook('Stop');
  await f.control('delegate Implement');
  await f.transcriptRows([{ uuid: 'a', parentUuid: null }, { uuid: 'b', parentUuid: 'a' }]);
  await f.hook('Stop');
  await f.transcriptRows([{ uuid: 'a', parentUuid: null }, { uuid: 'c', parentUuid: 'a' }]);
  await f.hook('SessionStart', { source: 'resume' });
  assert.equal((await f.store.read('session-a')).state.mode, 'pair');
});

test('an in-flight mode change stops the next tool; the next user turn uses the new mode', async t => {
  const f = await fixture(t);
  await f.control('delegate Implement');
  await f.hook('UserPromptSubmit', { prompt_id: 'prompt-a', prompt: 'Proceed' });
  await f.hook('UserPromptExpansion', { prompt_id: 'prompt-b', command_source: 'plugin', expansion_type: 'slash_command', prompt: '/workflow:session off' });
  assert.equal((await f.hook('PreToolUse', { prompt_id: 'prompt-a' })).continue, false);
  assert.equal((await f.hook('PreToolUse', { prompt_id: 'prompt-a', agent_id: 'child' })).continue, false);
  await f.hook('UserPromptSubmit', { prompt_id: 'prompt-b', prompt: 'Explain what changed' });
  assert.deepEqual(await f.hook('PreToolUse', { prompt_id: 'prompt-b' }), {});
});

test('main sessions using --agent still receive their workflow', async t => {
  const f = await fixture(t);
  await f.control('pair Task');
  const result = await f.hook('UserPromptSubmit', { agent_type: 'custom-main', prompt: 'Explain the code' });
  assert.match(result.hookSpecificOutput.additionalContext, /# Pair/);
});

test('Stop never starts a continuation loop and subagent hooks do not overwrite state', async t => {
  const f = await fixture(t);
  await f.control('delegate Implement');
  assert.deepEqual(await f.hook('Stop', { stop_hook_active: true }), {});
  assert.deepEqual(await f.hook('UserPromptSubmit', { agent_id: 'child', prompt: 'Implement something' }), {});
  assert.equal((await f.store.read('session-a')).state.mode, 'delegate');
});

test('transcript ancestry ignores sidechains, abandoned rows, and partial lines', async t => {
  const f = await fixture(t);
  await f.transcriptRows([
    { uuid: 'root', parentUuid: null }, { uuid: 'old', parentUuid: 'root' },
    { type: 'attachment', uuid: 'hook-context', parentUuid: 'root' },
    { uuid: 'current', parentUuid: 'hook-context' }, { uuid: 'child', parentUuid: 'current', isSidechain: true },
  ]);
  const branch = await transcriptBranch(f.input.transcript_path);
  assert.deepEqual(branch.anchors, ['root', 'hook-context', 'current']);
});

test('helper supports notes, prevents selection, and rejects stale or off checkpoints', async t => {
  const f = await fixture(t);
  await f.control('pair Task');
  const cli = (args, input = '') => spawnSync(process.execPath, ['adapters/claude-code/cli.mjs', ...args], {
    input, encoding: 'utf8', env: { ...process.env, WORKFLOW_STATE_DIR: f.store.directory },
  });
  const update = cli(['checkpoint', '--session', 'session-a', '--revision', '1'], JSON.stringify({ phase: 'work', step: 'Fix one function' }));
  assert.equal(update.status, 0, update.stderr);
  assert.equal(JSON.parse(update.stdout).step, 'Fix one function');
  assert.notEqual(cli(['checkpoint', '--session', 'session-a', '--revision', '1'], '{}').status, 0);
  assert.notEqual(cli(['delegate', '--session', 'session-a']).status, 0);
  await f.control('off');
  const revision = (await f.store.read('session-a')).state.revision;
  assert.notEqual(cli(['checkpoint', '--session', 'session-a', '--revision', String(revision)], '{}').status, 0);
});

test('atomic updates serialize concurrent mutations and invalid IDs cannot escape storage', async t => {
  const f = await fixture(t);
  await f.control('pair Task');
  await Promise.all(Array.from({ length: 8 }, (_, i) => f.store.update('session-a', record => {
    record.state = checkpoint(record.state, { decisions: [...record.state.decisions, `Decision ${i}`] }, record.state.revision);
  })));
  const record = await f.store.read('session-a');
  assert.equal(record.state.decisions.length, 8);
  assert.equal(record.state.revision, 9);
  for (const id of ['../escape', '/absolute', '', 'a/b']) assert.throws(() => validateSessionId(id));
  JSON.parse(await readFile(f.store.path('session-a'), 'utf8'));
});

test('corrupted state blocks the control rather than resetting selection', async t => {
  const f = await fixture(t);
  await f.control('pair Task');
  await writeFile(f.store.path('session-a'), '{broken');
  const result = spawnSync(process.execPath, ['adapters/claude-code/hook.mjs'], {
    input: JSON.stringify({ ...f.input, hook_event_name: 'UserPromptExpansion', command_source: 'plugin', expansion_type: 'slash_command', prompt: '/workflow:session delegate Task' }),
    encoding: 'utf8', env: { ...process.env, WORKFLOW_STATE_DIR: f.store.directory },
  });
  assert.equal(JSON.parse(result.stdout).decision, 'block');
  assert.equal(await readFile(f.store.path('session-a'), 'utf8'), '{broken');
});
