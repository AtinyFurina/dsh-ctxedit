// 固定构造「改写 → /find 血统 → 还原」场景的回归测试。
//
// 行为约定（审计 §7-3）：
//   · 输入是任意真实会话日志；先复制到临时目录，绝不动原文件；
//   · 找不到带正文的可见助手消息 → SKIP + exit(2)；
//   · 任何断言失败 → exit(1)；
//   · 还原后正文必须非空且等于原稿；
//   · 用宿主自己的 Session.fromRestore 复核最终日志可加载。
//
// 运行方式（优先方式一：能读 app.asar 内的宿主源码）：
//   # 方式一（推荐）
//   $env:ELECTRON_RUN_AS_NODE="1"
//   & "C:\Users\AtinyFurina\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" tools\test-restore.mjs "<log>"
//   # 方式二（普通 node，需要 Temp 抽出物存在；否则会 SKIP + exit 2）
//   node tools\test-restore.mjs "<log>"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ASAR = 'C:/Users/AtinyFurina/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
let Session;
try {
  ({ Session } = await import(`file:///${ASAR}/dsh-session/lib/index.js`));
} catch (error) {
  console.log('SKIP: 宿主源码不可读（app.asar 需要 Electron-as-node；或先生成 Temp 抽出物）');
  console.log('  运行方式见脚本头「运行方式」；原始错误：' + String(error?.message ?? error).split('\n')[0]);
  process.exit(2);
}
const plugin = await import('file:///C:/Users/AtinyFurina/Desktop/dsh-ctxedit-project/lib/index.js');

const source = process.argv[2];
if (typeof source !== 'string' || source.length === 0) {
  console.log('用法: node tools/test-restore.mjs <session.v4.jsonl.zstd>');
  process.exit(2);
}
if (!fs.existsSync(source)) {
  console.log(`SKIP: 日志不存在：${source}`);
  process.exit(2);
}

const temp = path.join(os.tmpdir(), `ctxedit-test-restore-${Date.now()}.zstd`);
fs.copyFileSync(source, temp);

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = fs.readFileSync(temp);
const frames = [];
let offset = 0;
while ((offset = buf.indexOf(MAGIC, offset)) !== -1) { frames.push(offset); offset += 4 }
frames.push(buf.length);
let text = '';
for (let k = 0; k < frames.length - 1; k += 1) {
  try { text += zlib.zstdDecompressSync(buf.subarray(frames[k], frames[k + 1])).toString('utf8') } catch { /* 非帧边界 */ }
}
const lines = text.split('\n').filter(Boolean);
const headerLine = JSON.parse(lines[0]);
const events = lines.slice(1).map((line) => JSON.parse(line));

const session = {
  id: headerLine.id,
  snapshotEvents: () => events,
  append(type, data, opts) {
    const event = { type, seq: events.length, time: Date.now(), data, ...(opts ?? {}) };
    events.push(event);
    return event;
  },
};

const routes = {};
const ctx = {
  effect(fn) { fn() },
  get(name) {
    if (name === 'sessions') {
      return {
        get: (id) => (id === session.id ? session : undefined),
        list: () => [session],
        flush: async () => {},
      };
    }
    return undefined;
  },
  webServer: { register(route) { routes[route.path] = route; return () => {} } },
};
plugin.apply(ctx);

function response() {
  const out = { status: null, body: null };
  return {
    writeHead(status) { out.status = status },
    end(payload) { try { out.body = JSON.parse(payload) } catch { out.body = payload } },
    out,
  };
}
const getRequest = (url) => ({ method: 'GET', url, headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } });
const postRequest = (url, body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method: 'POST',
    url,
    headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield payload },
  };
};

const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
function fold(list) {
  const nodes = [];
  for (const event of list) {
    if (!SURFACE.has(event.type)) continue;
    const op = event.surfaceOp;
    if (op === 'append') { nodes.push(event.seq); continue }
    if (op && typeof op === 'object' && op.op === 'replace') {
      const first = nodes.indexOf(op.startSeq);
      const last = nodes.indexOf(op.endSeq);
      if (first >= 0 && last >= first) nodes.splice(first, last - first + 1, event.seq);
    }
  }
  return nodes;
}
const textOf = (content) => (Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('') : '');

let failed = 0;
function check(ok, name, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed += 1;
}

const bySeq = new Map(events.map((event) => [event.seq, event]));
const visible = fold(events).map((seq) => bySeq.get(seq));
const target = [...visible].reverse().find((event) => event?.type === 'assistant/message' && textOf(event.data?.message?.content).trim().length > 0);
if (target === undefined) {
  console.log('SKIP: 这条日志里没有带正文的可见助手消息');
  process.exit(2);
}
const originalSeq = target.seq;
const originalText = textOf(target.data.message.content);
const marker = `【test-restore】改写版 ${Date.now()}`;
console.log(`目标助手消息 seq=${originalSeq} turn=${target.data?.turn} 正文=${JSON.stringify(originalText.slice(0, 24))}`);

// 1) 改写
const rewriteResponse = response();
await routes['/api/dsh-ctxedit/apply'].handler(postRequest('/api/dsh-ctxedit/apply', {
  messageId: target.data.message.id,
  mode: 'rewrite',
  text: marker,
  reasoning: '',
}), rewriteResponse);
check(rewriteResponse.out.status === 200, '/apply rewrite 返回 200', String(rewriteResponse.out.status) + (rewriteResponse.out.body?.error ? ' ' + rewriteResponse.out.body.error : ''));

const rewritten = events.filter((event) => event.type === 'assistant/message').at(-1)?.data?.message;
check(rewritten !== undefined && rewritten.id !== target.data.message.id, '改写生成了新 messageId', rewritten?.id ?? 'undefined');

// 2) /find 血统
const findRewritten = response();
await routes['/api/dsh-ctxedit/find'].handler(getRequest(`/api/dsh-ctxedit/find?messageId=${encodeURIComponent(rewritten.id)}`), findRewritten);
const history = findRewritten.out.body?.history;
check(findRewritten.out.status === 200, '/find 返回 200', String(findRewritten.out.status));
check(history?.rewrites === 1, 'history.rewrites === 1', JSON.stringify(history));
check(history?.originSeq === originalSeq, `history.originSeq === 原稿 seq (${originalSeq})`, String(history?.originSeq));
check(findRewritten.out.body?.row?.text === marker, '改写版正文正确', JSON.stringify((findRewritten.out.body?.row?.text ?? '').slice(0, 24)));

// 3) 还原
const restoreResponse = response();
await routes['/api/dsh-ctxedit/apply'].handler(postRequest('/api/dsh-ctxedit/apply', {
  messageId: rewritten.id,
  mode: 'restore',
  text: '',
  reasoning: '',
}), restoreResponse);
check(restoreResponse.out.status === 200, '/apply restore 返回 200', String(restoreResponse.out.status) + (restoreResponse.out.body?.error ? ' ' + restoreResponse.out.body.error : ''));

const restored = events.filter((event) => event.type === 'assistant/message').at(-1)?.data?.message;
const restoredText = textOf(restored?.content);
check(restoredText.length > 0, '还原后的正文非空', JSON.stringify(restoredText.slice(0, 24)));
check(restoredText === originalText, '还原后的正文 === 原稿正文', `原稿 ${JSON.stringify(originalText.slice(0, 20))} vs 还原 ${JSON.stringify(restoredText.slice(0, 20))}`);

const findRestored = response();
await routes['/api/dsh-ctxedit/find'].handler(getRequest(`/api/dsh-ctxedit/find?messageId=${encodeURIComponent(restored.id)}`), findRestored);
check(findRestored.out.body?.history?.originSeq === originalSeq, '还原版的 originSeq 仍指向原稿', String(findRestored.out.body?.history?.originSeq));

// 4) 宿主恢复校验
const header = {
  version: 4,
  id: headerLine.id,
  createdAt: headerLine.createdAt,
  cwd: headerLine.cwd,
  parentSession: headerLine.parentSession,
  agentPreset: headerLine.agentPreset,
  isSeeded: headerLine.isSeeded ?? false,
  delegationDepth: headerLine.delegationDepth ?? 0,
};
try {
  const restoredSession = Session.fromRestore(headerLine.id, events, header, 0, 'detached');
  const messages = restoredSession.deriveMessages();
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const lastText = textOf(lastAssistant?.content);
  check(lastText === originalText, 'fromRestore 后最后一条 assistant === 原稿', JSON.stringify(lastText.slice(0, 24)));
} catch (error) {
  check(false, 'Session.fromRestore 能加载最终日志', error.message);
}

fs.rmSync(temp, { force: true });
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
