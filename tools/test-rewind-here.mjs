// 离线测试 /rewind-here 与 /zones：假 ctx + 真实会话日志。
// 检查：定位用户消息、区间遮蔽、标记行、区域记录、非法/护栏。
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxedit-home-'));
const plugin = await import('file:///C:/Users/AtinyFurina/Desktop/dsh-ctxedit-project/lib/index.js');

const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = fs.readFileSync(process.argv[2]);
const b = []; let i = 0;
while ((i = buf.indexOf(M, i)) !== -1) { b.push(i); i += 4 }
b.push(buf.length);
let t = '';
for (let k = 0; k < b.length - 1; k++) { try { t += zlib.zstdDecompressSync(buf.subarray(b[k], b[k + 1])).toString('utf8') } catch {} }
const lines = t.split('\n').filter(Boolean);
const hl = JSON.parse(lines[0]);
const events = lines.slice(1).map((l) => JSON.parse(l));
const session = {
  id: hl.id,
  snapshotEvents: () => events,
  append(type, data, opts) {
    const event = { type, seq: events.length, time: Date.now(), data, ...(opts ?? {}) };
    events.push(event);
    return event;
  },
};

const routes = {};
const fakeCtx = {
  effect(fn) { fn() },
  get(name) {
    if (name === 'sessions') return { get: (id) => (id === session.id ? session : undefined), list: () => [session], flush: async () => {} };
    return undefined;
  },
  webServer: { register(route) { routes[route.path] = route; return () => {} } },
};
plugin.apply(fakeCtx);

function res() { const o = { status: null, body: null }; return { writeHead(s) { o.status = s }, end(p) { try { o.body = JSON.parse(p) } catch { o.body = p } }, o } }
const getReq = (url) => ({ method: 'GET', url, headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } });
const postReq = (url, body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return { method: 'POST', url, headers: { host: '127.0.0.1:1', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield payload } };
};

let fail = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`); if (!ok) fail += 1 };

// 找一条中间位置的用户消息（不在最尾）
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
const nodes = fold(events);
const bySeq = new Map(events.map((e) => [e.seq, e]));
const users = nodes.map((s) => bySeq.get(s)).filter((e) => e?.type === 'user/message' && typeof e.data?.id === 'string');
const target = users[Math.max(0, users.length - 3)];
if (!target) { console.log('没有用户消息'); process.exit(0) }
console.log(`目标用户消息 seq=${target.seq} id=${target.data.id}`);

{
  const r = res();
  await routes['/api/dsh-ctxedit/rewind-here'].handler(postReq('/api/dsh-ctxedit/rewind-here', { messageId: target.data.id }), r);
  check(r.o.status === 200, 'rewind-here 200', String(r.o.status) + (r.o.body?.error ? ' ' + r.o.body.error : ''));
  check(r.o.body?.removedCount > 0, '移除了内容', `removed=${r.o.body?.removedCount} assistant=${r.o.body?.assistantCount}`);
  check(typeof r.o.body?.zone?.anchorId === 'string' && typeof r.o.body?.zone?.markerId === 'string', '区域含锚点与标记 id', JSON.stringify(r.o.body?.zone));
  const carrier = events.find((e) => e.surfaceOp && typeof e.surfaceOp === 'object' && e.surfaceOp.startSeq !== undefined && e.seq > target.seq);
  check(carrier !== undefined, '追加了区间遮蔽事件', carrier ? `seq=${carrier.seq} 遮蔽 ${carrier.surfaceOp.startSeq}..${carrier.surfaceOp.endSeq}` : '');
  check(Array.isArray(carrier?.sourceEventSeqs) && carrier.sourceEventSeqs.every((s) => Number.isSafeInteger(s)), 'sourceEventSeqs 是扁平整数数组', JSON.stringify(carrier?.sourceEventSeqs));

  // 用安装版校验器重放整条日志：必须能恢复，且被遮蔽内容不在模型视野。
  const ASAR = 'C:/Users/AtinyFurina/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
  const { Session } = await import(`file:///${ASAR}/dsh-session/lib/index.js`);
  const header = { version: 4, id: hl.id, createdAt: hl.createdAt, cwd: hl.cwd, isSeeded: false, delegationDepth: 0 };
  try {
    const restored = Session.fromRestore(hl.id, events, header, 0, 'detached');
    const msgs = restored.deriveMessages();
    const all = msgs.map((m) => (m.content ?? []).map((c) => c.text ?? '').join('')).join('\n');
    const shadowedTexts = events
      .filter((e) => e.seq > target.seq && e.type === 'assistant/message')
      .map((e) => (e.data?.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''))
      .filter((t) => t.length > 12);
    const leaked = shadowedTexts.filter((t) => all.includes(t.slice(0, 12)));
    check(leaked.length === 0, '被遮蔽的回复不在模型视野', leaked.length === 0 ? `模型消息 ${msgs.length} 条` : `泄漏 ${leaked.length} 条`);
  } catch (error) {
    check(false, 'fromRestore 能重放整条日志', error.message);
  }
}

{
  const r = res();
  await routes['/api/dsh-ctxedit/zones'].handler(getReq(`/api/dsh-ctxedit/zones?sessionId=${hl.id}`), r);
  check(r.o.status === 200 && Array.isArray(r.o.body?.zones) && r.o.body.zones.length === 1, '/zones 返回 1 条区域', JSON.stringify(r.o.body?.zones?.length));
}

{
  const r = res();
  await routes['/api/dsh-ctxedit/rewind-here'].handler(postReq('/api/dsh-ctxedit/rewind-here', { messageId: 'nope' }), r);
  check(r.o.status === 404, '未知 messageId → 404', String(r.o.status));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
