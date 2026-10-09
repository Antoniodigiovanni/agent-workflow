import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function status(state) {
  return `Workflow: ${state.active ? 'on' : 'off'} | selected: ${state.mode ?? 'none'} | phase: ${state.phase ?? 'none'}\n` +
    `Scope: ${state.scope || 'not established'}\nStep: ${state.step || 'not established'}\n` +
    `Pending question: ${state.pendingQuestion ?? 'none'}\nRevision: ${state.revision}`;
}

export async function context(state, { harness, checkpointHelp = '', control = null, task = '', warning = '' } = {}) {
  if (!state.active && !state.mode && control === null && !warning) return '';
  const parts = ['Current Agent Workflow session state (supersedes historical workflow context):', JSON.stringify(state)];
  if (warning) parts.push(warning);
  if (!state.active) {
    parts.push(`Agent Workflow is off. Its Pair/Delegate instructions and automatic continuation are suspended. Use ordinary ${harness} behavior; retain saved notes without resuming their tasks.`);
  } else {
    parts.push(await readFile(join(packageRoot, 'workflows/common.md'), 'utf8'));
    parts.push(await readFile(join(packageRoot, `workflows/${state.mode}.md`), 'utf8'));
    if (checkpointHelp) parts.push(checkpointHelp);
  }
  if (control !== null) {
    parts.push(`User control: ${control || '(no action)'}.\n${status(state)}`);
    if (!control || (control === 'on' && !state.mode)) {
      parts.push('Ask in ordinary chat what kind of collaboration the user wants (Pair or Delegate). No mode was inferred. Do not start development.');
    } else if (['status', 'on', 'off'].includes(control)) {
      parts.push('Report the control result briefly, then end this turn. Do not inspect the project, change task notes, or resume development. On restores context only.');
    } else if (!task) {
      parts.push('Confirm the selected mode briefly. Ask for the next Pair step or the complete Delegate scope as needed, then wait. Mode selection alone does not resume work.');
    } else {
      parts.push(`User supplied task/context: ${JSON.stringify(task)}. Follow the selected workflow for this request.`);
    }
  }
  return parts.join('\n\n');
}

export function fileCheckpointHelp(adapter, sessionId, revision) {
  return `Task checkpoint helper: node ${shellQuote(join(packageRoot, `adapters/${adapter}/cli.mjs`))} checkpoint --session ${shellQuote(sessionId)} --revision ${revision}.\n` +
    'Supply a JSON object on stdin using a quoted heredoc. Fields: phase, scope, step, decisions (string array), acceptanceCriteria (string array), pendingQuestion (string or null), prs (string array). ' +
    'Use the normal permission flow. This helper updates task notes only. Read its returned revision for the next checkpoint. Never invoke a selection action through the helper. ' +
    'If a checkpoint fails, report unsaved notes truthfully. Do not edit the state file directly.';
}
