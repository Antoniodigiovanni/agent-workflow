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
console.log('Syntax, JSON, skill entrypoint, and plugin wiring checks passed.');
