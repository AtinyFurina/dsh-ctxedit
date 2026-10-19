// 离线验证：模拟 /apply 的完整写入批次（遮蔽 + 改写 + 界面标记 + 标记遮蔽），
// 用安装版 0.2.1 校验器检查：
//   1) 关系状态机通过；
//   2) 模型读到新正文、读不到界面标记；
//   3) 轮次号无重复。
// 只读真实日志，不写盘。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

const ASAR = 'C:/Users/AtinyFurina/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
const { Session, foldSurface } = await import(`file:///${ASAR}/dsh-session/lib/index.js`);
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
const nextTurnOf = (list) => Math.max(0, ...list.filter((e) => e.type === 'turn/start' || e.type === 'turn/end').map((e) => e.data?.turn ?? 0)) + 1;

// 若日志尾部有「开着的回合」（当前轮正在跑），模拟前先把它裁掉：
// 真实插件在这种状态下会拒绝写入（护栏），这里只是为了离线验证批次的合法性。
function trimOpenTail(list) {
  let openAt = -1
  for (let k = 0; k < list.length; k += 1) {
    if (list[k].type === 'turn/start') openAt = k
    else if (list[k].type === 'turn/end') openAt = -1
  }
  return openAt < 0 ? list : list.slice(0, openAt)
}
const baseEvents = trimOpenTail(ev)
if (baseEvents.length !== ev.length) console.log(`（模拟前裁掉未闭合尾部 ${ev.length - baseEvents.length} 条事件）`)

const nodes = foldNodes(baseEvents);
const bySeq = new Map(baseEvents.map((e) => [e.seq, e]));
const target = [...nodes].reverse().map((s) => bySeq.get(s)).find((e) => e?.type === 'assistant/message' && (e.data?.message?.content ?? []).some((c) => c.type === 'text' && c.text.trim().length > 0));
if (!target) { console.log('没有可用的助手消息'); process.exit(0) }

const NEW_TEXT = '【界面标记验证】这是改写后的正文。';
const MARK_TEXT = '〔系统提示〕已改写这条回复：模型下一轮读新版内容（界面保留原文，原始记录未改动）。';
const turn = nextTurnOf(baseEvents);
let seq = baseEvents.length;
const now = Date.now();
const content = [{ type: 'text', text: NEW_TEXT }];
const stream = content.map((blk, idx) => ({ type: 'chunk', time: now + idx, chunk: { type: 'block-end', index: idx, block: blk } }));
const carrierSeq = seq, markSeq = seq + 6, markShadowSeq = seq + 7;
const batch = [
  { type: 'user/message', seq: seq++, time: now, surfaceOp: { op: 'replace', startSeq: target.seq, endSeq: target.seq }, sourceEventSeqs: [target.seq], data: { id: randomUUID(), role: 'user', content: [], source: { kind: 'plugin:ctxedit' } } },
  { type: 'turn/start', seq: seq++, time: now, data: { turn } },
  { type: 'step/start', seq: seq++, time: now, data: { turn, step: 1 } },
  { type: 'assistant/message', seq: seq++, time: now, surfaceOp: 'append', data: { turn, step: 1, message: { id: randomUUID(), role: 'assistant', content, source: { kind: 'model', provider: 'deepseek-official', model: 'context-edit' } }, stream } },
  { type: 'step/end', seq: seq++, time: now, data: { turn, step: 1 } },
  { type: 'turn/end', seq: seq++, time: now, data: { turn, reason: { kind: 'completed' } } },
  { type: 'user/message', seq: seq++, time: now, surfaceOp: 'append', data: { id: randomUUID(), role: 'user', content: [{ type: 'text', text: MARK_TEXT }], source: { kind: 'plugin:ctxedit-marker' } } },
  { type: 'user/message', seq: seq++, time: now, surfaceOp: { op: 'replace', startSeq: markSeq, endSeq: markSeq }, sourceEventSeqs: [markSeq], data: { id: randomUUID(), role: 'user', content: [], source: { kind: 'plugin:ctxedit' } } },
];
const log = [...ev, ...batch];

console.log(`目标 seq=${target.seq}（${target.type}）｜追加 seq ${carrierSeq}..${seq - 1}｜合成轮次 ${turn}`);
let ok = true;
try { assertReleasedV4Relationships({ header, inheritedEventCount: 0, events: log }, KNOWN_SESSION_EVENT_TYPES); console.log('✅ 关系状态机通过'); }
catch (e) { ok = false; console.log('❌ 关系状态机：' + e.message) }

const s = Session.fromRestore(hl.id, log, header, 0, 'detached');
const msgs = s.deriveMessages();
const texts = msgs.flatMap((m) => (m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text));
console.log('模型读到新正文：', texts.includes(NEW_TEXT), '（应为 true）');
console.log('模型读到界面标记：', texts.some((x) => String(x).includes('〔系统提示〕')), '（应为 false）');
const fold = foldSurface(log);
console.log('标记节点在模型可见面上：', fold.nodes.includes(markSeq), '（应为 false）');
console.log('标记事件本身存在（界面会渲染）：', log.some((e) => e.seq === markSeq && e.type === 'user/message'), '（应为 true）');
const starts = log.filter((e) => e.type === 'turn/start').map((e) => e.data.turn);
console.log('轮次号连续无重复：', starts.join(',') === starts.map((_, k) => k + 1).join(','), '→', starts.slice(-4).join(','));
process.exit(ok ? 0 : 1);
