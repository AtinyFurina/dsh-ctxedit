// 打印一条会话日志的结构：轮次号、可见节点、替换事件、重复轮次号检查。
// 只读，不写任何东西。
// 用法: node check-log.mjs <session.v4.jsonl.zstd>
import fs from 'node:fs';
import zlib from 'node:zlib';

const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = fs.readFileSync(process.argv[2]);
const b = []; let i = 0;
while ((i = buf.indexOf(M, i)) !== -1) { b.push(i); i += 4 }
b.push(buf.length);
let t = '';
for (let k = 0; k < b.length - 1; k++) { try { t += zlib.zstdDecompressSync(buf.subarray(b[k], b[k + 1])).toString('utf8') } catch {} }
const lines = t.split('\n').filter(Boolean);
const header = JSON.parse(lines[0]);
const ev = lines.slice(1).map((l) => JSON.parse(l));

console.log('文件', buf.length, '字节｜帧', b.length - 1, '｜事件', ev.length);
console.log('header:', JSON.stringify(header));
console.log('seq 与下标一致:', ev.every((e, idx) => e.seq === idx));

const starts = ev.filter((e) => e.type === 'turn/start').map((e) => e.data?.turn);
const ends = ev.filter((e) => e.type === 'turn/end').map((e) => e.data?.turn);
console.log('turn/start:', starts.join(','));
console.log('turn/end  :', ends.join(','));
const dupStarts = starts.filter((v, k) => starts.indexOf(v) !== k);
const dupEnds = ends.filter((v, k) => ends.indexOf(v) !== k);
console.log('重复轮次号:', (dupStarts.length || dupEnds.length) ? `⚠ start[${[...new Set(dupStarts)]}] end[${[...new Set(dupEnds)]}]` : '无');
const expect = starts.map((_, k) => k + 1).join(',');
console.log('轮次号严格连续:', starts.join(',') === expect ? '✅' : `❌ 期望 ${expect}`);

const SURF = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
const nodes = [];
for (const e of ev) {
  if (!SURF.has(e.type)) continue;
  const op = e.surfaceOp;
  if (op === 'append') { nodes.push(e.seq); continue }
  if (op && typeof op === 'object' && op.op === 'replace') {
    const a = nodes.indexOf(op.startSeq), c = nodes.indexOf(op.endSeq);
    if (a >= 0 && c >= a) nodes.splice(a, c - a + 1, e.seq);
  }
}
const bySeq = new Map(ev.map((e) => [e.seq, e]));
console.log('\n--- 替换事件 ---');
for (const e of ev.filter((x) => x.surfaceOp && typeof x.surfaceOp === 'object')) {
  const m = e.type === 'user/message' ? e.data : e.data?.message;
  const txt = (m?.content ?? []).map((c) => (c.type === 'text' ? c.text : `<${c.type}>`)).join('');
  console.log(`  carrier seq=${e.seq} ${e.type} 遮蔽 ${e.surfaceOp.startSeq}｜${JSON.stringify(txt.slice(0, 50))}`);
}
console.log('\n--- 可见助手消息（末 6 条）---');
const asst = nodes.map((s) => bySeq.get(s)).filter((e) => e?.type === 'assistant/message');
for (const e of asst.slice(-6)) {
  const txt = (e.data?.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  console.log(`  seq=${e.seq} t${e.data?.turn}/s${e.data?.step} id=${(e.data?.message?.id ?? '').slice(0, 8)} :: ${JSON.stringify(txt.slice(0, 56))}`);
}
const ids = asst.map((e) => e.data?.message?.id);
const dupIds = ids.filter((v, k) => ids.indexOf(v) !== k);
console.log('可见助手消息 id 唯一:', dupIds.length ? `❌ 重复 ${[...new Set(dupIds)].length} 组` : `✅（${ids.length} 条）`);
