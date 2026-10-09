import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { branchState, STATE_ENTRY } from '../adapters/pi/extension.js';

// Load the installed SDK without making it a plugin runtime dependency.
const root = process.env.WORKFLOW_PI_PACKAGE_DIR || dirname(dirname(realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim())));
const sdk = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const ai = await import(pathToFileURL(join(root, 'node_modules/@earendil-works/pi-ai/dist/compat.js')).href);
const directory = await mkdtemp(join(tmpdir(), 'workflow-pi-smoke-'));
const source = resolve(process.argv[2] || '.');
const agentDir = join(directory, 'agent');
await mkdir(agentDir);
const requests = [], errors = [];
const core = ai.createFauxCore({ api: 'workflow-smoke-api', provider: 'workflow-smoke', tokensPerSecond: Infinity, models: [{ id: 'test-model' }] });
const authStorage = sdk.AuthStorage.inMemory();
const modelRegistry = sdk.ModelRegistry.inMemory(authStorage);
modelRegistry.registerProvider('workflow-smoke', {
  api: core.api, apiKey: 'offline-test', baseUrl: 'http://unused.invalid',
  models: core.models, streamSimple: core.streamSimple,
});
const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
let session;

async function create(manager, reason = 'startup') {
  const loader = new sdk.DefaultResourceLoader({
    cwd: directory, agentDir, settingsManager,
    additionalExtensionPaths: [source],
    noContextFiles: true,
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.equal(loader.getExtensions().extensions.length, 1);
  assert.equal(loader.getSkills().skills.length, 0, 'Pi loaded another harness\'s skills');
  assert.equal(loader.getPrompts().prompts.length, 0);
  assert.equal(loader.getThemes().themes.length, 0);
  const created = await sdk.createAgentSession({
    cwd: directory, agentDir, authStorage, modelRegistry, settingsManager,
    resourceLoader: loader, sessionManager: manager, model: core.getModel(),
    tools: ['workflow_checkpoint'], sessionStartEvent: { type: 'session_start', reason },
  });
  await created.session.bindExtensions({ onError: error => errors.push(error) });
  return created.session;
}
function response(content = 'Offline smoke response') {
  return context => {
    requests.push(context);
    return ai.fauxAssistantMessage(content);
  };
}
async function idle() {
  // sendMessage(triggerTurn) is asynchronous; its promise is owned by Pi.
  const deadline = Date.now() + 3000;
  await new Promise(resolve => setTimeout(resolve, 20));
  while (session.isStreaming) {
    assert.ok(Date.now() < deadline, 'Pi smoke turn did not finish');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(errors, []);
}
const lastContext = () => requests.at(-1).messages.map(message => JSON.stringify(message)).join('\n');
const state = () => branchState(session.sessionManager.getBranch());

try {
  console.log(`Harness: Pi ${JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version}`);
  session = await create(sdk.SessionManager.create(directory, join(directory, 'sessions')));
  assert.equal(state().active, false);
  core.setResponses([response()]);
  await session.prompt('Explain a unit test');
  assert.doesNotMatch(lastContext(), /Current Agent Workflow session state/);

  core.setResponses([response()]);
  await session.prompt('/workflow pair Inspect parser');
  await idle();
  assert.equal(state().mode, 'pair');
  assert.match(lastContext(), /# Pair/);
  const pairAnchor = session.sessionManager.getLeafId();
  console.log('PASS native extension loading, inactive session, and Pair command/context');

  // The offline model asks for a real checkpoint tool call; Pi validates the
  // JSON schema and executes the extension tool before requesting continuation.
  core.setResponses([
    response([ai.fauxToolCall('workflow_checkpoint', { revision: state().revision, patch: { phase: 'hand-back', step: 'Inspect parser' } })]),
    response(),
  ]);
  await session.prompt('Save the agreed handoff');
  assert.equal(state().phase, 'hand-back');
  assert.equal(state().revision, 2);
  console.log('PASS native checkpoint schema, execution, and refreshed continuation context');

  const requestCount = requests.length;
  await session.prompt('/workflow status');
  await session.prompt('/workflow off');
  assert.equal(state().active, false);
  await session.prompt('/workflow on');
  assert.equal(state().active, true);
  assert.equal(requests.length, requestCount, 'Controls unexpectedly requested a model response');
  await session.prompt('/workflow off');
  const savedFile = session.sessionManager.getSessionFile();
  session.dispose();
  session = await create(sdk.SessionManager.open(savedFile), 'resume');
  assert.equal(state().active, false);
  console.log('PASS status/off/on without model turns and resume from disk');

  await session.navigateTree(pairAnchor, { summarize: false });
  assert.equal(state().mode, 'pair');
  assert.equal(state().active, true);
  const forkFile = session.sessionManager.createBranchedSession(pairAnchor);
  session.dispose();
  session = await create(sdk.SessionManager.open(forkFile), 'fork');
  assert.equal(state().mode, 'pair');
  assert.equal(state().active, true);
  assert.equal(session.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === STATE_ENTRY).length, 1);
  console.log('PASS native tree navigation and fork ancestry inheritance');
  assert.deepEqual(errors, []);
  console.log('Pi SDK checks passed using an offline faux provider. Live model behavior was not evaluated.');
} finally {
  session?.dispose();
  modelRegistry.unregisterProvider('workflow-smoke');
  await rm(directory, { recursive: true, force: true });
}
