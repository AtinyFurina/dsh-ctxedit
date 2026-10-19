// 离线单元测试：用假 ctx 调插件注册的 /prompts 与 /rewind 处理器，
// 验证边界计算、fork 调用、标记行、resend 路径与空闲护栏。
// 不写盘、不连 GUI。
import fs from 'node:fs';
import zlib from 'node:zlib';

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
};

// 假 child：记录 append 的事件
function makeChild() {
  const childEvents = [];
  let seq = 0;
  return {
    id: 'session-test-child',
    append(type, data, opts) {
      const event = { type, seq: seq++, time: Date.now(), data, ...(opts ?? {}) };
      childEvents.push(event);
      return event;
    },
    snapshotEvents: () => childEvents,
    childEvents,
  };
}

const calls = { prompt: [], fork: [] };
const children = new Map();
const routes = {};
const fakeCtx = {
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get(name) {
    if (name === 'sessions') {
      return {
        get(id) {
          if (id === session.id || id === session.id.replace(/^session-/, '')) return session;
          return children.get(id);
        },
        list() { return [session, ...children.values()] },
        flush: async () => {},
      };
    }
    if (name === 'sessionController') {
      return {
        async fork(request) {
          calls.fork.push({ sourceId: request.sessionId, boundary: request.atSeq });
          const child = makeChild();
          children.set(child.id, child);
          return { sessionId: child.id };
        },
        prompt: async (request, source) => { calls.prompt.push({ request, source }); return { accepted: true } },
      };
    }
    return undefined;
  },
  webServer: {
    register(route) { routes[route.path] = route; return () => {} },
  },
};
plugin.apply(fakeCtx);
console.log('注册路由:', Object.keys(routes).join(', '));

function fakeResponse() {
  const out = { status: null, body: null };
  return {
    writeHead(status) { out.status = status },
    end(payload) { try { out.body = JSON.parse(payload) } catch { out.body = payload } },
    out,
  };
}
function fakeGet(path, query) {
  return {
    method: 'GET',
    url: path + (query ?? ''),
    headers: { host: '127.0.0.1:19387' },
    socket: { remoteAddress: '127.0.0.1' },
  };
}
function fakePost(path, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method: 'POST',
    url: path,
    headers: { host: '127.0.0.1:19387', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield payload },
  };
}

let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`); if (!ok) failures += 1 };

// 1) /prompts
{
  const res = fakeResponse();
  await routes['/api/dsh-ctxedit/prompts'].handler(fakeGet('/api/dsh-ctxedit/prompts', `?sessionId=${hl.id}`), res);
  const body = res.out.body;
  check(res.out.status === 200, '/prompts 返回 200', String(res.out.status));
  check(Array.isArray(body?.prompts) && body.prompts.length > 0, '列出提问', `${body?.prompts?.length} 条`);
  const first = body?.prompts?.[0];
  check(first && Number.isSafeInteger(first.promptSeq) && Number.isSafeInteger(first.boundarySeq), '每条带 promptSeq/boundarySeq', JSON.stringify({ turn: first?.turn, promptSeq: first?.promptSeq, boundarySeq: first?.boundarySeq }));
  check(first && first.boundarySeq < first.promptSeq, '边界在提问之前', '');
}

// 2) /rewind keep
const promptsRes = fakeResponse();
await routes['/api/dsh-ctxedit/prompts'].handler(fakeGet('/api/dsh-ctxedit/prompts', `?sessionId=${hl.id}`), promptsRes);
const prompt = promptsRes.out.body.prompts[0];
{
  const res = fakeResponse();
  await routes['/api/dsh-ctxedit/rewind'].handler(fakePost('/api/dsh-ctxedit/rewind', { sessionId: hl.id, promptSeq: prompt.promptSeq, mode: 'keep' }), res);
  const body = res.out.body;
  check(res.out.status === 200, '/rewind keep 返回 200', String(res.out.status));
  check(body?.childSessionId === 'session-test-child', '返回子会话 id', String(body?.childSessionId));
  check(body?.removedCount > 0 && body?.assistantCount >= 0, '统计移除数量', `removed=${body?.removedCount} assistant=${body?.assistantCount}`);
  check(Number.isSafeInteger(body?.markerSeq), '子会话写入标记行', String(body?.markerSeq));
  const forkCall = calls.fork.at(-1);
  check(forkCall?.boundary === prompt.boundarySeq, 'fork 使用计算的边界', JSON.stringify(forkCall));
  check(body?.resend?.attempted === false, 'keep 不发提示词');
}

// 3) /rewind resend
{
  const res = fakeResponse();
  await routes['/api/dsh-ctxedit/rewind'].handler(fakePost('/api/dsh-ctxedit/rewind', { sessionId: hl.id, promptSeq: prompt.promptSeq, mode: 'resend', text: '改过的提问' }), res);
  const body = res.out.body;
  check(res.out.status === 200, '/rewind resend 返回 200', String(res.out.status));
  const sent = calls.prompt.at(-1);
  check(sent?.request?.content?.[0]?.text === '改过的提问', 'resend 调用了 prompt 准入', JSON.stringify(sent?.request?.content));
  check(body?.resend?.ok === true, 'resend 报告成功');
}

// 4) 不存在的 promptSeq
{
  const res = fakeResponse();
  await routes['/api/dsh-ctxedit/rewind'].handler(fakePost('/api/dsh-ctxedit/rewind', { sessionId: hl.id, promptSeq: 999999, mode: 'keep' }), res);
  check(res.out.status === 400, '非法 promptSeq 返回 400', String(res.out.status));
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
