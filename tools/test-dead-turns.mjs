// 离线验证「改写后旧轮次被判定为死轮次」：调 /apply rewrite，再查 /zones 的 deadTurns。
import fs from 'node:fs';
import zlib from 'node:zlib';

const plugin = await import(new URL('../lib/index.js', import.meta.url).href);

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

// 找一条助手消息
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
const bySeq = new Map(events.map((e) => [e.seq, e]));
const target = [...fold(events)].reverse().map((s) => bySeq.get(s)).find((e) => e?.type === 'assistant/message');
if (!target) { console.log('SKIP: 没有助手消息'); process.exit(2) }
console.log(`目标助手消息 seq=${target.seq} turn=${target.data.turn}`);

{
  const r = res();
  await routes['/api/dsh-ctxedit/apply'].handler(postReq('/api/dsh-ctxedit/apply', {
    messageId: target.data.message.id, mode: 'rewrite', text: '这是改写后的正文', reasoning: '',
  }), r);
  check(r.o.status === 200, '/apply rewrite 200', String(r.o.status) + (r.o.body?.error ? ' ' + r.o.body.error : ''));
  check(Array.isArray(r.o.body?.writtenSeqs) && r.o.body.writtenSeqs.length > 0, '写入了新事件', JSON.stringify(r.o.body?.writtenSeqs));
}

{
  const r = res();
  await routes['/api/dsh-ctxedit/zones'].handler(getReq(`/api/dsh-ctxedit/zones?sessionId=${hl.id}`), r);
  const dead = r.o.body?.deadTurns ?? [];
  check(dead.includes(target.data.turn), '旧轮次被判定为死轮次', JSON.stringify(dead));
  const newTurn = Math.max(...events.filter((e) => e.type === 'turn/start').map((e) => e.data.turn));
  check(!dead.includes(newTurn), '新合成轮次不在死轮次里', `newTurn=${newTurn}`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);


