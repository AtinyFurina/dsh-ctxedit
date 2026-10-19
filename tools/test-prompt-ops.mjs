// 离线验证「提问侧」三种模式（edit-prompt / rewind-edit / rewind-delete）。
// 用安装版 0.2.1 的 Session.fromRestore + 关系状态机，检查写入模板是否被接受，
// 以及模型最终读到什么。只读：不改任何日志。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

import { resolveHarness } from './_lib/harness.mjs';
const ASAR = resolveHarness();
const { Session } = await import(`file:///${ASAR}/dsh-session/lib/index.js`);
const { assertReleasedV4Relationships } = await import(`file:///${ASAR}/dsh-session-format-v3-to-v4/lib/index.js`);
const { KNOWN_SESSION_EVENT_TYPES } = await import(`file:///${ASAR}/dsh-session/lib/types/known-event-types.js`);

const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = fs.readFileSync(process.argv[2]);
const b = []; let i = 0;
while ((i = buf.indexOf(M, i)) !== -1) { b.push(i); i += 4 }
b.push(buf.length);
let t = '';
for (let k = 0; k < b.length - 1; k++) { try { t += zlib.zstdDecompressSync(buf.subarray(b[k], b[k + 1])).toString('utf8') } catch {} }
const lines = t.split('\n').filter(Boolean);
const hl = JSON.parse(lines[0]);
const ev = lines.slice(1).map((l) => JSON.parse(l));
const header = { version: 4, id: hl.id, createdAt: hl.createdAt, cwd: hl.cwd, isSeeded: false, delegationDepth: 0 };

const SURF = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
function foldNodes(list) {
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
function promptOf(list, session, seq) {
  let turnStart = -1, turn = null;
  for (const e of list) if (e.type === 'turn/start' && e.seq < seq) { turnStart = e.seq; turn = e.data?.turn ?? null }
  if (turnStart < 0) return undefined;
  let original;
  for (const e of list) { if (e.seq <= turnStart || e.seq >= seq) continue; if (e.type === 'user/message' && e.surfaceOp === 'append') { original = e.seq; break } }
  if (original === undefined) return undefined;
  const nodes = foldNodes(list);
  let cur = original;
  if (!nodes.includes(cur)) {
    const carrier = [...list].reverse().find((e) => e.surfaceOp && typeof e.surfaceOp === 'object' && e.surfaceOp.startSeq <= original && original <= e.surfaceOp.endSeq);
    if (!carrier || !nodes.includes(carrier.seq)) return { seq: original, originalSeq: original, turn, text: '', visible: false };
    cur = carrier.seq;
  }
  const node = list.find((e) => e.seq === cur);
  const text = Array.isArray(node?.data?.content) ? node.data.content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('') : '';
  return { seq: cur, originalSeq: original, turn, text, visible: true };
}
function carrier(list, { text, startSeq, endSeq, shadowed }) {
  const seq = Math.max(...list.map((e) => e.seq ?? -1)) + 1;
  const content = text.length > 0 ? [{ type: 'text', text }] : [{ type: 'text', text: '\u200b' }];
  return { type: 'user/message', seq, time: Date.now(), surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs: shadowed,
    data: { id: randomUUID(), role: 'user', content, source: { kind: 'user' } } };
}

// 选一个「已闭合轮次」里的助手节点做锚点：找最后一条 turn/end 之前的 assistant 消息
const turnsEnd = ev.filter((e) => e.type === 'turn/end').map((e) => e.seq);
const lastClosed = turnsEnd.length ? turnsEnd[turnsEnd.length - 1] : 0;
const anchor = [...ev].reverse().find((e) => e.seq < lastClosed && e.type === 'assistant/message');
if (!anchor) { console.log('SKIP: 找不到已闭合轮次里的助手消息'); process.exit(2) }
const prompt = promptOf(ev, null, anchor.seq);
console.log(`锚点助手 seq=${anchor.seq}（t${anchor.data?.turn}），提问 seq=${prompt?.seq} 文本=${JSON.stringify((prompt?.text ?? '').slice(0, 50))}`);

const nodes = foldNodes(ev);
const idx = nodes.indexOf(prompt.seq);
const lastNode = nodes[nodes.length - 1];

function trial(label, event) {
  const log = [...ev, event];
  let rel = 'PASS';
  try { assertReleasedV4Relationships({ header, inheritedEventCount: 0, events: log }, KNOWN_SESSION_EVENT_TYPES) }
  catch (e) { rel = 'FAIL: ' + String(e?.message ?? e).slice(0, 110) }
  let derived = '';
  try {
    const s = Session.fromRestore(hl.id, log, header, 0, 'detached');
    const msgs = s.deriveMessages();
    const tail = msgs.slice(-4).map((m) => `${m.role}:${(m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').slice(0, 34)}`);
    derived = tail.join(' | ');
  } catch (e) { derived = 'FAIL: ' + String(e?.message ?? e).slice(0, 110) }
  console.log(`\n--- ${label}（载体 seq=${event.seq}）---`);
  console.log('关系校验:', rel);
  console.log('模型末尾:', derived);
}

const NEW = '【提问侧验证】这是改写后的提问。';
trial('A. edit-prompt（只换提问）', carrier(ev, { text: NEW, startSeq: prompt.seq, endSeq: prompt.seq, shadowed: [prompt.seq] }));
trial('B. rewind-edit（换提问 + 回退到此处）', carrier(ev, { text: NEW, startSeq: prompt.seq, endSeq: lastNode, shadowed: nodes.slice(idx) }));
trial('C. rewind-delete（撤回提问 + 回退）', carrier(ev, { text: '', startSeq: prompt.seq, endSeq: lastNode, shadowed: nodes.slice(idx) }));


