import { SessionStore, stateDirectory } from '../../core/store.mjs';
import { runHelper } from '../../core/helper.mjs';

await runHelper(new SessionStore(stateDirectory(process.env, 'codex')), 'workflow-session');
