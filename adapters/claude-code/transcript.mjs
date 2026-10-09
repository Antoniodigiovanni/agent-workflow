import { readFile } from 'node:fs/promises';

// Only message ancestry is used. Conversation prose never selects a workflow.
export async function transcriptBranch(path) {
  if (!path) return { anchors: [], sessionIds: [] };
  let contents;
  try { contents = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { anchors: [], sessionIds: [] }; throw error; }
  const nodes = new Map();
  let head;
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // A concurrent writer may leave a partial last line.
    if (row.isSidechain || typeof row.uuid !== 'string') continue;
    nodes.set(row.uuid, row);
    // Claude inserts attachment rows between ordinary messages. Keep them in the
    // ancestry or every assistant response appears disconnected from its prompt.
    if (['user', 'assistant', 'system', 'attachment'].includes(row.type)) head = row;
  }
  const anchors = [], sessionIds = [], seen = new Set();
  while (head && !seen.has(head.uuid)) {
    seen.add(head.uuid);
    anchors.unshift(head.uuid);
    if (typeof head.sessionId === 'string' && !sessionIds.includes(head.sessionId)) sessionIds.push(head.sessionId);
    head = nodes.get(head.parentUuid);
  }
  return { anchors, sessionIds };
}

export function snapshot(record, anchors) {
  const anchor = anchors.at(-1);
  if (!anchor) return;
  const item = { anchor, state: structuredClone(record.state) };
  const previous = record.history.at(-1);
  if (previous?.anchor === anchor) record.history[record.history.length - 1] = item;
  else record.history.push(item);
}

export function atBranch(record, anchors) {
  const positions = new Map(anchors.map((id, index) => [id, index]));
  let best;
  for (const entry of record.history) {
    if (positions.has(entry.anchor) && (!best || positions.get(entry.anchor) >= positions.get(best.anchor))) best = entry;
  }
  return best ? structuredClone(best.state) : null;
}
