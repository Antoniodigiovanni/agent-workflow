import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'workflow-cli-smoke-'));
const config = join(directory, 'config');
const state = join(directory, 'state');
const project = join(directory, 'project');
await mkdir(config);
await mkdir(project);
const env = {
  ...process.env, CLAUDE_CONFIG_DIR: config, WORKFLOW_STATE_DIR: state,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};
// This trial intentionally exercises the harness before the model request,
// without borrowing the user's API credentials or installed configuration.
for (const key of [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_SAFE_MODE',
]) delete env[key];

function cli(args) {
  const result = spawnSync('claude', args, { cwd: project, env, encoding: 'utf8', timeout: 15000, maxBuffer: 2 ** 22 });
  if (result.error) throw result.error;
  return result;
}

const base = [
  '--plugin-dir', resolve('.'), '--setting-sources', '', '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--permission-mode', 'manual',
  '--include-hook-events', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '0.01',
];

function prompt(args, text) {
  const result = cli([...base, ...args, '-p', text]);
  const rows = result.stdout.split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const init = rows.find(row => row.subtype === 'init');
  const final = rows.findLast(row => row.type === 'result');
  assert.ok(init, `CLI did not initialize: ${result.stderr || result.stdout}`);
  assert.ok(init.slash_commands.includes('workflow:session'), 'Command was not discovered');
  assert.ok(final, 'CLI did not finish');
  assert.equal(final.result, 'Not logged in · Please run /login', 'This smoke test must not make authenticated model calls');
  const hooks = rows.filter(row => row.subtype === 'hook_response');
  for (const hook of hooks) assert.equal(hook.outcome, 'success', `${hook.hook_event}: ${hook.stderr}`);
  const expansion = hooks.find(row => row.hook_event === 'UserPromptExpansion');
  let context = '';
  if (expansion?.stdout.trim()) context = JSON.parse(expansion.stdout).hookSpecificOutput?.additionalContext || '';
  return { id: init.session_id, context, hooks };
}

const readState = async id => JSON.parse(await readFile(join(state, `${id}.json`), 'utf8')).state;

try {
  const version = cli(['--version']);
  assert.equal(version.status, 0);
  console.log(`Harness: ${version.stdout.trim()}`);
  for (const args of [
    ['plugin', 'marketplace', 'add', resolve('.')],
    ['plugin', 'install', 'workflow@agent-workflow'],
    ['plugin', 'details', 'workflow'],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    if (args.includes('details')) {
      assert.match(result.stdout, /Skills \(1\)\s+session/);
      assert.match(result.stdout, /Hooks \(8\)/);
    }
  }
  console.log('PASS isolated marketplace installation and component inventory');

  const inactive = prompt(['--session-id', randomUUID()], 'Explain what a unit test is.');
  assert.equal((await readState(inactive.id)).mode, null);
  assert.ok(inactive.hooks.every(hook => !hook.stdout.trim()), 'Inactive hooks injected context');
  console.log('PASS fresh session is off without onboarding');

  const selected = prompt(['--session-id', randomUUID()], '/workflow:session pair Investigate the parser');
  assert.equal((await readState(selected.id)).mode, 'pair');
  assert.match(selected.context, /# Pair/);
  console.log('PASS Pair selection before model invocation');

  const off = prompt(['--resume', selected.id], '/workflow:session off');
  assert.equal((await readState(off.id)).active, false);
  assert.match(off.context, /Agent Workflow is off/);
  console.log('PASS resume and off persistence');

  const on = prompt(['--resume', selected.id], '/workflow:session on');
  assert.equal((await readState(on.id)).active, true);
  assert.equal((await readState(on.id)).mode, 'pair');
  assert.match(on.context, /On restores context only/);
  console.log('PASS on restores selection without authorizing work');

  const delegated = prompt(['--resume', selected.id], '/workflow:session delegate Fix the parser and open a PR');
  assert.equal((await readState(delegated.id)).mode, 'delegate');
  assert.match(delegated.context, /# Delegate/);
  const beforeStatus = await readState(delegated.id);
  const status = prompt(['--resume', delegated.id], '/workflow:session status');
  assert.deepEqual(await readState(status.id), beforeStatus);
  assert.match(status.context, /Report the control result briefly, then end this turn/);
  console.log('PASS Delegate switch and read-only status');

  const fork = prompt(['--resume', selected.id, '--fork-session'], '/workflow:session status');
  assert.notEqual(fork.id, selected.id);
  assert.equal((await readState(fork.id)).active, false);
  console.log('PASS independent native fork fallback (explicit reselection required)');
  console.log('Harness checks passed. Model behavior was not evaluated.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
