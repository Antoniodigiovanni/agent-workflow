import { SessionStore } from '../../core/store.mjs';
import { runHelper } from '../../core/helper.mjs';

await runHelper(new SessionStore(), '/workflow:session');
