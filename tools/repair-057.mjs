// 修复 057 会话里那条非法替换事件：把 sourceEventSeqs 从 [[63,65],67,69,75] 改成扁平的 surface 节点列表。
// 先备份原文件，再逐帧重写；最后用安装版 Session.fromRestore 验证。
import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = fs.readFileSync(file);
const b = []; let i = 0;
while ((i = buf.indexOf(M, i)) !== -1) { b.push(i); i += 4 }
b.push(buf.length);
let text = '';
for (let k = 0; k < b.length - 1; k++) {
  try { text += zlib.zstdDecompressSync(buf.subarray(b[k], b[k + 1])).toString('utf8') } catch {}
}
const lines = text.split('\n').filter(Boolean);
const headerLine = lines[0];
const events = lines.slice(1).map((l) => JSON.parse(l));

// 折叠出事件 78 之前（0..77）的 surface
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
const bad = events.find((e) => e.seq === 78);
if (!bad) { console.log('没有 seq 78'); process.exit(1) }
const before = events.filter((e) => e.seq < 78);
const nodes = fold(before);
const startSeq = bad.surfaceOp.startSeq, endSeq = bad.surfaceOp.endSeq;
const shadowed = nodes.filter((s) => s >= startSeq && s <= endSeq);
console.log('原 sourceEventSeqs:', JSON.stringify(bad.sourceEventSeqs));
console.log('区间', startSeq, '..', endSeq, '的 surface 节点:', JSON.stringify(shadowed));
if (shadowed.length === 0) { console.log('空区间，放弃'); process.exit(1) }
bad.sourceEventSeqs = shadowed;

// 备份 + 重写：header 单独一帧，其余事件一帧
const backup = `${file}.bak-${Date.now()}`;
fs.copyFileSync(file, backup);
const out = [zlib.zstdCompressSync(Buffer.from(headerLine + '\n', 'utf8'))];
out.push(zlib.zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')));
fs.writeFileSync(file, Buffer.concat(out));
console.log('已修复并写入；备份:', backup);

// 验证：安装版 fromRestore + deriveMessages
const ASAR = 'C:/Users/AtinyFurina/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
const { Session } = await import(`file:///${ASAR}/dsh-session/lib/index.js`);
const hl = JSON.parse(headerLine);
const header = { version: 4, id: hl.id, createdAt: hl.createdAt, cwd: hl.cwd, isSeeded: hl.isSeeded ?? false, delegationDepth: hl.delegationDepth ?? 0 };
try {
  const s = Session.fromRestore(hl.id, events, header, 0, 'detached');
  const msgs = s.deriveMessages();
  const all = msgs.map((m) => (m.content ?? []).map((c) => c.text ?? '').join('')).join('\n');
  console.log('✅ fromRestore 通过；模型消息', msgs.length, '条');
  console.log('模型视野里还有 "1111" 吗:', all.includes('1111'));
  console.log('模型视野里还有 "？？？？" 吗:', all.includes('？？？？'));
  for (const m of msgs.slice(-4)) {
    const t = (m.content ?? []).map((c) => c.type === 'text' ? c.text : `<${c.type}>`).join('');
    console.log(' ', m.role, JSON.stringify(t.slice(0, 50)));
  }
} catch (error) {
  console.log('❌ fromRestore 仍失败:', error.message);
  process.exit(1);
}
