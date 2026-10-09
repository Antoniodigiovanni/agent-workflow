import { context as sharedContext, fileCheckpointHelp, packageRoot } from '../../core/context.mjs';

export { status } from '../../core/context.mjs';
export const pluginRoot = packageRoot;

export function context(state, sessionId, options = {}) {
  return sharedContext(state, {
    harness: 'Claude Code', checkpointHelp: fileCheckpointHelp('claude-code', sessionId, state.revision), ...options,
  });
}
