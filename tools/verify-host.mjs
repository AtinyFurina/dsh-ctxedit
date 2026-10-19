// 升级后自检：读一条真实会话日志 → 打插件的两条只读接口 → 打印宿主/插件现场。
// 不改任何东西，不写盘。
//
// 用法（Electron 当 node 跑）：
//   $env:ELECTRON_RUN_AS_NODE="1"
//   & "...\DeepSeek Harness.exe" tools\verify-host.mjs <session.v4.jsonl.zstd> [baseUrl]
// baseUrl 默认 http://127.0.0.1:19387
import fs from 'node:fs';
import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const logPath = process.argv[2];
const base = (process.argv[3] ?? 'http://127.0.0.1:19387').replace(/\/$/, '');
if (!logPath) { console.error('用法: verify-host.mjs <session.v4.jsonl.zstd> [baseUrl]'); process.exit(2) }

function decodeLog(path) {
  const buf = fs.readFileSync(path);
  const bounds = [];
  let i = 0;
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) { bounds.push(i); i += 4 }
  bounds.push(buf.length);
  let text = '';
  for (let k = 0; k < bounds.length - 1; k++) {
    try { text += zlib.zstdDecompressSync(buf.subarray(bounds[k], bounds[k + 1])).toString('utf8') } catch { /* 撕裂帧跳过 */ }
  }
  const lines = text.split('\n').filter(Boolean);
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
  return { buf, header, events };
}

const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
function foldNodes(events) {
  const nodes = [];
  for (const e of events) {
    if (!SURFACE.has(e.type)) continue;
    const op = e.surfaceOp;
    if (op === 'append') { nodes.push(e.seq); continue }
    if (op && typeof op === 'object' && op.op === 'replace') {
      const a = nodes.indexOf(op.startSeq), c = nodes.indexOf(op.endSeq);
      if (a >= 0 && c >= a) nodes.splice(a, c - a + 1, e.seq);
    }
  }
  return nodes;
}

const results = [];
const report = (ok, name, detail = '') => { results.push({ ok, name, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`) };

const { buf, header, events } = decodeLog(logPath);
console.log(`\n会话 ${header.id}`);
console.log(`cwd  ${header.cwd ?? '(未记录)'}`);
console.log(`日志 ${buf.length} 字节 / ${events.length} 事件\n`);

// 1) 日志结构自检
report(events.every((e, i) => e.seq === i), 'seq 与下标一致（日志未被撕裂）');
const starts = events.filter((e) => e.type === 'turn/start').map((e) => e.data?.turn);
const contiguous = starts.join(',') === starts.map((_, k) => k + 1).join(',');
report(contiguous, '轮次号严格连续、无重复', starts.join(','));

// 2) 定位最后一条可见助手消息（优先取有正文的，便于肉眼核对）
const nodes = foldNodes(events);
const bySeq = new Map(events.map((e) => [e.seq, e]));
const assistantNodes = [...nodes].reverse().map((s) => bySeq.get(s)).filter((e) => e?.type === 'assistant/message');
const textOf = (e) => (e?.data?.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
const lastAssistant = assistantNodes.find((e) => textOf(e).trim().length > 0) ?? assistantNodes[0];
if (!lastAssistant) {
  console.log('\n没有可见的助手消息，跳过接口检查。');
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
const messageId = lastAssistant.data?.message?.id;
const text = textOf(lastAssistant);
console.log(`\n目标：seq=${lastAssistant.seq} id=${messageId} 正文=${JSON.stringify(text.slice(0, 50))}\n`);

async function getJson(path) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

// 3) /find
try {
  const found = await getJson(`/api/dsh-ctxedit/find?messageId=${encodeURIComponent(messageId)}`);
  report(found.ok === true, '/find 路由可用（定位到活会话）', `session=${found.sessionShort} seq=${found.seq} openTurn=${found.openTurn}`);
  report(found.row?.messageId === messageId, '/find 返回的节点与目标一致');
} catch (error) {
  report(false, '/find 路由', String(error.message ?? error));
}

// 4) /diagnose（判定计数器同步是否仍可用）
try {
  const d = await getJson(`/api/dsh-ctxedit/diagnose?messageId=${encodeURIComponent(messageId)}`);
  report(d.agent != null, '/diagnose 能看到活 agent');
  report(d.agent?.hasPhase === true && d.agent?.hasLoopCtx === true, 'phase / loopCtx 字段仍可访问（同步方案的结构前提）');
  report(typeof d.agent?.projectedLastTurn === 'number', '投影能给出权威 lastTurn', `log=${d.maxTurnInLog} projected=${d.agent?.projectedLastTurn}`);
  if (d.agent?.phaseKind === 'idle') {
    report(d.agent?.phaseLastTurn === d.agent?.projectedLastTurn, '空闲时计数器与投影一致（不需要再同步）', `phase=${d.agent?.phaseLastTurn} projected=${d.agent?.projectedLastTurn}`);
    report(d.agent?.canSync === true, 'canSync=true（改写后能自动同步宿主计数器）');
  } else {
    // 运行中 canSync 按设计为 false（护栏），这不是失败；用户需在空闲时重跑本工具
    console.log(`ℹ 当前 agent 状态是 "${d.agent?.phaseKind}"（在跑），canSync 预期为 false —— 这是护栏，不是故障。`);
    console.log('  等会话空闲（本轮回复结束）后再跑一次本工具，确认空闲态 canSync=true。');
  }
} catch (error) {
  report(false, '/diagnose 路由', String(error.message ?? error));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? '全部通过' : `${failed.length} 项未通过`}（共 ${results.length} 项）`);
process.exit(failed.length === 0 ? 0 : 1);
