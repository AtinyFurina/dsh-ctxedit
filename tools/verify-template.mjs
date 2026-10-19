// 用真实校验器校验「dsh-ctxedit 的写入模板」是否会被接受。
// 输入：真实会话日志（只读，不写回）。做法：取出它的全部事件，
// 末尾按插件的写入规则追加「遮蔽原节点 + 合成轮次里的新助手消息」，
// 然后依次喂给 foldSurface / assertReleasedV4Relationships / Session.fromRestore，
// 并检查 deriveMessages() 里模型读到的是不是新内容。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

const HARNESS = 'C:/Users/AtinyFurina/AppData/Local/Temp/asar-probe-ineffa/all/dsh/node_modules/@deepseek-ai';
const { foldSurface } = await import(`file:///${HARNESS}/dsh-session/lib/types/surface.js`);
const { Session } = await import(`file:///${HARNESS}/dsh-session/lib/index.js`);
const { assertReleasedV4Relationships, restoreReleasedV4Artifact } = await import(`file:///${HARNESS}/dsh-session-format-v3-to-v4/lib/index.js`);
const { KNOWN_SESSION_EVENT_TYPES } = await import(`file:///${HARNESS}/dsh-session/lib/types/known-event-types.js`);

// ---- 读真实日志（多帧 zstd） ----
const logPath = process.argv[2];
const buf = fs.readFileSync(logPath);
const PREFIX = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const bounds = [];
let i = 0;
while ((i = buf.indexOf(PREFIX, i)) !== -1) { bounds.push(i); i += 4; }
bounds.push(buf.length);
let text = '';
for (let k = 0; k < bounds.length - 1; k++) {
  try { text += zlib.zstdDecompressSync(buf.subarray(bounds[k], bounds[k + 1])).toString('utf8'); } catch {}
}
const lines = text.split('\n').filter(Boolean);
const headerLine = JSON.parse(lines[0]);
const events = lines.slice(1).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
console.log('真实日志：', logPath.replace(/.*sessions\\/, ''));
console.log('header:', JSON.stringify(headerLine));
console.log('事件', events.length, '条，seq 0..', events.length - 1, '（seq 应等于下标）');

const seqOk = events.every((e, idx) => e.seq === idx);
console.log('seq 与下标一致:', seqOk);

// ---- 复刻插件的写入规则 ----
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
function foldNodes(list) {
  const nodes = [];
  for (const e of list) {
    if (!SURFACE.has(e.type)) continue;
    const op = e.surfaceOp;
    if (op === 'append') { nodes.push(e.seq); continue }
    if (op && typeof op === 'object' && op.op === 'replace') {
      const a = nodes.indexOf(op.startSeq), b = nodes.indexOf(op.endSeq);
      if (a >= 0 && b >= a) nodes.splice(a, b - a + 1, e.seq);
    }
  }
  return nodes;
}
// 与插件 lib/index.js 的 nextTurnOf 保持一致：取已见过的最大轮次号 + 1
function nextTurnOf(list) {
  let max = 0;
  for (const e of list) {
    if (e.type === 'turn/start' || e.type === 'turn/end') {
      const turn = e.data?.turn;
      if (typeof turn === 'number' && turn > max) max = turn;
    }
  }
  return max + 1;
}

// 目标：最后一条可见的助手消息（模拟用户点「改上下文」）
const nodes = foldNodes(events);
const lastAssistantSeq = [...nodes].reverse().find((s) => events[s].type === 'assistant/message');
const target = events[lastAssistantSeq];
const originalId = target.data?.message?.id;
const oldText = (target.data?.message?.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
console.log('\n目标节点 seq=' + lastAssistantSeq + ' id=' + originalId + ' 正文长度=' + oldText.length);

const NEXT_TEXT = '【写入模板验证】这是改写后的正文。';
const NEXT_REASON = '【写入模板验证】这是改写后的思考过程。';
const turn = nextTurnOf(events);
let seq = events.length;   // 新 seq 必须恰好接在尾部
const batch = [];
const push = (type, data, extra = {}) => batch.push({ type, seq: seq++, time: Date.now(), data, ...extra });

// ① 遮蔽原节点（无回合 user 载体，空内容）
push('user/message', { id: randomUUID(), role: 'user', content: [], source: { kind: 'plugin:ctxedit' } },
  { surfaceOp: { op: 'replace', startSeq: lastAssistantSeq, endSeq: lastAssistantSeq }, sourceEventSeqs: [lastAssistantSeq] });
// ② 合成轮次 + 新助手消息（新 id、stream 与 content 自洽）
const content = [{ type: 'reasoning', text: NEXT_REASON }, { type: 'text', text: NEXT_TEXT }];
const now = Date.now();
const stream = content.map((block, index) => ({ type: 'chunk', time: now + index, chunk: { type: 'block-end', index, block } }));
push('turn/start', { turn });
push('step/start', { turn, step: 1 });
push('assistant/message', {
  turn, step: 1,
  message: {
    id: randomUUID(),
    role: 'assistant',
    content,
    source: { kind: 'model', provider: target.data?.message?.source?.provider ?? 'deepseek-official', model: target.data?.message?.source?.model ?? 'context-edit' },
  },
  stream,
  ...(target.data?.usage !== undefined ? { usage: target.data.usage } : {}),
}, { surfaceOp: 'append' });
push('step/end', { turn, step: 1 });
push('turn/end', { turn, reason: { kind: 'completed' } });

console.log('追加事件 seq ' + batch[0].seq + '..' + (seq - 1) + '：' + batch.map((e) => e.type).join(' → '));

const log = [...events, ...batch];
const header = { version: 4, id: headerLine.id, createdAt: headerLine.createdAt, cwd: headerLine.cwd, isSeeded: false, delegationDepth: 0 };

const results = [];
const check = (name, fn) => {
  try { const r = fn(); results.push(['PASS', name, r ?? '']); }
  catch (e) { results.push(['FAIL', name, String(e?.message ?? e)]); }
};

check('foldSurface(真实日志 + 写入)', () => {
  const n = foldSurface(log).nodes;
  return 'nodes=' + n.length + '，尾部=' + JSON.stringify(n.slice(-4));
});
check('assertReleasedV4Relationships', () => {
  assertReleasedV4Relationships({ header, inheritedEventCount: 0, events: log }, KNOWN_SESSION_EVENT_TYPES);
  return '关系状态机通过（轮次/步骤/工具生命周期）';
});
check('restoreReleasedV4Artifact', () => {
  restoreReleasedV4Artifact({ header, inheritedEventCount: 0, events: log }, KNOWN_SESSION_EVENT_TYPES);
  return '完整 artifact 恢复通过';
});
check('Session.fromRestore + deriveMessages', () => {
  const s = Session.fromRestore(headerLine.id, log, header, 0, 'detached');
  const msgs = s.deriveMessages();
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  const txt = (lastAssistant?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const think = (lastAssistant?.content ?? []).filter((b) => b.type === 'reasoning').map((b) => b.text).join('');
  if (txt !== NEXT_TEXT) throw new Error('模型读到的正文不是新内容：' + JSON.stringify(txt.slice(0, 80)));
  if (think !== NEXT_REASON) throw new Error('模型读到的思考不是新内容');
  const oldVisible = msgs.some((m) => (m.content ?? []).some((b) => b.type === 'text' && b.text === oldText && oldText.length > 0));
  if (oldVisible) throw new Error('旧正文仍在模型视野里');
  return `模型读到的最后一条助手消息 = 新正文（长度 ${txt.length}）+ 新思考（长度 ${think.length}）；旧正文已不可见`;
});
check('同一 messageId 不再重复可见', () => {
  const nodesNow = foldNodes(log);
  const ids = nodesNow.map((s) => log[s]).filter((e) => e?.type === 'assistant/message').map((e) => e.data?.message?.id);
  const dup = ids.filter((id, k) => ids.indexOf(id) !== k);
  if (dup.length) throw new Error('仍有重复 id: ' + JSON.stringify([...new Set(dup)]));
  if (ids.includes(originalId)) throw new Error(`原 messageId ${originalId} 仍在可见面上（应已被遮蔽）`);
  return '可见助手消息 ' + ids.length + ' 条，id 全唯一（原 id 已不在其中）';
});

console.log('\n=== 校验结果 ===');
for (const [status, name, detail] of results) {
  console.log(`${status === 'PASS' ? '✅' : '❌'} ${name}\n     ${detail}`);
}

// 顺带：检查「写入之前的原日志」本身是否已通过关系校验器
console.log('\n=== 基线：原日志（不含本次追加）自身是否通过关系校验器 ===');
try {
  assertReleasedV4Relationships({ header, inheritedEventCount: 0, events }, KNOWN_SESSION_EVENT_TYPES);
  console.log('✅ 原日志自身通过（写入前无隐患）');
} catch (e) {
  console.log('❌ 原日志自身已被拒：' + String(e?.message ?? e));
  console.log('   （说明日志里已存在历史遗留问题，需要单独修复，与本次模板无关）');
}

process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
