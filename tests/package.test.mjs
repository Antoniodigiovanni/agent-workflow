import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { buildPackages } from '../scripts/package.mjs';

test('three standalone packages carry their runtime and identical shared contracts without other adapters', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-package-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await buildPackages(directory);
  for (const harness of ['claude-code', 'codex', 'pi']) {
    const root = join(directory, harness);
    assert.deepEqual(await readdir(join(root, 'adapters')), [harness]);
    const shared = await import(pathToFileURL(join(root, 'core/context.mjs')).href);
    const state = await import(pathToFileURL(join(root, 'core/state.mjs')).href);
    const text = await shared.context(state.transition(state.initialState(), { action: 'pair', task: 'Inspect' }), { harness });
    assert.match(text, /# Pair/);
    assert.equal(await readFile(join(root, 'workflows/pair.md'), 'utf8'), await readFile('workflows/pair.md', 'utf8'));
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.type, 'module');
    if (harness === 'pi') {
      const extension = await import(pathToFileURL(join(root, pkg.pi.extensions[0])).href);
      assert.equal(typeof extension.default, 'function');
      assert.deepEqual(pkg.pi.skills, []);
    } else {
      const hook = await import(pathToFileURL(join(root, `adapters/${harness}/hook.mjs`)).href);
      assert.equal(typeof hook.handleHook, 'function');
      const manifestPath = harness === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json';
      assert.equal(JSON.parse(await readFile(join(root, manifestPath), 'utf8')).version, pkg.version);
    }
  }
});
