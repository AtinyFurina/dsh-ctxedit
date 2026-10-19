// 给已有区域补 hiddenTurns：按会话日志算出被回退轮次（含锚点所在轮）。
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
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

function loadLog(file) {
  const buf = fs.readFileSync(file);
  const b = []; let i = 0;
  while ((i = buf.indexOf(M, i)) !== -1) { b.push(i); i += 4 }
  b.push(buf.length);
  let t = '';
  for (let k = 0; k < b.length - 1; k++) { try { t += zlib.zstdDecompressSync(buf.subarray(b[k], b[k + 1])).toString('utf8') } catch {} }
  const L = t.split('\n').filter(Boolean);
  return { hl: JSON.parse(L[0]), ev: L.slice(1).map((x) => JSON.parse(x)) };
}

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const zonesPath = path.join(home, 'dsh-ctxedit', 'zones.json');
const zones = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
const sessionsRoot = path.join(home, 'sessions');
const files = new Map();
for (const dir of fs.readdirSync(sessionsRoot)) {
  const full = path.join(sessionsRoot, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const sid of fs.readdirSync(full)) {
    const f = path.join(full, sid, 'session.v4.jsonl.zstd');
    if (fs.existsSync(f)) files.set(sid, f);
  }
}

for (const [sid, list] of Object.entries(zones)) {
  const file = files.get(sid);
  if (!file) { console.log(sid, '找不到日志'); continue }
  const { ev } = loadLog(file);
  const bySeq = new Map(ev.map((e) => [e.seq, e]));
  const nodes = fold(ev);
  for (const zone of list) {
    if (Array.isArray(zone.hiddenTurns) && zone.hiddenTurns.length > 0) continue;
    // 锚点可能已经被遮蔽、不在 surface 上：直接按消息 id 在全部事件里找。
    const anchorEvent = ev.find((e) => {
      const id = e?.type === 'user/message' ? e.data?.id : e?.data?.message?.id;
      return id === zone.anchorId;
    });
    if (!anchorEvent) { console.log(sid, '找不到锚点事件', zone.anchorId); continue }
    const anchorSeq = anchorEvent.seq;
    // 找到遮蔽锚点的那条载体（在标记之前的最近一条 user 区间替换）。
    const carrier = ev
      .filter((e) => e.type === 'user/message' && e.surfaceOp && typeof e.surfaceOp === 'object'
        && Array.isArray(e.sourceEventSeqs) && e.sourceEventSeqs.includes(anchorSeq)
        && (typeof zone.markerSeq !== 'number' || e.seq < zone.markerSeq))
      .at(-1);
    const shadowed = carrier ? carrier.sourceEventSeqs : [];
    const turns = new Set();
    for (const s of shadowed) {
      const e = bySeq.get(s);
      if (e?.type === 'assistant/message' && Number.isSafeInteger(e.data?.turn)) turns.add(e.data.turn);
    }
    let anchorTurn = null;
    for (const e of ev) if (e.type === 'turn/start' && e.seq < anchorSeq) anchorTurn = e.data?.turn ?? null;
    if (Number.isSafeInteger(anchorTurn)) turns.add(anchorTurn);
    zone.hiddenTurns = [...turns].sort((a, b) => a - b);
    console.log(sid.slice(0, 13), 'zone', zone.markerSeq, '→ turns', JSON.stringify(zone.hiddenTurns));
  }
}
fs.writeFileSync(zonesPath, JSON.stringify(zones, null, 0));
console.log('写回', zonesPath);
