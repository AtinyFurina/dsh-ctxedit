/**
 * dsh-ctxedit — host half.
 *
 * 作用：把「模型下一轮读到什么」变成可在 GUI 里编辑的东西。
 * 一条助手回复可以被：
 *   - 改写：换成新的回复正文 + 新的思考过程（角色仍是 assistant）
 *   - 抹掉：从模型可见历史里整个消失
 *
 * 原理（全部经实测确认）：
 *   · 会话日志 append-only，模型可见那一层叫 surface；追加一条带
 *     `surfaceOp: { op:'replace', startSeq, endSeq }` + `sourceEventSeqs` 的事件即可遮蔽旧节点。
 *   · 只有 `user/message` 能当替换载体（assistant/message 携带 sourceEventSeqs 会被宿主拒绝）。
 *   · 要写一条「模型会读到、角色仍是 assistant」的新消息，必须追加一个结构合法的合成轮次
 *     （turn/start → step/start → assistant/message → step/end → turn/end），
 *     turn 号必须等于日志里下一个期望轮次，且助手消息要带结算字段（usage + stream）。
 *
 * 定位方式：浏览器只给 messageId，宿主在所有活会话里找它属于哪一条，因此
 * 客户端不需要知道 sessionId 怎么取。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Stable cordis plugin name. */
export const name = 'ctxedit'

/** 需要的宿主服务。 */
export const inject = ['webServer']

/** 插件用途说明，注入每轮提示，让模型知道自己能改自己的历史。 */
export const CTXEDIT_GUIDANCE = '本机已安装 dsh-ctxedit 插件（上下文改写）：助手消息的动作行有「改上下文」按钮，可改写该条回复的正文与思考过程，或把它从模型可见历史中抹掉。改动只影响模型下一轮读到的内容，原始日志不被修改。用户说「改上下文 / 改我上一条回复 / 抹掉你说过的某句」时即指本插件。'

const PLUGIN_ID = 'ctxedit'
const API_BASE = '/api/dsh-ctxedit'
const MAX_BODY_BYTES = 256 * 1024
const MAX_TEXT_CHARS = 120_000

const SURFACE_TYPES = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

// ── HTTP 基础 ─────────────────────────────────────────────────────────────

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  response.end(JSON.stringify(body))
}

/** 只允许本机回环 + 同源：这些路由会改会话内容。 */
function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch { return undefined }
}

// ── 会话访问 ──────────────────────────────────────────────────────────────

function findLiveSession(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (!sessions || typeof sessions.get !== 'function') return undefined
  const variants = [sessionId]
  variants.push(sessionId.startsWith('session-') ? sessionId.slice(8) : `session-${sessionId}`)
  for (const variant of variants) {
    const found = sessions.get(variant)
    if (found) return found
  }
  return undefined
}

async function resolveSession(ctx, sessionId) {
  const live = findLiveSession(ctx, sessionId)
  if (live) return live
  const controller = ctx.get('sessionController')
  if (controller && typeof controller.resolveAgent === 'function') {
    try {
      const result = await controller.resolveAgent(sessionId)
      if (result?.agent?.session) return result.agent.session
    } catch { /* 落到 undefined */ }
  }
  return undefined
}

/** 所有活会话（内存里已挂载的）。 */
function liveSessions(ctx) {
  const sessions = ctx.get('sessions')
  if (!sessions || typeof sessions.list !== 'function') return []
  try { return sessions.list() ?? [] } catch { return [] }
}

// ── 回退区域（界面过滤用） ─────────────────────────────────────────────────
//
// 「就地回退」在模型侧只是遮蔽，界面不会自己删行（平台按追加渲染）。
// 所以每次回退记一条区域：锚点消息 id（保留的那条）+ 标记消息 id（回退行）。
// 客户端拿到区域后，把这两行之间的 DOM 行隐藏——刷新后重新应用，效果持久。

function zoneFilePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-ctxedit', 'zones.json')
}

function readZones() {
  try {
    const parsed = JSON.parse(readFileSync(zoneFilePath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

function writeZones(zones) {
  try {
    mkdirSync(join(zoneFilePath(), '..'), { recursive: true })
    writeFileSync(zoneFilePath(), JSON.stringify(zones, null, 0))
  } catch { /* 记录失败不影响回退本身 */ }
}

function zonesOf(sessionId) {
  const zones = readZones()
  const list = zones[sessionId]
  return Array.isArray(list) ? list : []
}

function appendZone(sessionId, zone) {
  const zones = readZones()
  const list = Array.isArray(zones[sessionId]) ? zones[sessionId] : []
  list.push(zone)
  zones[sessionId] = list
  writeZones(zones)
}

/**
 * 被本插件遮蔽、且不在模型可见面上的 assistant 消息所在轮次。
 *
 * 改写/抹除会「追加一条新的 assistant 消息 + 遮蔽旧的」，客户端不折叠遮蔽，
 * 旧行就会和新行同时显示（看起来像复制了一份）。客户端拿到这些轮次后，
 * 把该轮次里**非用户**的行（思考块/工具块/回复/轮尾）隐藏，只留用户提问。
 */
function deadAssistantTurns(session, events) {
  try {
    const surface = new Set(surfaceNodesOf(session, events))
    const carriers = (events ?? []).filter((event) => event.type === 'user/message'
      && typeof event.data?.source?.kind === 'string'
      && event.data.source.kind.startsWith(`plugin:${PLUGIN_ID}`)
      && Array.isArray(event.sourceEventSeqs))
    if (carriers.length === 0) return []
    const shadowed = new Set()
    for (const carrier of carriers) {
      for (const seq of carrier.sourceEventSeqs) if (!surface.has(seq)) shadowed.add(seq)
    }
    const turns = new Set()
    for (const event of events ?? []) {
      if (event.type === 'assistant/message' && shadowed.has(event.seq) && Number.isSafeInteger(event.data?.turn)) {
        turns.add(event.data.turn)
      }
    }
    return [...turns].sort((a, b) => a - b)
  } catch { return [] }
}

function eventsOf(session) {
  if (session && typeof session.snapshotEvents === 'function') {
    try {
      const events = session.snapshotEvents()
      if (Array.isArray(events)) return events
    } catch { /* 落到 undefined */ }
  }
  return undefined
}

/**
 * 模型可见节点顺序。
 * **始终自己折叠**（不用活会话的 surface）：活会话可能用区间压缩表示，
 * 直接把它的 nodes 写进 `sourceEventSeqs` 会变成 `[[63,65],67,...]`，
 * 校验器要求扁平、无重复、覆盖区间内全部被遮蔽节点，否则整条日志在重载时失效。
 */
function surfaceNodesOf(session, events) {
  const nodes = []
  for (const event of events ?? []) {
    if (!SURFACE_TYPES.has(event.type)) continue
    const op = event.surfaceOp
    if (op === 'append') { nodes.push(event.seq); continue }
    if (op && typeof op === 'object' && op.op === 'replace') {
      const startIdx = nodes.indexOf(op.startSeq)
      const endIdx = nodes.indexOf(op.endSeq)
      if (startIdx < 0 || endIdx < startIdx) continue
      nodes.splice(startIdx, endIdx - startIdx + 1, event.seq)
    }
  }
  return nodes
}

/** 把可能是区间压缩形式的 seq 列表拍平（防御性，避免再次写出嵌套数组）。 */
function flattenSeqs(list) {
  const out = []
  for (const item of list ?? []) {
    if (Array.isArray(item) && item.length === 2 && Number.isSafeInteger(item[0]) && Number.isSafeInteger(item[1])) {
      for (let seq = item[0]; seq <= item[1]; seq += 1) out.push(seq)
    } else if (Number.isSafeInteger(item)) out.push(item)
  }
  return out
}

function messageOf(event) {
  if (!event) return undefined
  if (event.type === 'user/message') return event.data
  return event.data?.message
}

function joinBlocks(message, type) {
  const parts = message?.content
  if (!Array.isArray(parts)) return ''
  return parts.filter((p) => p?.type === type).map((p) => p.text ?? '').join('')
}

function nodeRows(session, events) {
  const bySeq = new Map((events ?? []).map((e) => [e.seq, e]))
  const rows = []
  for (const seq of surfaceNodesOf(session, events)) {
    const event = bySeq.get(seq)
    if (!event) continue
    const message = messageOf(event)
    rows.push({
      seq,
      type: event.type,
      role: message?.role ?? (event.type === 'tool/result' ? 'tool' : undefined),
      messageId: event.type === 'assistant/message' ? (message?.id ?? event.data?.messageId) : (event.data?.id ?? message?.id),
      text: joinBlocks(message, 'text'),
      reasoning: joinBlocks(message, 'reasoning'),
      turn: event.data?.turn ?? null,
      step: event.data?.step ?? null,
      toolCalls: Array.isArray(message?.content) ? message.content.filter((p) => p?.type === 'tool-call').length : 0,
      isReplacement: event.surfaceOp !== 'append' && typeof event.surfaceOp === 'object',
    })
  }
  return rows
}

/**
 * 日志里下一个可用的轮次号。
 *
 * **必须用「已见过的最大轮次号 + 1」，而不是「最后一个 turn/end + 1」。**
 * 宿主关系校验器（`assertReleasedV4Relationships`）内部维护 `nextTurn`，
 * 只在 `turn/end` 时递增、且要求 `turn/start` 恰好等于它；
 * 客户端轮次投影里的 `lastTurn` 也取自「最大的 turn 号」。
 * 用「最后一个 turn/end + 1」会算小一号（日志里若已存在被中断/合成的轮次就会撞号），
 * 实测撞过：连续两次改写会让日志出现 `…11, 12, 12, 13…` 这种重复轮次，
 * 之后校验器报 `turn/start does not open the expected turn`。
 */
function nextTurnOf(events) {
  let max = 0
  for (const event of events ?? []) {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      const turn = event.data?.turn
      if (typeof turn === 'number' && turn > max) max = turn
    }
  }
  return max + 1
}

/** 尾部是否有开着的 turn/step（此时不允许写合成轮次）。 */
function openTail(events) {
  let openTurn = null
  let openStep = null
  for (const event of events ?? []) {
    if (event.type === 'turn/start') { openTurn = event.data?.turn ?? null; openStep = null }
    else if (event.type === 'turn/end') { openTurn = null; openStep = null }
    else if (event.type === 'step/start') openStep = event.data?.step ?? null
    else if (event.type === 'step/end') openStep = null
  }
  return { openTurn, openStep }
}

/**
 * 追溯某个节点的「被遮蔽血统」，供「还原原样」用。
 *
 * 表面上一条被改写过的回复 = 一条替换事件遮蔽了更早的节点。还原 = 把血统里
 * 最早的原始节点重新放回 surface。层数一般只有 1~3 层，直接线性回溯即可。
 *
 * @returns {{ originSeq: number|undefined, rewrites: number, chain: number[] }}
 *   chain 是「从原稿到当前」的节点 seq 列表（含当前节点）。
 */
function shadowLineage(events, nodeSeq) {
  const bySeq = new Map((events ?? []).map((e) => [e.seq, e]))
  // 载体 = 带区间替换的 user/message（assistant 不能携带 sourceEventSeqs）。
  // 关键：从「当前节点」出发，反查 sourceEventSeqs 里包含它的那条载体，
  // 再顺着载体的 surfaceOp.startSeq 往上走——而不是看当前节点自己的 surfaceOp
  // （合成助手消息是 'append'，旧实现第一跳就断了）。
  const carriers = (events ?? []).filter((e) => e.type === 'user/message'
    && e.surfaceOp && typeof e.surfaceOp === 'object' && e.surfaceOp.op === 'replace'
    && Array.isArray(e.sourceEventSeqs))
  const replacedByOf = (carrier) => carrier.data?.source?.replacedBy
  const chain = [nodeSeq]
  let current = nodeSeq
  for (let hops = 0; hops < 16; hops += 1) {
    // 首选语义指针：谁记录了「我替代了 current」。改写/还原写的就是这个。
    const byReplaced = carriers.find((c) => replacedByOf(c) === current)
    // 兜底：旧日志里没有 replacedBy，就找区间里包含 current 的载体。
    const byShadow = carriers
      .filter((c) => c.seq < current && c.sourceEventSeqs.includes(current))
      .sort((a, b) => b.seq - a.seq)[0]
    const carrier = byReplaced ?? byShadow
    if (carrier === undefined) break
    const start = carrier.surfaceOp.startSeq
    if (!Number.isSafeInteger(start) || start === current) break
    chain.push(start)
    current = start
  }
  // 「原稿」取链上最早的 assistant 消息；链里只有区间起点时退回链尾，
  // 由调用方（restore）再校验它确实是带内容的 assistant 消息。
  const original = [...chain].reverse().find((seq) => bySeq.get(seq)?.type === 'assistant/message')
  const originSeq = original ?? chain[chain.length - 1]
  return { originSeq, rewrites: chain.length - 1, chain }
}

async function flushSession(ctx, session) {
  const sessions = ctx.get('sessions')
  if (sessions && typeof sessions.flush === 'function') {
    try {
      await Promise.race([sessions.flush(session), new Promise((r) => setTimeout(r, 5000))])
      return { flushed: true }
    } catch (error) {
      return { flushed: false, flushError: String(error?.message ?? error) }
    }
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence && typeof persistence.flush === 'function') {
    try {
      await Promise.race([persistence.flush(), new Promise((r) => setTimeout(r, 5000))])
      return { flushed: true }
    } catch (error) {
      return { flushed: false, flushError: String(error?.message ?? error) }
    }
  }
  return { flushed: false, flushError: 'no flush service' }
}

// ── 目标定位 ──────────────────────────────────────────────────────────────

/**
 * 列出「每一轮真正的人类提问」：每个 `turn/start` 之后、下一个 `turn/start` 之前，
 * 第一条仍在模型可见面上的 `user/message`（append）。注入上下文/steering 不算。
 *
 * 每条附带 `boundarySeq` —— 该轮 `turn/start` 之前最后一个事件的 seq。
 * 把 fork 的边界定在这里，得到的子会话正好停在「这次提问之前」，
 * 界面上的后续轮次因此真正消失（不是遮蔽，而是根本不存在）。
 *
 * @param session - 活会话
 * @param events - 全量事件
 * @returns {Array<{turn:number|null, promptSeq:number, text:string, boundarySeq:number}>}
 */
function promptsOf(session, events) {
  const nodes = surfaceNodesOf(session, events)
  const nodeSet = new Set(nodes)
  const bySeq = new Map((events ?? []).map((e) => [e.seq, e]))
  const starts = (events ?? []).filter((e) => e.type === 'turn/start')
  const out = []
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]
    const nextStart = starts[i + 1]?.seq ?? Number.POSITIVE_INFINITY
    const promptSeq = nodes.find((seq) => seq > start.seq && seq < nextStart
      && nodeSet.has(seq) && bySeq.get(seq)?.type === 'user/message')
    if (promptSeq === undefined) continue
    const event = bySeq.get(promptSeq)
    const content = event?.data?.content
    const text = Array.isArray(content)
      ? content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('')
      : ''
    if (text.trim().length === 0) continue
    const previous = (events ?? []).filter((e) => e.seq < start.seq).at(-1)
    out.push({
      turn: start.data?.turn ?? null,
      promptSeq,
      text,
      boundarySeq: previous === undefined ? 0 : previous.seq,
    })
  }
  return out
}

/**
 * 找出某个助手节点所在轮的「提问」节点。
 *
 * 规则：从该 seq 往前找最近的 `turn/start`，再取它之后第一条 `user/message`（append）。
 * 这条就是该轮的提示词；后面的 user/message 属于 steering / 注入上下文，不算。
 * 若这条提问已被之前的替换遮蔽，则回溯到当前 surface 上替代它的载体（仍可继续编辑）。
 *
 * @param session - 活会话
 * @param events - 全量事件
 * @param seq - 助手节点 seq
 * @returns {{ seq: number, originalSeq: number, turn: number|null, text: string, visible: boolean } | undefined}
 */
function promptOfNode(session, events, seq) {
  let turnStartSeq = -1
  let turn = null
  for (const event of events ?? []) {
    if (event.type === 'turn/start' && event.seq < seq) {
      turnStartSeq = event.seq
      turn = event.data?.turn ?? null
    }
  }
  if (turnStartSeq < 0) return undefined

  let originalSeq
  for (const event of events ?? []) {
    if (event.seq <= turnStartSeq || event.seq >= seq) continue
    if (event.type === 'user/message' && event.surfaceOp === 'append') { originalSeq = event.seq; break }
  }
  if (originalSeq === undefined) return undefined

  const nodes = surfaceNodesOf(session, events)
  let currentSeq = originalSeq
  if (!nodes.includes(currentSeq)) {
    const carrier = [...(events ?? [])].reverse().find((e) => e.surfaceOp && typeof e.surfaceOp === 'object'
      && e.surfaceOp.startSeq <= originalSeq && originalSeq <= e.surfaceOp.endSeq)
    if (!carrier || !nodes.includes(carrier.seq)) {
      return { seq: originalSeq, originalSeq, turn, text: '', visible: false }
    }
    currentSeq = carrier.seq
  }
  const node = (events ?? []).find((e) => e.seq === currentSeq)
  const content = node?.data?.content
  const text = Array.isArray(content)
    ? content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('')
    : ''
  return { seq: currentSeq, originalSeq, turn, text, visible: true }
}

/**
 * 在所有活会话里找出某个 messageId 属于哪条会话的哪个节点。
 * @param ctx - 宿主上下文
 * @param messageId - 助手消息 id（也可传 `seq:<数字>` 直接指定节点）
 * @returns {{session: object, events: array[]|Array, seq: number, row: object} | undefined}
 */
function locateTarget(ctx, messageId) {
  const direct = /^seq:(\d+)$/.exec(messageId)
  const wantedSeq = direct ? Number(direct[1]) : undefined
  for (const session of liveSessions(ctx)) {
    const events = eventsOf(session)
    if (!events) continue
    const rows = nodeRows(session, events)
    const row = wantedSeq === undefined
      ? rows.find((r) => r.messageId !== undefined && r.messageId === messageId && r.type === 'assistant/message')
      : rows.find((r) => r.seq === wantedSeq && r.type === 'assistant/message')
    if (row) return { session, events, seq: row.seq, row }
  }
  return undefined
}

/**
 * 按 messageId 找**任意类型**的模型可见节点（用户消息或助手消息）。
 * 「回退到这条」按钮挂在用户消息上，所以不能只匹配 assistant。
 */
function locateMessage(ctx, messageId) {
  const direct = /^seq:(\d+)$/.exec(messageId)
  const wantedSeq = direct ? Number(direct[1]) : undefined
  for (const session of liveSessions(ctx)) {
    const events = eventsOf(session)
    if (!events) continue
    const bySeq = new Map(events.map((e) => [e.seq, e]))
    for (const seq of surfaceNodesOf(session, events)) {
      const event = bySeq.get(seq)
      if (!event) continue
      if (wantedSeq !== undefined) {
        if (seq === wantedSeq) return { session, events, seq, event }
        continue
      }
      const message = messageOf(event)
      const id = event.type === 'user/message' ? (event.data?.id ?? message?.id) : message?.id
      if (id === messageId) return { session, events, seq, event }
    }
  }
  return undefined
}

// ── 写入 ──────────────────────────────────────────────────────────────────

/**
 * 遮蔽一个节点：无回合的 user 载体、空内容。
 *
 * 注意：空 content 的 user/message **仍会投影成一条空消息**（见 README「已知限制」）；
 * 只有空 system/developer 才不投影，但那两类需要开着的 step，成本更高。
 *
 * `replacedBy` 记下「替代它的新节点 seq」——改写/还原是「追加新消息 + 遮蔽旧消息」，
 * 新节点与旧节点在日志里没有天然指针，靠这个字段让 `/find` 能算出改写血统。
 */
function shadowEvent(session, seq, replacedBy) {
  const source = { kind: `plugin:${PLUGIN_ID}` }
  if (Number.isSafeInteger(replacedBy)) source.replacedBy = replacedBy
  return session.append(
    'user/message',
    { id: randomUUID(), role: 'user', content: [], source },
    { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] },
  )
}

/**
 * 写一个**带内容**的 user 载体：用于「改提问 / 改提问并回退 / 撤回提问」。
 *
 * 载体必须是 user/message（assistant/message 不能携带 sourceEventSeqs），
 * 且 `role` 会被校验器强制为 `"user"` —— 这对编辑提问来说正好对称。
 * 纯撤回时用零宽空格而不是空 content：空 content 的 user/message 仍会投影成
 * 一条空消息进入模型请求（实测），零宽空格更干净。
 *
 * @param session - 活会话
 * @param options.text - 新正文（空串 = 撤回）
 * @param options.startSeq - 被替换区间的起点
 * @param options.endSeq - 被替换区间的终点
 * @param options.shadowed - 被遮蔽的 surface 节点全集（必须完整覆盖区间）
 */
function userCarrier(session, { text, startSeq, endSeq, shadowed }) {
  const content = text.length > 0
    ? [{ type: 'text', text }]
    : [{ type: 'text', text: '\u200b' }]
  return session.append(
    'user/message',
    { id: randomUUID(), role: 'user', content, source: { kind: 'user' } },
    { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs: flattenSeqs(shadowed) },
  )
}

/**
 * 在对话流里留一条**界面可见、模型不可见**的提示行。
 *
 * 为什么需要它：GUI 只渲染「追加」事件，不折叠「替换」事件——所以模型视野里
 * 那些被遮蔽/改写的消息，在界面上**不会消失也不会变化**，用户会觉得「什么都没发生」。
 * 这里追加一条普通 `user/message`（客户端会建行），紧接着用空内容载体把它遮蔽掉
 * （模型侧折叠后不存在）。结果：对话流里多出一条明确的「〔系统提示〕已回退…」标记，
 * 而模型完全读不到它。
 *
 * 已用 0.2.1 安装版校验器验证：关系状态机通过；`deriveMessages()` 里不含标记文本；
 * `foldSurface` 不含标记节点。
 *
 * @param session - 活会话
 * @param text - 标记正文（不含前缀）
 * @returns 标记事件的 seq（界面侧那一行）
 */
function appendMarker(session, text) {
  const marker = session.append('user/message', {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `〔系统提示〕${text}` }],
    source: { kind: `plugin:${PLUGIN_ID}-marker` },
  }, { surfaceOp: 'append' })
  session.append(
    'user/message',
    { id: randomUUID(), role: 'user', content: [], source: { kind: `plugin:${PLUGIN_ID}` } },
    { surfaceOp: { op: 'replace', startSeq: marker.seq, endSeq: marker.seq }, sourceEventSeqs: [marker.seq] },
  )
  return { seq: marker.seq, id: marker.data?.id }
}

/**
 * 按 content 生成自洽的 stream 记录（block-end 序列）。
 *
 * 校验规格（子代理从 0.2.0-rc.2 校验器实测得出）：
 *   · 现行 v4 读路径只要求 `stream` 是数组，不复放它的内容；
 *   · 但**历史代迁移校验器**会把 stream 重放成 blocks 并与 message.content 深比较
 *     （`seed assistant/message content disagrees with its embedded stream`）。
 *   所以这里按 content 现造一份自洽的 stream，而不是沿用原消息的旧 stream
 *   （旧 stream 描述的是旧文本，一旦将来触发迁移校验就会对不上）。
 */
function buildStream(content, baseTime) {
  return content.map((block, index) => ({
    type: 'chunk',
    time: baseTime + index,
    chunk: { type: 'block-end', index, block },
  }))
}

/**
 * 在合成轮次里写入一条新的助手消息（模型会当成「我说过的」读到）。
 *
 * 注意：**必须给新消息一个新的 messageId**。早先的版本复用了原消息的 id，
 * 结果客户端按 id 认消息，把改写后的版本当成旧版本「重新生成」了一遍，
 * 用户新增的文字就消失了（实测踩过）。id 不同 = 两条消息，客户端才不会串。
 */
function appendAssistantTurn(session, events, { text, reasoning, original }) {
  const turn = nextTurnOf(events)
  const content = []
  if (typeof reasoning === 'string' && reasoning.length > 0) content.push({ type: 'reasoning', text: reasoning })
  content.push({ type: 'text', text })
  const originalMessage = original?.data?.message
  const now = Date.now()
  const message = {
    id: randomUUID(),
    role: 'assistant',
    content,
    source: {
      kind: 'model',
      provider: originalMessage?.source?.provider ?? 'deepseek-official',
      model: originalMessage?.source?.model ?? 'context-edit',
    },
  }
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  const appended = session.append('assistant/message', {
    turn,
    step: 1,
    message,
    stream: buildStream(content, now),
    ...(original?.data?.usage !== undefined ? { usage: original.data.usage } : {}),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return appended
}

/**
 * 让宿主的「内存轮次计数器」跟上插件写进日志的合成轮次。
 *
 * 为什么必须做（源码定位 + 实测）：
 *   · 宿主开轮次用的是内存计数器：`const turn = phase.turn + 1`（`dsh-agent-loop`，`Agent.turn()`）。
 *   · `phase.lastTurn` 只在 agent 构造时从会话投影 `turnBoundary` 读一次
 *     （`const lastTurn = this.loopCtx.sessionProjections.stateOf(session, "turnBoundary")?.lastTurn ?? 0`），
 *     之后只被它自己的轮次推进。
 *   · 插件用 `session.append` 写的合成轮次**不经过那个循环**，计数器不知道 →
 *     宿主下一轮复用同一个号 → 日志出现重复轮次号 → 关系校验器拒收整条日志
 *     （`turn/start does not open the expected turn`，实测撞过两次）。
 *
 * 修法：写完合成轮次后，把 `agent.phase.lastTurn` 设成投影里的权威值
 *       （= 日志中已出现过的最大轮次号）。
 * 这是触碰宿主插件内部私有字段的做法：字段名或结构变化时本函数安全降级
 * （返回 ok:false，不抛错），此时插件退化为「写完后需重开会话」。
 * 只在 agent 空闲时动它——轮次运行中改计数器会污染正在跑的轮次。
 */
function syncAgentTurnCounter(ctx, session) {
  const agents = ctx.get('agents')
  if (!agents || typeof agents.get !== 'function') return { ok: false, reason: 'agents service unavailable' }
  const sessionId = session?.id
  if (typeof sessionId !== 'string') return { ok: false, reason: 'session id unavailable' }
  let agent
  try { agent = agents.get(sessionId) } catch (error) { return { ok: false, reason: `agents.get threw: ${String(error?.message ?? error)}` } }
  if (!agent) return { ok: false, reason: 'no live agent attached (nothing to sync)' }

  const phase = agent.phase
  if (!phase || typeof phase !== 'object') return { ok: false, reason: 'agent has no phase object (internal shape may have changed)' }
  if (phase.kind !== 'idle') return { ok: false, reason: `agent phase is "${String(phase.kind)}", not idle; refuse to touch a running turn` }

  const projections = agent.loopCtx?.sessionProjections
  if (!projections || typeof projections.stateOf !== 'function') return { ok: false, reason: 'sessionProjections unavailable on the loop context' }
  let authoritative
  try { authoritative = projections.stateOf(session, 'turnBoundary')?.lastTurn } catch (error) { return { ok: false, reason: `stateOf threw: ${String(error?.message ?? error)}` } }
  if (typeof authoritative !== 'number' || !Number.isSafeInteger(authoritative) || authoritative < 0) {
    return { ok: false, reason: `projection did not yield a usable lastTurn (${String(authoritative)})` }
  }

  const before = phase.lastTurn
  if (before === authoritative) return { ok: true, action: 'already-synced', lastTurn: authoritative }
  try { phase.lastTurn = authoritative } catch (error) { return { ok: false, reason: `assignment refused: ${String(error?.message ?? error)}` } }
  return { ok: true, action: 'synced', from: before, lastTurn: authoritative }
}

// ── 路由 ──────────────────────────────────────────────────────────────────

function makeRoutes(ctx) {
  const stateOf = (found) => ({
    ok: true,
    seq: found.seq,
    sessionId: found.session?.id,
    sessionShort: String(found.session?.id ?? '').replace(/^session-/, '').slice(0, 8),
    tail: openTail(found.events),
    openTurn: openTail(found.events).openTurn,
    openStep: openTail(found.events).openStep,
    nextTurn: nextTurnOf(found.events),
    history: shadowLineage(found.events, found.seq),
    prompt: promptOfNode(found.session, found.events, found.seq),
    row: found.row,
  })

  return [
    {
      kind: 'exact',
      path: `${API_BASE}/find`,
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'untrusted origin' })
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); return response.end() }
        const messageId = new URL(request.url ?? '', 'http://localhost').searchParams.get('messageId')
        if (typeof messageId !== 'string' || messageId.length === 0) return writeJson(response, 400, { error: 'missing messageId' })
        const found = locateTarget(ctx, messageId)
        if (!found) return writeJson(response, 404, { error: '找不到这条消息所属的活会话（会话可能没打开或已重载）' })
        const { openTurn, openStep } = openTail(found.events)
        return writeJson(response, 200, { ...stateOf(found), openTurn, openStep })
      },
    },
    {
      kind: 'exact',
      path: `${API_BASE}/prompts`,
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'untrusted origin' })
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); return response.end() }
        const sessionId = new URL(request.url ?? '', 'http://localhost').searchParams.get('sessionId')
        if (typeof sessionId !== 'string' || sessionId.length === 0) return writeJson(response, 400, { error: 'missing sessionId' })
        const session = await resolveSession(ctx, sessionId)
        if (!session) return writeJson(response, 404, { error: '找不到这条会话（可能没打开或已卸载）' })
        const events = eventsOf(session)
        if (!events) return writeJson(response, 409, { error: '该会话的事件不可读' })
        const { openTurn, openStep } = openTail(events)
        return writeJson(response, 200, {
          ok: true,
          sessionId: session.id,
          openTurn,
          openStep,
          prompts: promptsOf(session, events),
        })
      },
    },
    {
      /**
       * 就地回退到某条消息之后：保留这条，把它后面的全部移出模型视野，
       * 并在对话流里放一条标记行。配合客户端视图过滤 = 界面就地「消失」。
       */
      kind: 'exact',
      path: `${API_BASE}/rewind-here`,
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'untrusted origin' })
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); return response.end() }
        const body = await readJsonBody(request)
        if (body === undefined) return writeJson(response, 400, { error: 'invalid JSON body' })
        const messageId = body.messageId
        if (typeof messageId !== 'string' || messageId.length === 0) return writeJson(response, 400, { error: 'messageId is required' })

        const found = locateMessage(ctx, messageId)
        if (!found) return writeJson(response, 404, { error: '这条消息已不在模型可见面上（可能刚被改过或会话已重载）' })
        const { session, events, seq } = found
        const { openTurn, openStep } = openTail(events)
        if (openTurn !== null || openStep !== null) {
          return writeJson(response, 409, { error: '这一轮还在跑（或刚被中断）。等回复结束后再回退。' })
        }

        const nodes = surfaceNodesOf(session, events)
        const index = nodes.indexOf(seq)
        if (index < 0) return writeJson(response, 409, { error: '目标节点不在当前模型可见面上' })
        // Claude Code 语义：连你点的那条一起回退（原文复制到剪贴板，方便改完重发）。
        const after = nodes.slice(index)
        if (after.length === 0) return writeJson(response, 400, { error: '这条已经是最后一条消息，后面没有可回退的内容' })

        const bySeq = new Map(events.map((e) => [e.seq, e]))
        const anchorEvent = bySeq.get(seq)
        const anchorMessage = messageOf(anchorEvent)
        const anchorText = Array.isArray(anchorMessage?.content)
          ? anchorMessage.content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('')
          : ''
        const assistantCount = after.filter((s) => bySeq.get(s)?.type === 'assistant/message').length
        const startSeq = after[0]
        const endSeq = after[after.length - 1]

        // 客户端隐藏用的精确 DOM key：`${kind.length}:${kind}${id}`（见平台 conversationContextKey）。
        // 用户消息 id 是 uuid；助手节点 id 是 `${turn}:${step}`。
        const hiddenKeys = []
        for (const seq of after) {
          const event = bySeq.get(seq)
          if (event?.type === 'user/message' && typeof event.data?.id === 'string') {
            hiddenKeys.push(`${'input-message'.length}:input-message${event.data.id}`)
          } else if (event?.type === 'assistant/message') {
            const turn = event.data?.turn
            const step = event.data?.step
            if (Number.isSafeInteger(turn) && Number.isSafeInteger(step)) {
              hiddenKeys.push(`${'assistant-step'.length}:assistant-step${turn}:${step}`)
            }
          }
        }

        try {
          session.append(
            'user/message',
            // 零宽空格而不是空 content：空 content 的 user/message 仍会投影成一条空消息，
            // 某些提供方会把它当成「空提示词」。
            { id: randomUUID(), role: 'user', content: [{ type: 'text', text: '\u200b' }], source: { kind: `plugin:${PLUGIN_ID}` } },
            { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs: flattenSeqs(after) },
          )
        } catch (error) {
          return writeJson(response, 409, { error: `surface 拒绝了这次回退：${String(error?.message ?? error)}` })
        }

        let marker = { seq: undefined, id: undefined }
        try {
          marker = appendMarker(session, `已回退到此：移除了 ${after.length} 条内容（含 ${assistantCount} 条回复）。模型不再读到它们；原始记录未改动。`)
        } catch { /* 标记失败不影响回退 */ }

        // 折叠的思考/工具块（turn-process）不在这两个 key 集合里，
        // 用「轮次号」兜底：被回退轮次的所有行（含折叠块）一起隐藏。
        const hiddenTurns = new Set()
        for (const s of after) {
          const event = bySeq.get(s)
          if (event?.type === 'assistant/message' && Number.isSafeInteger(event.data?.turn)) hiddenTurns.add(event.data.turn)
        }
        let anchorTurn = null
        for (const event of events) {
          if (event.type === 'turn/start' && event.seq < seq) anchorTurn = event.data?.turn ?? null
        }
        if (Number.isSafeInteger(anchorTurn)) hiddenTurns.add(anchorTurn)

        const zone = {
          anchorId: messageId,
          includeAnchor: true,
          markerId: marker.id ?? null,
          markerSeq: marker.seq ?? null,
          removedCount: after.length,
          assistantCount,
          hiddenKeys,
          hiddenTurns: [...hiddenTurns],
          time: Date.now(),
        }
        try { appendZone(session.id, zone) } catch { /* 记录失败只是刷新后不隐藏 */ }

        const flush = await flushSession(ctx, session)
        return writeJson(response, 200, { ok: true, zone, removedCount: after.length, assistantCount, anchorText, ...flush })
      },
    },
    {
      kind: 'exact',
      path: `${API_BASE}/zones`,
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'untrusted origin' })
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); return response.end() }
        const sessionId = new URL(request.url ?? '', 'http://localhost').searchParams.get('sessionId')
        if (typeof sessionId !== 'string' || sessionId.length === 0) return writeJson(response, 400, { error: 'missing sessionId' })
        const sessions = ctx.get('sessions')
        const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
        const events = session === undefined ? undefined : eventsOf(session)
        const deadTurns = session !== undefined && events !== undefined ? deadAssistantTurns(session, events) : []
        return writeJson(response, 200, { ok: true, sessionId, zones: zonesOf(sessionId), deadTurns })
      },
    },
    {
      /**
       * 完整回退：以「目标提问所在轮次之前」为边界 fork 一个新会话，并切过去。
       *
       * 为什么是 fork 而不是就地遮蔽：客户端只渲染追加事件、不折叠替换事件，
       * 就地遮蔽在界面上永远看不出来。fork 出来的子会话**根本没有**后续事件，
       * 界面因此真的少了那些消息（平台原生能力，见 turn tail 的分支按钮）。
       */
      kind: 'exact',
      path: `${API_BASE}/rewind`,
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'untrusted origin' })
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); return response.end() }
        const body = await readJsonBody(request)
        if (body === undefined) return writeJson(response, 400, { error: 'invalid JSON body' })
        const { sessionId, promptSeq, mode } = body
        if (typeof sessionId !== 'string' || sessionId.length === 0) return writeJson(response, 400, { error: 'sessionId is required' })
        if (!Number.isSafeInteger(promptSeq)) return writeJson(response, 400, { error: 'promptSeq must be an integer' })
        if (mode !== undefined && mode !== 'keep' && mode !== 'resend' && mode !== 'notext') {
          return writeJson(response, 400, { error: 'mode must be keep / resend / notext' })
        }
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.length > MAX_TEXT_CHARS) return writeJson(response, 413, { error: 'text too long' })

        const session = await resolveSession(ctx, sessionId)
        if (!session) return writeJson(response, 404, { error: '找不到这条会话' })
        const events = eventsOf(session)
        if (!events) return writeJson(response, 409, { error: '该会话的事件不可读' })
        const { openTurn, openStep } = openTail(events)
        if (openTurn !== null || openStep !== null) {
          return writeJson(response, 409, { error: '这一轮还在跑（或刚被中断）。等回复结束后再回退。' })
        }

        const target = promptsOf(session, events).find((p) => p.promptSeq === promptSeq)
        if (!target) return writeJson(response, 400, { error: '这条提问已不在模型可见面上（可能刚被改过），请刷新面板' })

        const nodes = surfaceNodesOf(session, events)
        const index = nodes.indexOf(promptSeq)
        const removed = index >= 0 ? nodes.slice(index) : []
        const bySeq = new Map(events.map((e) => [e.seq, e]))
        const assistantCount = removed.filter((s) => bySeq.get(s)?.type === 'assistant/message').length

        const sessions = ctx.get('sessions')
        const controller = ctx.get('sessionController')
        if (!controller || typeof controller.fork !== 'function') {
          return writeJson(response, 501, { error: '宿主没有提供 sessionController.fork' })
        }

        let childId
        try {
          // 用控制器 fork（不是 sessions.fork）：它会解析并挂载 workspace、为新会话创建 agent，
          // 子会话因此能出现在侧栏、能直接接收提示词。
          const result = await controller.fork({ sessionId: session.id, atSeq: target.boundarySeq })
          childId = result?.sessionId
        } catch (error) {
          return writeJson(response, 409, { error: `fork 被拒绝：${String(error?.message ?? error)}` })
        }
        if (typeof childId !== 'string') return writeJson(response, 500, { error: 'fork 没有返回子会话 id' })
        const child = (sessions && typeof sessions.get === 'function' ? sessions.get(childId) : undefined)
          ?? await resolveSession(ctx, childId)

        // 在子会话里留一条「界面可见、模型不可见」的标记，说明退到哪、移除了多少。
        let markerSeq
        if (child) {
          try {
            const short = String(session.id ?? '').replace(/^session-/, '').slice(0, 8)
            markerSeq = appendMarker(child, `已回退到这里：移除了 ${removed.length} 条内容（含 ${assistantCount} 条回复）。原会话 ${short} 已归档。`).seq
          } catch { /* 标记失败不影响回退 */ }
        }

        // 可选：把改写后的提问直接发进子会话。
        let resend = { attempted: false }
        if (mode === 'resend') {
          if (text.trim().length === 0) return writeJson(response, 400, { error: 'resend 需要非空正文' })
          if (!controller || typeof controller.prompt !== 'function') {
            resend = { attempted: true, ok: false, error: '宿主没有提供 prompt 准入' }
          } else {
            try {
              await controller.prompt({
                sessionId: childId,
                requestId: randomUUID(),
                mode: 'queue',
                content: [{ type: 'text', text }],
                clientTimeZone: 'Asia/Shanghai',
              }, { kind: 'user', rpcId: randomUUID(), clientTimeZone: 'Asia/Shanghai' })
              resend = { attempted: true, ok: true }
            } catch (error) {
              resend = { attempted: true, ok: false, error: String(error?.message ?? error) }
            }
          }
        }

        if (child) await flushSession(ctx, child)
        return writeJson(response, 200, {
          ok: true,
          childSessionId: childId,
          parentSessionId: session.id,
          removedCount: removed.length,
          assistantCount,
          promptText: target.text,
          boundarySeq: target.boundarySeq,
          markerSeq,
          resend,
          needsComposer: mode === 'resend' && resend.ok !== true,
        })
      },
    },
    {
      kind: 'exact',
      path: `${API_BASE}/apply`,
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'untrusted origin' })
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); return response.end() }
        const body = await readJsonBody(request)
        if (body === undefined) return writeJson(response, 400, { error: 'invalid JSON body' })
        const { messageId, mode } = body
        if (typeof messageId !== 'string' || messageId.length === 0) return writeJson(response, 400, { error: 'messageId is required' })
        const MODES = new Set(['rewrite', 'delete', 'restore', 'edit-prompt', 'rewind-edit', 'rewind-delete'])
        if (!MODES.has(mode)) {
          return writeJson(response, 400, { error: 'mode must be rewrite / delete / restore / edit-prompt / rewind-edit / rewind-delete' })
        }
        const text = typeof body.text === 'string' ? body.text : ''
        const reasoning = typeof body.reasoning === 'string' ? body.reasoning : ''
        if (text.length > MAX_TEXT_CHARS || reasoning.length > MAX_TEXT_CHARS) return writeJson(response, 413, { error: 'text too long' })
        if ((mode === 'rewrite' || mode === 'edit-prompt' || mode === 'rewind-edit') && text.trim().length === 0) {
          return writeJson(response, 400, { error: '这种模式需要非空正文' })
        }

        const found = locateTarget(ctx, messageId)
        if (!found) return writeJson(response, 404, { error: '找不到这条消息所属的活会话' })
        const { session, events, seq } = found
        const { openTurn, openStep } = openTail(events)
        if (openTurn !== null || openStep !== null) {
          return writeJson(response, 409, { error: '该会话尾部还有未结束的回合/步骤（agent 正在跑或刚被中断），现在改写会让轮次计数错位。请等它跑完。' })
        }

        const written = []
        let sync
        let rewind
        let markerText
        try {
          // ── 提问侧：就地改 / 改并回退 / 撤回（都不写合成轮次，故不需要同步计数器） ──
          if (mode === 'edit-prompt' || mode === 'rewind-edit' || mode === 'rewind-delete') {
            const prompt = promptOfNode(session, events, seq)
            if (!prompt) return writeJson(response, 409, { error: '这一轮找不到可编辑的提问节点' })
            if (!prompt.visible) return writeJson(response, 409, { error: '这一轮的提问已被替换且不在模型可见面上，请刷新面板后重试' })
            const nodes = surfaceNodesOf(session, events)
            const index = nodes.indexOf(prompt.seq)
            if (index < 0) return writeJson(response, 409, { error: '提问节点已不在模型可见面上（可能刚被改过），请刷新面板后重试' })

            if (mode === 'edit-prompt') {
              // 只换这一条，后面的回复保持原样
              written.push(userCarrier(session, { text, startSeq: prompt.seq, endSeq: prompt.seq, shadowed: [prompt.seq] }).seq)
              markerText = `已修改这一轮的提问：模型下一轮读新版（界面保留原文，原始记录未改动）。`
            } else {
              // 回退：从这条提问一直到当前面末尾全部移出模型视野
              const endSeq = nodes[nodes.length - 1]
              const shadowed = nodes.slice(index)
              if (shadowed.length === 0) return writeJson(response, 409, { error: '回退区间为空' })
              written.push(userCarrier(session, {
                text: mode === 'rewind-edit' ? text : '',
                startSeq: prompt.seq,
                endSeq,
                shadowed,
              }).seq)
              const assistantCount = shadowed.filter((s) => events.find((e) => e.seq === s)?.type === 'assistant/message').length
              rewind = { fromSeq: prompt.seq, toSeq: endSeq, shadowedCount: shadowed.length, assistantCount }
              const preview = prompt.text.length > 24 ? `${prompt.text.slice(0, 24)}…` : prompt.text
              markerText = mode === 'rewind-edit'
                ? `已回退到「${preview}」并改写该提问：模型视野移除了 ${shadowed.length} 条内容（含 ${assistantCount} 条回复）。界面不会删除旧消息，这是平台行为。`
                : `已回退并撤回提问「${preview}」：模型视野移除了 ${shadowed.length} 条内容（含 ${assistantCount} 条回复）。界面不会删除旧消息，这是平台行为。`
            }
          } else if (mode === 'rewrite') {
            const original = events.find((e) => e.seq === seq)
            // 先追加新消息，再遮蔽旧节点，并把「被谁替代」记在载体上：
            // 新节点是 append，日志里没有指向旧节点的天然指针，靠 replacedBy 建链。
            const appended = appendAssistantTurn(session, events, { text, reasoning, original })
            written.push(appended.seq)
            written.push(shadowEvent(session, seq, appended.seq).seq)
            // 兜底：把「同一条 messageId 的其它可见版本」一并遮蔽。
            // 客户端按 messageId 认消息，留两个可见版本会被它当成「重新生成」。
            const originalId = original?.data?.message?.id
            if (typeof originalId === 'string') {
              for (const row of nodeRows(session, events)) {
                if (row.seq !== seq && row.type === 'assistant/message' && row.messageId === originalId) {
                  written.push(shadowEvent(session, row.seq, appended.seq).seq)
                }
              }
            }
            // 合成轮次写进日志后，宿主的 phase 计数器还停在旧值 →
            // 下一轮会复用同一个号。这里把它推到投影给出的权威值。
            sync = syncAgentTurnCounter(ctx, session)
            markerText = `已改写这条回复：模型下一轮读新版内容（界面保留原文，原始记录未改动）。`
          } else if (mode === 'restore') {
            // 还原原样：从血统里取最早的原始节点，把它的正文/思考重新写成一条
            // **新的助手消息**（新的 messageId），让模型重新以「我说过的」读到原话。
            // 不直接复用被遮蔽的老 carrier，避免客户端出现两个同 id 的可见版本。
            const { originSeq } = shadowLineage(events, seq)
            const original = events.find((e) => e.seq === originSeq)
            if (!original) return writeJson(response, 409, { error: `追溯不到原始版本（seq ${originSeq}）` })
            const originalMessage = original.data?.message
            const originalText = Array.isArray(originalMessage?.content)
              ? originalMessage.content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('')
              : ''
            const originalReasoning = Array.isArray(originalMessage?.content)
              ? originalMessage.content.filter((c) => c?.type === 'reasoning').map((c) => c.text ?? '').join('')
              : ''
            if (originalText.trim().length === 0 && originalReasoning.trim().length === 0) {
              return writeJson(response, 409, { error: '原始版本没有可还原的文本内容' })
            }
            const appended = appendAssistantTurn(session, events, { text: originalText, reasoning: originalReasoning, original })
            written.push(appended.seq)
            written.push(shadowEvent(session, seq, appended.seq).seq)
            sync = syncAgentTurnCounter(ctx, session)
            markerText = `已还原原始版本：模型重新读到原话（界面保留改写版，原始记录未改动）。`
          } else if (mode === 'delete') {
            written.push(shadowEvent(session, seq).seq)
            markerText = `已把这条回复移出模型视野：模型下一轮不再读到它（界面仍显示，这是平台按追加渲染的行为）。`
          }
        } catch (error) {
          return writeJson(response, 409, { error: `surface 拒绝了这次写入：${String(error?.message ?? error)}` })
        }

        // 界面标记：让对话流里真的出现一条「发生了什么」的提示行（模型不可见）。
        // 标记是纯装饰，失败不应让整次操作失败。
        let markerSeq
        if (typeof markerText === 'string' && markerText.length > 0) {
          try { markerSeq = appendMarker(session, markerText).seq } catch { /* 标记失败忽略 */ }
        }

        const flush = await flushSession(ctx, session)
        const warning = (mode === 'rewrite' || mode === 'restore') && sync && sync.ok !== true
          ? `轮次计数器未能同步（${sync.reason}）：请在本轮对话结束后重开这条会话，否则宿主的下一轮会复用已用过的轮次号。`
          : undefined
        return writeJson(response, 200, { ok: true, mode, shadowedSeq: seq, writtenSeqs: written, markerSeq, turnSync: sync, rewind, warning, ...flush })
      },
    },
    {
      // 只读诊断：不改任何东西。返回插件写入所需的全部现场事实，
      // 便于在动真格之前确认「宿主计数器能不能被同步」。
      kind: 'exact',
      path: `${API_BASE}/diagnose`,
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'untrusted origin' })
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); return response.end() }
        const messageId = new URL(request.url ?? '', 'http://localhost').searchParams.get('messageId')
        if (typeof messageId !== 'string' || messageId.length === 0) return writeJson(response, 400, { error: 'missing messageId' })
        const found = locateTarget(ctx, messageId)
        if (!found) return writeJson(response, 404, { error: '找不到这条消息所属的活会话' })
        const { session, events } = found
        const agents = ctx.get('agents')
        const agent = agents && typeof agents.get === 'function' ? agents.get(session.id) : undefined
        const phase = agent?.phase
        const projections = agent?.loopCtx?.sessionProjections
        let projectedLastTurn
        try { projectedLastTurn = projections?.stateOf?.(session, 'turnBoundary')?.lastTurn } catch { projectedLastTurn = 'threw' }
        return writeJson(response, 200, {
          ok: true,
          sessionId: session.id,
          maxTurnInLog: Math.max(0, ...events.filter((e) => e.type === 'turn/start' || e.type === 'turn/end').map((e) => e.data?.turn ?? 0)),
          openTail: openTail(events),
          agent: agent === undefined ? null : {
            hasPhase: phase !== undefined,
            phaseKind: phase?.kind ?? null,
            phaseLastTurn: phase?.lastTurn ?? null,
            phaseTurn: phase?.turn ?? null,
            hasLoopCtx: agent.loopCtx !== undefined,
            projectedLastTurn: projectedLastTurn ?? null,
            canSync: phase !== undefined && phase.kind === 'idle' && typeof projectedLastTurn === 'number',
          },
        })
      },
    },
  ]
}

/**
 * 挂载路由与插件说明。
 * @param {object} ctx - 携带 webServer / sessions / sessionController 的宿主插件上下文。
 */
export function apply(ctx) {
  ctx.effect(() => {
    const disposers = makeRoutes(ctx).map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-ctxedit: routes')

  const systemPrompt = ctx.get?.('systemPrompt') ?? ctx.systemPrompt
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    ctx.effect(() => systemPrompt.section({
      name: `plugin:${PLUGIN_ID}`,
      order: 152,
      text: CTXEDIT_GUIDANCE,
    }), 'dsh-ctxedit: announcement')
  }
}

