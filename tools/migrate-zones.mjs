// 为已存在的区域补上 hiddenKeys（精确 DOM key），让界面隐藏走稳定路径。
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

const logPath = process.argv[2];
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = fs.readFileSync(logPath);
const b = []; let i = 0;
while ((i = buf.indexOf(M, i)) !== -1) { b.push(i); i += 4 }
b.push(buf.length);
let text = '';
for (let k = 0; k < b.length - 1; k++) {
  try { text += zlib.zstdDecompressSync(buf.subarray(b[k], b[k + 1])).toString('utf8') } catch {}
}
const lines = text.split('\n').filter(Boolean);
const hl = JSON.parse(lines[0]);
const events = lines.slice(1).map((l) => JSON.parse(l));

const SURF = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
function fold(list) {
  const nodes = [];
  for (const e of list) {
    if (!SURF.has(e.type)) continue;
    const op = e.surfaceOp;
    if (op === 'append') { nodes.push(e.seq); continue }
    if (op && typeof op === 'object' && op.op === 'replace') {
      const a = nodes.indexOf(op.startSeq), c = nodes.indexOf(op.endSeq);
      if (a >= 0 && c >= a) nodes.splice(a, c - a + 1, e.seq);
    }
  }
  return nodes;
}

const zonesPath = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'dsh-ctxedit', 'zones.json');
const zones = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
const list = zones[hl.id] ?? [];
const bySeq = new Map(events.map((e) => [e.seq, e]));
const nodes = fold(events);

for (const zone of list) {
  if (Array.isArray(zone.hiddenKeys)) continue;
  const index = nodes.findIndex((seq) => {
    const e = bySeq.get(seq);
    const id = e?.type === 'user/message' ? e.data?.id : e?.data?.message?.id;
    return id === zone.anchorId;
  });
  if (index < 0) { console.log('找不到锚点', zone.anchorId); continue }
  const after = nodes.slice(index + 1);
  const hiddenKeys = [];
  for (const seq of after) {
    const e = bySeq.get(seq);
    if (e?.type === 'user/message' && typeof e.data?.id === 'string') hiddenKeys.push(`13:input-message${e.data.id}`);
    else if (e?.type === 'assistant/message' && Number.isSafeInteger(e.data?.turn) && Number.isSafeInteger(e.data?.step)) {
      hiddenKeys.push(`14:assistant-step${e.data.turn}:${e.data.step}`);
    }
  }
  zone.hiddenKeys = hiddenKeys;
  console.log('补齐', hl.id, '→', hiddenKeys.length, '个 key');
}
fs.writeFileSync(zonesPath, JSON.stringify(zones, null, 0));
console.log('写回', zonesPath);
