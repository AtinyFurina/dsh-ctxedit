// 验证「方案 2」是否可行：改写后的正文能否放进 user/message 载体本身，
// 从而不再需要合成轮次（也就不会与宿主的内存轮次计数器撞号）。
//
// 三个候选，全部喂给真实校验器 + Session.fromRestore：
//   A. user 载体 + role:'assistant' + 改写正文  → 模型会把它当谁说的？
//   B. user 载体 + role:'user'      + 改写正文  → 基线对照
//   C. user 载体 + role:'user'      + 空内容     → 现在插件用的遮蔽方式
import fs from 'node:fs';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

import { resolveHarness } from './_lib/harness.mjs';
const HARNESS = resolveHarness();
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
const headerLine = JSON.parse(lines[0]);
const events = lines.slice(1).map((l) => JSON.parse(l));

// 目标：最后一条可见的助手消息
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
const nodes = foldNodes(events);
const targetSeq = [...nodes].reverse().find((s) => events[s].type === 'assistant/message');
console.log('目标助手节点 seq=' + targetSeq + '，现有事件 ' + events.length + ' 条');

const header = { version: 4, id: headerLine.id, createdAt: headerLine.createdAt, cwd: headerLine.cwd, isSeeded: false, delegationDepth: 0 };
const NEW_TEXT = '【方案2验证】这是改写后的正文。';
const NEW_THINK = '【方案2验证】这是改写后的思考。';

function trial(label, carrier) {
  const log = [...events, carrier];
  let rel = 'PASS';
  try { assertReleasedV4Relationships({ header, inheritedEventCount: 0, events: log }, KNOWN_SESSION_EVENT_TYPES) }
  catch (e) { rel = 'FAIL: ' + String(e?.message ?? e).slice(0, 90) }
  let derived = '';
  try {
    const s = Session.fromRestore(headerLine.id, log, header, 0, 'detached');
    const msgs = s.deriveMessages();
    const tail = msgs.slice(-3).map((m) => `${m.role}:${(m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').slice(0, 40)}`);
    const think = msgs.filter((m) => (m.content ?? []).some((c) => c.type === 'reasoning')).length;
    derived = tail.join(' | ') + `　（带 reasoning 的消息数=${think}）`;
  } catch (e) { derived = 'FAIL: ' + String(e?.message ?? e).slice(0, 90) }
  console.log(`\n--- ${label} ---`);
  console.log('关系校验 :', rel);
  console.log('模型读到 :', derived);
}

const seq = events.length;
const base = {
  type: 'user/message', seq, time: Date.now(),
  surfaceOp: { op: 'replace', startSeq: targetSeq, endSeq: targetSeq },
  sourceEventSeqs: [targetSeq],
};

trial('A. user 载体 + role:assistant + 正文+思考', {
  ...base,
  data: { id: randomUUID(), role: 'assistant', content: [{ type: 'reasoning', text: NEW_THINK }, { type: 'text', text: NEW_TEXT }], source: { kind: 'model', provider: 'deepseek-official', model: 'context-edit' } },
});
trial('B. user 载体 + role:user + 正文+思考', {
  ...base,
  data: { id: randomUUID(), role: 'user', content: [{ type: 'reasoning', text: NEW_THINK }, { type: 'text', text: NEW_TEXT }], source: { kind: 'user' } },
});
trial('C. user 载体 + role:user + 空内容（现方案）', {
  ...base,
  data: { id: randomUUID(), role: 'user', content: [], source: { kind: 'plugin:ctxedit' } },
});

