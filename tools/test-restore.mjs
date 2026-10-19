// 离线验证「还原原样」这条新路径：模拟 /apply mode=restore 的写入，
// 然后喂给真实校验器 + Session.fromRestore，确认：
//   1) 关系状态机通过（含合成轮次）；
//   2) 模型读到的最后一条助手消息 = 原始版本的正文/思考；
//   3) 轮次号仍严格连续。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

const HARNESS = 'C:/Users/AtinyFurina/AppData/Local/Temp/asar-probe-ineffa/all/dsh/node_modules/@deepseek-ai';
const { Session } = await import(`file:///${HARNESS}/dsh-session/lib/index.js`);
const { assertReleasedV4Relationships } = await import(`file:///${HARNESS}/dsh-session-format-v3-to-v4/lib/index.js`);
const { KNOWN_SESSION_EVENT_TYPES } = await import(`file:///${HARNESS}/dsh-session/lib/types/known-event-types.js`);

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

// —— 与插件 lib/index.js 同源的两段逻辑 ——
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
function shadowLineage(list, nodeSeq) {
  const bySeq = new Map(list.map((e) => [e.seq, e]));
  const chain = [nodeSeq];
  let cur = nodeSeq;
  for (let hops = 0; hops < 16; hops += 1) {
    const e = bySeq.get(cur);
    if (!e || !(e.surfaceOp && typeof e.surfaceOp === 'object')) break;
    const shadowed = e.surfaceOp.startSeq;
    if (typeof shadowed !== 'number' || shadowed === cur) break;
    chain.push(shadowed);
    cur = shadowed;
  }
  return { originSeq: chain[chain.length - 1], rewrites: chain.length - 1, chain };
}
function nextTurnOf(list) {
  let max = 0;
  for (const e of list) if (e.type === 'turn/start' || e.type === 'turn/end') { const v = e.data?.turn; if (typeof v === 'number' && v > max) max = v }
  return max + 1;
}

const nodes = foldNodes(ev);
// 找一条「被改写过」的可见节点来还原：它的血统长度 > 1
// （改写后当前可见的是「载体」或「新助手消息」，两者都记着 surfaceOp，可以顺着回溯到原稿）
const candidate = [...nodes].reverse()
  .map((s) => ({ s, lin: shadowLineage(ev, s) }))
  .find((x) => x.lin.rewrites > 0);
if (!candidate) { console.log('这条日志里没有「被改写过的节点」可用于测试还原'); process.exit(0) }
const { s: targetSeq, lin } = candidate;
const origin = ev[lin.originSeq];
const origText = (origin.data?.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
console.log(`目标 seq=${targetSeq}（${ev[targetSeq]?.type}，被改过 ${lin.rewrites} 次，血统 ${lin.chain.join('→')}）`);
console.log(`原始版本 seq=${lin.originSeq}（${origin?.type}），正文 ${JSON.stringify(origText.slice(0, 60))}`);

// 模拟插件的 restore：遮蔽当前 + 写入原稿为新的助手消息（新 id，合成轮次）
const turn = nextTurnOf(ev);
let seq = ev.length;
const now = Date.now();
const content = [{ type: 'reasoning', text: '【还原测试】原始思考' }, { type: 'text', text: origText }];
const batch = [
  { type: 'user/message', seq: seq++, time: now, surfaceOp: { op: 'replace', startSeq: targetSeq, endSeq: targetSeq }, sourceEventSeqs: [targetSeq], data: { id: randomUUID(), role: 'user', content: [], source: { kind: 'plugin:ctxedit' } } },
  { type: 'turn/start', seq: seq++, time: now, data: { turn } },
  { type: 'step/start', seq: seq++, time: now, data: { turn, step: 1 } },
  { type: 'assistant/message', seq: seq++, time: now, surfaceOp: 'append',
    data: { turn, step: 1, message: { id: randomUUID(), role: 'assistant', content, source: { kind: 'model', provider: 'deepseek-official', model: 'context-edit' } },
      stream: content.map((blk, idx) => ({ type: 'chunk', time: now + idx, chunk: { type: 'block-end', index: idx, block: blk } })) } },
  { type: 'step/end', seq: seq++, time: now, data: { turn, step: 1 } },
  { type: 'turn/end', seq: seq++, time: now, data: { turn, reason: { kind: 'completed' } } },
];
const log = [...ev, ...batch];

const res = (n, fn) => { try { const r = fn(); console.log('✅ ' + n + (r ? '  → ' + r : '')) } catch (e) { console.log('❌ ' + n + '  !! ' + String(e?.message ?? e).slice(0, 140)) } };
console.log('\n追加：' + batch.map((e) => e.type).join(' → ') + `（合成轮次 ${turn}）`);
res('关系状态机', () => { assertReleasedV4Relationships({ header, inheritedEventCount: 0, events: log }, KNOWN_SESSION_EVENT_TYPES); return '通过' });
res('Session.fromRestore + 模型读到的末条助手消息', () => {
  const s = Session.fromRestore(hl.id, log, header, 0, 'detached');
  const m = s.deriveMessages();
  const last = [...m].reverse().find((x) => x.role === 'assistant');
  const txt = (last.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const think = (last.content ?? []).filter((c) => c.type === 'reasoning').map((c) => c.text).join('');
  if (txt !== origText) throw new Error('还原后的正文与原始版本不一致');
  return `原稿已回到视野：${JSON.stringify(txt.slice(0, 40))}　思考=${JSON.stringify(think.slice(0, 20))}`;
});
res('轮次号严格连续', () => {
  const st = log.filter((e) => e.type === 'turn/start').map((e) => e.data.turn);
  if (st.join(',') !== st.map((_, k) => k + 1).join(',')) throw new Error('不连续: ' + st.join(','));
  return st.join(',');
});
res('可见助手消息无同 id 重复', () => {
  const ids = foldNodes(log).map((s) => log[s]).filter((e) => e?.type === 'assistant/message').map((e) => e.data?.message?.id);
  const dup = ids.filter((id, k) => ids.indexOf(id) !== k);
  if (dup.length) throw new Error('重复 id: ' + [...new Set(dup)].join(','));
  return ids.length + ' 条，全唯一';
});
