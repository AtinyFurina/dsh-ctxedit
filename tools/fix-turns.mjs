// 修复「重复/跳号的轮次号」，并用真实宿主关系校验器验证。
//
// 背景：dsh-ctxedit 早期版本用「最后一个 turn/end + 1」算合成轮次号，会与真实轮次撞号，
// 使日志出现 `…11, 12, 12, 13, 14…`；宿主关系校验器随后报
// `turn/start does not open the expected turn`（校验器要求每个 turn/start 恰等于 nextTurn，
// 而 nextTurn 只在 turn/end 后 +1 ⇒ 唯一合法序列是 1,2,3,…）。
//
// 做法：把每个「turn/start … turn/end」组按出现顺序赋连续号（1,2,3,…），
// 直接按 seq 索引改事件（不碰副本），然后拿校验器验证；验证不通过就一个字节都不写。
//
// ⚠ 只在 DSH 关闭时使用：运行中的会话把日志缓存在内存里，会与本脚本的写盘互相覆盖。
// 用法: node fix-turns.mjs <session.v4.jsonl.zstd> [--write]
import fs from 'node:fs';
import zlib from 'node:zlib';

const HARNESS = 'C:/Users/AtinyFurina/AppData/Local/Temp/asar-probe-ineffa/all/dsh/node_modules/@deepseek-ai';
const { assertReleasedV4Relationships } = await import(`file:///${HARNESS}/dsh-session-format-v3-to-v4/lib/index.js`);
const { KNOWN_SESSION_EVENT_TYPES } = await import(`file:///${HARNESS}/dsh-session/lib/types/known-event-types.js`);

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function readLog(path) {
  const buf = fs.readFileSync(path);
  const bounds = [];
  let i = 0;
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) { bounds.push(i); i += 4; }
  bounds.push(buf.length);
  let text = '';
  for (let k = 0; k < bounds.length - 1; k++) {
    try { text += zlib.zstdDecompressSync(buf.subarray(bounds[k], bounds[k + 1])).toString('utf8'); } catch {}
  }
  const lines = text.split('\n').filter(Boolean);
  return { headerLine: JSON.parse(lines[0]), events: lines.slice(1).map((l) => JSON.parse(l)) };
}

function check(headerLine, events) {
  const header = {
    version: 4, id: headerLine.id, createdAt: headerLine.createdAt, cwd: headerLine.cwd,
    isSeeded: false, delegationDepth: 0,
  };
  try {
    assertReleasedV4Relationships({ header, inheritedEventCount: 0, events }, KNOWN_SESSION_EVENT_TYPES);
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e?.message ?? e) }; }
}

/** 每个 turn/start 开一组，收集这一组里有 turn 号的事件 seq。 */
function collectGroups(events) {
  const groups = [];
  for (const e of events) {
    if (e.type === 'turn/start') groups.push([]);
    const g = groups[groups.length - 1];
    if (g && e.data !== null && typeof e.data === 'object' && typeof e.data.turn === 'number') g.push(e.seq);
  }
  return groups;
}

const [path, ...flags] = process.argv.slice(2);
if (!path) { console.error('用法: node fix-turns.mjs <session.v4.jsonl.zstd> [--write]'); process.exit(2) }
const write = flags.includes('--write');

const { headerLine, events } = readLog(path);
console.log('事件', events.length, '条；seq 与下标一致:', events.every((e, i) => e.seq === i));

const before = check(headerLine, events);
console.log('修复前关系校验：', before.ok ? '✅ 通过（无需修复）' : '❌ ' + before.message);
if (before.ok) process.exit(0);

const groups = collectGroups(events);
const originalNumbers = groups.map((g) => events[g[0]].data.turn);
console.log('轮次分组（原始号）：', originalNumbers.join(','));

let changed = 0;
for (let k = 0; k < groups.length; k++) {
  const target = k + 1;
  for (const seq of groups[k]) {
    if (events[seq].data.turn !== target) { events[seq].data.turn = target; changed += 1 }
  }
}
console.log('改写的 turn 字段数：', changed);
console.log('新轮次号：', groups.map((g) => events[g[0]].data.turn).join(','));

const after = check(headerLine, events);
console.log('修复后关系校验：', after.ok ? '✅ 通过' : '❌ ' + after.message);
if (!after.ok) { console.log('修复无效，未写入任何内容。'); process.exit(1) }

if (!write) { console.log('\n[dry-run] 修复方案有效；加 --write 才会写盘（需 DSH 已关闭）。'); process.exit(0) }

// 写回：header 单独一帧（持久化层要求首帧恰好是 header 一行），其余事件一帧。
const headerFrame = zlib.zstdCompressSync(Buffer.from(JSON.stringify(headerLine) + '\n', 'utf8'));
const bodyFrame = zlib.zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8'));
const backup = `${path}.bak-turnfix-${Date.now()}`;
fs.copyFileSync(path, backup);
fs.writeFileSync(path, Buffer.concat([headerFrame, bodyFrame]));
console.log(`\n已写回。备份：${backup}`);
console.log('注意：物理布局被合并为「header 帧 + 一帧事件」，与持久化层的分批写法不同，但读取路径按帧独立解码，语义等价。');
