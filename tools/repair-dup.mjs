// 修复「同一条 messageId 有两个可见版本」的历史遗留问题。
//
// 背景：dsh-ctxedit 早期版本改写助手消息时复用了原消息的 id，
// 导致界面按 id 认消息，把改写后的版本当成旧版本重新生成了一遍（用户新内容消失）。
// 新版本已改成生成新的 id；本脚本用于清理已经写进日志的重复。
//
// 做法：对每个重复 id，只保留**最新的**那个节点，把其余可见节点用无回合 user 载体遮蔽掉
//（结构合法的遮蔽方式，与插件写入路径一致）。默认 dry-run，只报告不写。
//
// 用法: node repair-dup.mjs <session.v4.jsonl.zstd> [--write]
import fs from 'node:fs'
import zlib from 'node:zlib'
import { randomUUID } from 'node:crypto'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

function readFrames(buf) {
  const bounds = []
  let i = 0
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) { bounds.push(i); i += 4 }
  bounds.push(buf.length)
  return bounds.slice(0, -1).map((s, k) => buf.subarray(s, bounds[k + 1]))
}

function foldNodes(events) {
  const nodes = []
  for (const e of events) {
    if (!SURFACE.has(e.type)) continue
    const op = e.surfaceOp
    if (op === 'append') { nodes.push(e.seq); continue }
    if (op && typeof op === 'object' && op.op === 'replace') {
      const a = nodes.indexOf(op.startSeq)
      const b = nodes.indexOf(op.endSeq)
      if (a >= 0 && b >= a) nodes.splice(a, b - a + 1, e.seq)
    }
  }
  return nodes
}

const [file, ...flags] = process.argv.slice(2)
const write = flags.includes('--write')
if (!file) { console.error('用法: node repair-dup.mjs <log> [--write]'); process.exit(2) }

const buf = fs.readFileSync(file)
const frameBufs = readFrames(buf)
const events = frameBufs.flatMap((b) => zlib.zstdDecompressSync(b).toString('utf8').split('\n').filter(Boolean))
  .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

const nodes = foldNodes(events)
const bySeq = new Map(events.map((e) => [e.seq, e]))
const visibleAssistant = nodes.map((s) => bySeq.get(s)).filter((e) => e?.type === 'assistant/message')

const groups = new Map()
for (const e of visibleAssistant) {
  const id = e.data?.message?.id
  if (typeof id !== 'string') continue
  if (!groups.has(id)) groups.set(id, [])
  groups.get(id).push(e)
}

const dupes = [...groups.entries()].filter(([, list]) => list.length > 1)
console.log(`会话日志：${file}`)
console.log(`事件 ${events.length} 条，可见节点 ${nodes.length} 个，其中助手消息 ${visibleAssistant.length} 条`)
console.log(`重复 id 组：${dupes.length}`)

let seq = Math.max(...events.map((e) => e.seq ?? -1))
const batch = []
for (const [id, list] of dupes) {
  const sorted = [...list].sort((a, b) => a.seq - b.seq)
  const keep = sorted[sorted.length - 1]
  const drop = sorted.slice(0, -1)
  console.log(`\nid=${id}`)
  for (const e of sorted) {
    const txt = (e.data?.message?.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('')
    console.log(`   seq=${e.seq} ${e.seq === keep.seq ? '保留' : '遮蔽'} t${e.data?.turn}/s${e.data?.step} 长度${txt.length} 结尾=${JSON.stringify(txt.slice(-36))}`)
  }
  for (const e of drop) {
    batch.push(JSON.stringify({
      type: 'user/message',
      seq: ++seq,
      time: Date.now(),
      surfaceOp: { op: 'replace', startSeq: e.seq, endSeq: e.seq },
      sourceEventSeqs: [e.seq],
      data: { id: randomUUID(), role: 'user', content: [], source: { kind: 'plugin:ctxedit-repair' } },
    }))
  }
}

if (batch.length === 0) { console.log('\n没有需要修复的重复。'); process.exit(0) }
if (!write) { console.log(`\n[dry-run] 将要追加 ${batch.length} 条遮蔽事件。加 --write 才真正写入。`); process.exit(0) }

const backup = `${file}.bak-dupfix-${Date.now()}`
fs.copyFileSync(file, backup)
const frame = zlib.zstdCompressSync(Buffer.from(batch.join('\n') + '\n', 'utf8'))
fs.writeFileSync(file, Buffer.concat([buf, frame]))
console.log(`\n已写入 ${batch.length} 条遮蔽事件。备份：${backup}`)
