import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    files.push(...entry.isDirectory() ? await walk(path) : [path]);
  }
  return files;
}

for (const path of await walk('.')) {
  if (path.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
  if (path.endsWith('.mjs') || path.endsWith('.js')) {
    const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${path}: ${check.stderr}`);
  }
}
const skill = await readFile('skills/session/SKILL.md', 'utf8');
assert.match(skill, /^---\n/);
assert.match(skill, /disable-model-invocation: true/);
const plugin = JSON.parse(await readFile('.claude-plugin/plugin.json', 'utf8'));
assert.equal(plugin.name, 'workflow');
const hooks = JSON.parse(await readFile('hooks/hooks.json', 'utf8'));
for (const event of ['SessionStart', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'SessionEnd']) assert.ok(hooks.hooks[event]);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.version, plugin.version);
const codex = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
assert.equal(codex.version, pkg.version);
assert.equal(codex.skills, './adapters/codex/skills/');
assert.equal(codex.hooks, './adapters/codex/hooks.json');
const codexHooks = JSON.parse(await readFile(codex.hooks, 'utf8'));
assert.deepEqual(Object.keys(codexHooks.hooks).sort(), ['PreToolUse', 'SessionStart', 'UserPromptSubmit']);
assert.deepEqual(pkg.pi.extensions, ['./adapters/pi/extension.js']);
for (const type of ['skills', 'prompts', 'themes']) assert.deepEqual(pkg.pi[type], []);
await readFile(pkg.pi.extensions[0]);
await readFile(`${codex.skills}workflow-session/SKILL.md`);
console.log('Syntax, JSON, skills, version consistency, and three-harness package wiring checks passed.');
