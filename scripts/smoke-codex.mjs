import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(join(tmpdir(), 'workflow-codex-smoke-'));
const env = { ...process.env, CODEX_HOME: directory, WORKFLOW_SMOKE_KEY: 'offline-test', RUST_LOG: 'off' };
delete env.WORKFLOW_STATE_DIR;
for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY']) delete env[key];
const source = resolve(process.argv[2] || '.');
let child;
const cli = args => {
  const result = spawnSync('codex', args, { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};
try {
  console.log(`Harness: ${cli(['--version']).trim()}`);
  cli(['plugin', 'marketplace', 'add', source, '--json']);
  const install = JSON.parse(cli(['plugin', 'add', 'workflow@agent-workflow', '--json']));
  const manifest = JSON.parse(await readFile(join(install.installedPath, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.hooks, './adapters/codex/hooks.json');
  assert.equal(manifest.skills, './adapters/codex/skills/');
  console.log('PASS isolated marketplace installation and Codex-specific manifest');

  // The hooks in this temporary installation are our reviewed source. Trust
  // bypass applies only to this child process; no user trust is changed.
  // A dummy provider at a closed local port prevents authenticated/remote calls.
  child = spawn('codex', [
    '--no-daemon', '--enable', 'hooks', '--dangerously-bypass-hook-trust',
    '-c', 'model_provider="workflow_smoke"', '-c', 'model="offline"',
    '-c', 'model_providers.workflow_smoke={name="Offline smoke",base_url="http://127.0.0.1:1/v1",env_key="WORKFLOW_SMOKE_KEY",wire_api="responses",requires_openai_auth=false,request_max_retries=0,stream_max_retries=0}',
    'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', 'workflow-session pair Inspect parser',
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  child.stdout.on('data', data => { diagnostic += data; });
  child.stderr.on('data', data => { diagnostic += data; });
  const exited = new Promise(resolve => child.once('close', resolve));
  const stateDir = join(directory, 'agent-workflows/sessions');
  let state;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    let files = [];
    try { files = await readdir(stateDir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const file = files.find(file => file.endsWith('.json'));
    if (file) {
      state = JSON.parse(await readFile(join(stateDir, file), 'utf8')).state;
      if (state.mode === 'pair') break;
    }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  child.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
  if (!stopped) { child.kill('SIGKILL'); await exited; }
  assert.equal(state?.mode, 'pair', `Native prompt hook did not select Pair: ${diagnostic.slice(-2000)}`);
  assert.equal(state.active, true);
  assert.equal(state.scope, 'Inspect parser');
  console.log('PASS native SessionStart/UserPromptSubmit hook execution before model request');
  console.log('Codex CLI checks passed with an offline endpoint. Model behavior was not evaluated.');
} finally {
  child?.kill('SIGKILL');
  await rm(directory, { recursive: true, force: true });
}
