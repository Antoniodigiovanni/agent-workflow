import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initialState, validateState } from './state.mjs';

export function stateDirectory(env = process.env, harness = 'claude-code') {
  if (!['claude-code', 'codex'].includes(harness)) throw new Error('Unknown file-store harness');
  const config = harness === 'codex'
    ? env.CODEX_HOME || join(homedir(), '.codex')
    : env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return env.WORKFLOW_STATE_DIR || join(config, 'agent-workflows', 'sessions');
}

export function validateSessionId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid session ID');
  return id;
}

export function newRecord(sessionId) {
  return { version: 1, sessionId: validateSessionId(sessionId), state: initialState(), history: [], turnControlRevision: null, turns: {} };
}

export class SessionStore {
  constructor(directory = stateDirectory()) { this.directory = directory; }

  path(id) { return join(this.directory, `${validateSessionId(id)}.json`); }

  async read(id) {
    let record;
    try { record = JSON.parse(await readFile(this.path(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return newRecord(id); throw error; }
    if (record.version !== 1 || record.sessionId !== id || !Array.isArray(record.history)) throw new Error('Invalid session record');
    validateState(record.state);
    record.turns ??= {};
    if (!record.turns || typeof record.turns !== 'object' || Array.isArray(record.turns) ||
        Object.values(record.turns).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid prompt generations');
    for (const item of record.history) {
      if (typeof item.anchor !== 'string') throw new Error('Invalid session history');
      validateState(item.state);
    }
    return record;
  }

  async exists(id) {
    try { await readFile(this.path(id)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  async update(id, change) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = `${this.path(id)}.lock`;
    const deadline = Date.now() + 2000;
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error('Session state is busy; retry the command. If a process crashed, remove its .lock directory.');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    const temporary = `${this.path(id)}.${randomUUID()}.tmp`;
    try {
      const record = await this.read(id);
      const result = await change(record);
      validateState(record.state);
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path(id));
      return result ?? record;
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
}
