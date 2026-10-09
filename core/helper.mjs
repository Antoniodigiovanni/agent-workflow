import { checkpoint } from './state.mjs';
import { status } from './context.mjs';

export async function runHelper(store, command) {
  try {
    const [action, ...args] = process.argv.slice(2);
    if (!['checkpoint', 'status'].includes(action)) throw new Error(`Use checkpoint or status. Workflow selection is user-only through ${command}.`);
    const flags = {};
    if (args.length % 2) throw new Error('Invalid helper arguments');
    for (let i = 0; i < args.length; i += 2) {
      if (!['--session', '--revision'].includes(args[i]) || Object.hasOwn(flags, args[i])) throw new Error('Invalid helper arguments');
      flags[args[i]] = args[i + 1];
    }
    const id = flags['--session'];
    if (action === 'status') console.log(status((await store.read(id)).state));
    else {
      if (!/^\d+$/.test(flags['--revision'] || '')) throw new Error('Checkpoint requires --revision from current status');
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      const patch = JSON.parse(raw);
      const record = await store.update(id, record => { record.state = checkpoint(record.state, patch, Number(flags['--revision'])); });
      console.log(JSON.stringify(record.state));
    }
  } catch (error) {
    console.error(`Agent Workflow: ${error.message}`);
    process.exitCode = 1;
  }
}
