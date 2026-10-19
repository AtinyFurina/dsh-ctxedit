// 独立复验 0.3.0 的「提问侧」三种模式，用**安装版 0.2.1** 的校验器。
// 不写任何文件：所有追加都发生在内存副本上。
//
// 做法：把日志截到「最后一个 turn/end」（= 用户点按钮那一刻的状态），
// 然后按 lib/index.js 里 userCarrier 的规则模拟 edit-prompt / rewind-edit / rewind-delete，
// 每次跑 assertReleasedV4Relationships + Session.fromRestore，检查模型最终读到什么。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

const ASAR = 'C:/Users/AtinyFurina/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
const { Session } = await import(`file:///${ASAR}/dsh-session/lib/index.js`);
const { assertReleasedV4Relationships } = await import(`file:///${ASAR}/dsh-session-format-v3-to-v4/lib/index.js`);
const { KNOWN_SESSION_EVENT_TYPES } = await import(`file:///${ASAR}/dsh-session/lib/types/known-event-types.js`);

const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = fs.readFileSync(process.argv[2]);
const b = []; let i = 0;
while ((i = buf.indexOf(M, i)) !== -1) { b.push(i); i += 4 }
b.push(buf.length);
let text = '';
for (let k = 0; k < b.length - 1; k++) { try { text += zlib.zstdDecompressSync(buf.subarray(b[k], b[k + 1])).toString('utf8') } catch {} }
const lines = text.split('\n').filter(Boolean);
const hl = JSON.parse(lines[0]);
const all = lines.slice(1).map((l) => JSON.parse(l));
const header = { version: 4, id: hl.id, createdAt: hl.createdAt, cwd: hl.cwd, isSeeded: false, delegationDepth: 0 };

// 截到最后一个 turn/end（用户点按钮时的稳定状态）
let cut = all.length;
for (let k = all.length - 1; k >= 0; k -= 1) if (all[k].type === 'turn/end') { cut = k + 1; break }
const base = all.slice(0, cut);
console.log(`日志 ${all.length} 事件；截到最后一个 turn/end → ${base.length} 事件\n`);

const SURF = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
function foldNodes(events) {
  const nodes = [];
  for (const e of events) {
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
const bySeq = new Map(base.map((e) => [e.seq, e]));
// 找最后一个闭合轮的提问：最后一个 turn/start 之后的第一条 append user/message
let turnStartSeq = -1, turn = null;
for (const e of base) if (e.type === 'turn/start') { turnStartSeq = e.seq; turn = e.data?.turn ?? null }
let promptSeq;
for (const e of base) if (e.seq > turnStartSeq && e.type === 'user/message' && e.surfaceOp === 'append') { promptSeq = e.seq; break }
const promptText = (bySeq.get(promptSeq)?.data?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
console.log(`最后一个闭合轮：turn ${turn}；提问 seq=${promptSeq} ${JSON.stringify(promptText.slice(0, 60))}\n`);

function derive(events) {
  const s = Session.fromRestore(hl.id, events, header, 0, 'detached');
  return s.deriveMessages().map((m) => `${m.role}:${(m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').slice(0, 40)}`);
}
function check(events) {
  try { assertReleasedV4Relationships({ header, inheritedEventCount: 0, events }, KNOWN_SESSION_EVENT_TYPES); return 'PASS' }
  catch (e) { return 'FAIL: ' + String(e?.message ?? e).slice(0, 100) }
}

const NEW_TEXT = '【复验】我还想和你谈论宇宙和天空';
function simulate(mode) {
  const nodes = foldNodes(base);
  const index = nodes.indexOf(promptSeq);
  if (index < 0) return { err: 'prompt not on surface' };
  const endSeq = nodes[nodes.length - 1];
  const isRewind = mode !== 'edit-prompt';
  const startSeq = promptSeq;
  const end = isRewind ? endSeq : promptSeq;
  const shadowed = isRewind ? nodes.slice(index) : [promptSeq];
  const content = (mode === 'rewind-delete' || mode === 'edit-prompt' && NEW_TEXT.length === 0)
    ? [{ type: 'text', text: '\u200b' }]
    : [{ type: 'text', text: mode === 'rewind-delete' ? '\u200b' : NEW_TEXT }];
  const carrier = {
    type: 'user/message', seq: base.length, time: Date.now(),
    surfaceOp: { op: 'replace', startSeq, endSeq: end },
    sourceEventSeqs: shadowed,
    data: { id: randomUUID(), role: 'user', content, source: { kind: 'user' } },
  };
  return { events: [...base, carrier], carrier, shadowed: shadowed.length, from: startSeq, to: end };
}

for (const mode of ['edit-prompt', 'rewind-edit', 'rewind-delete']) {
  const r = simulate(mode);
  if (r.err) { console.log(`❌ ${mode}: ${r.err}`); continue }
  const verdict = check(r.events);
  const all = derive(r.events);
  const tail = all.slice(-3);
  console.log(`=== ${mode} ===`);
  console.log(`  载体 seq=${r.carrier.seq} 遮蔽 ${r.shadowed} 个节点，区间 ${r.from}..${r.to}`);
  console.log(`  关系状态机: ${verdict}`);
  console.log(`  模型末尾: ${JSON.stringify(tail)}`);
  const hasNew = all.some((x) => x.includes('宇宙和天空'));
  const hasOld = all.some((x) => x.includes('举个例子，claude code 的rewind'));
  const last = tail[tail.length - 1] ?? '';
  if (mode === 'edit-prompt') {
    console.log(`  判定: 新文字${hasNew ? '在 ✅' : '不在 ❌'}；旧文字${hasOld ? '仍在 ❌' : '已消失 ✅'}；后续回复${tail.some((x) => x.startsWith('assistant:')) ? '仍在 ✅' : '丢失 ❌'}`);
  }
  if (mode === 'rewind-edit') console.log(`  判定: ${last.startsWith('user:【复验】') && !hasOld ? '✅ 模型末尾只剩新提问（整轮已回退）' : '❌ 末尾不是新提问：' + last}`);
  if (mode === 'rewind-delete') console.log(`  判定: ${!hasNew && !hasOld ? '✅ 提问及之后内容都不在模型视野' : '❌ 仍能看到被撤回内容'}`);
  console.log('');
}
