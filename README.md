# dsh-ctxedit —— 上下文改写（GUI）

在**助手消息的动作行**加一个「更改输出」按钮；在**每条用户消息左侧**有一个常显的回溯图标。

| 入口 | 效果 |
|---|---|
| **保存改写** | 让模型下一轮把这条回复读成你写的**新正文 + 新思考**（角色仍是 assistant） |
| **抹掉这条** | 让模型下一轮**完全看不到**这条回复（连「我说过这句」都没有） |
| **还原原样** | 把被遮蔽的**原始版本**重新放回模型视野（只有被改写过的回复才会出现） |
| **↩ 回溯（用户消息左侧图标）** | 就地回退：这条消息及其后的内容移出模型视野，界面行同时隐藏；原文复制到剪贴板 |

> **界面级「消失」= 就地回溯。** 平台客户端只渲染「追加」事件、不折叠「替换」事件，
> 所以插件在模型侧遮蔽之外，还用 `zones.json` 记录「锚点 / 标记 / 死轮次」，
> 由客户端把对应 DOM 行隐藏。fork 路由（`/rewind`）保留，但 UI 已不再使用新会话。

**改动只改「模型下一轮读到什么」。** 会话日志是 append-only，原始字节一个都不动 —— 卸载插件后旧内容会重新显示出来。

## HTTP 接口（宿主半体，全部回环 + 同源）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/dsh-ctxedit/find?messageId=` | 定位消息，返回正文/思考/血统（`history.rewrites`、`originSeq`） |
| POST | `/api/dsh-ctxedit/apply` | `rewrite` / `delete` / `restore`（兼容旧的 `edit-prompt` / `rewind-*` 模式） |
| GET | `/api/dsh-ctxedit/diagnose?messageId=` | 只读现场诊断（phase、计数器、surface 事实） |
| GET | `/api/dsh-ctxedit/prompts?sessionId=` | 按轮次列出真实提问（供 fork 回溯用） |
| POST | `/api/dsh-ctxedit/rewind` | fork 回溯（保留；UI 不用） |
| POST | `/api/dsh-ctxedit/rewind-here` | 就地回溯：区间遮蔽 + 标记 + `zones` 记录 |
| GET | `/api/dsh-ctxedit/zones?sessionId=` | 返回隐藏区域与死轮次（`deadTurns`） |

`/apply` 的 `mode` 取值：

| mode | 作用 | 写合成轮次 | 需要 `text` |
|---|---|---|---|
| `rewrite` | 改写助手回复（正文+思考），角色仍为 assistant | 是（同步计数器） | 是 |
| `delete` | 抹掉助手回复 | 否 | 否 |
| `restore` | 还原被遮蔽的原始回复 | 是（同步计数器） | 否 |
| `edit-prompt` | 就地改本轮提问（旧模式，UI 不再使用） | 否 | 是 |
| `rewind-edit` | 用新文字替换本轮提问并回退（旧模式） | 否 | 是 |
| `rewind-delete` | 撤回本轮提问并回退（旧模式） | 否 | 否 |

全部路由只接受回环地址 + 同源请求（改会话内容的路由，不对 LAN 开放）。

> **兼容性**：DSH `0.2.0-rc.2` 与 `0.2.1-rc.2` 均已实测跑通（0.2.1 上 `find`/`diagnose` 正常、
> `phase`/`loopCtx` 可访问、轮次号无重复）。0.2.1 的安装版与 npm 包在 `surface.js` /
> `v3-to-v4` / `agent-loop` 三个关键文件上逐字节一致。证据见
> [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)；升级后跑一次
> [tools/verify-host.mjs](tools/verify-host.mjs) 确认现场。

---

## 为什么能做到（机制）

DSH 的会话日志分两层：落盘的事件日志（append-only）与**模型可见的那一层**（surface）。

- 追加一条带 `surfaceOp: { op: 'replace', startSeq, endSeq }` + `sourceEventSeqs` 的事件，就能把旧节点从 surface 上**遮蔽**掉；
- 遮蔽后 `session.deriveMessages()` 里那个节点消失，模型就看不到它了。

这套写法有四条硬约束（全部实测撞出来的）：

1. **只有非 assistant 载体能做替换**。`assistant/message` 一旦带 `sourceEventSeqs` 会被拒：
   `assistant/message embeds its source stream and cannot carry sourceEventSeqs`。
   所以「遮蔽」用**无回合的 user/message 空内容载体**做。
   **已知代价**：空 content 的 user/message 仍会投影成 1 条空 user 消息进入模型请求
   （`dsh-session/lib/types/surface.js:85-87` 对 user/message 直接 `return event.data`）；
   只有空 `system` / `developer` 才不投影，但它们必须落在开着的 step 里，成本更高，暂不采用。
2. **模型可见的 assistant 内容必须落在「开着的 turn + step」里**，且 `turn/step` 要与当前开着的完全一致。
   插件自己开一个**合成轮次**来承载改写后的消息。
3. **合成轮次必须带结算字段**：`data.turn`、`data.step`、`message`、`stream`（数组，且与 content 自洽）。
4. **`source.replacedBy` 是血统指针。** 改写/还原是「先 append 新消息，再用空载体遮蔽旧节点」；
   新节点与旧节点在日志里没有天然指针，所以载体上记 `source.replacedBy = 新节点 seq`。
   `/find` 反过来按这个字段一路回溯到最初的助手消息，得到 `history.rewrites` / `originSeq`。
   旧日志没有该字段 → `rewrites` 为 0。

---

## 为什么必须同步宿主的轮次计数器（最重要的一节）

**症状**：连续改写两次后，日志出现 `…11, 12, 12, 13…` 这种重复轮次号；
宿主关系校验器随后拒收整条日志：`turn/start does not open the expected turn`，会话打不开。

**成因**（源码位置：`@deepseek-ai/dsh-agent-loop`）：

| # | 事实 |
|---|---|
| 1 | 校验器要求每个 `turn/start` 恰好等于 `nextTurn`，而 `nextTurn` 只在 `turn/end` 后 +1 ⇒ 唯一合法序列是 `1,2,3,…`，不能重复也不能跳号 |
| 2 | 宿主开轮次用的是**内存计数器**：`const turn = phase.turn + 1` |
| 3 | `phase.lastTurn` 只在 **agent 构造时**从会话投影 `turnBoundary` 读一次：`const lastTurn = this.loopCtx.sessionProjections.stateOf(session, "turnBoundary")?.lastTurn ?? 0`，之后只被它自己的轮次推进 |
| 4 | 插件用 `session.append` 写的合成轮次**不经过那个循环**，计数器不知道 → 宿主下一轮复用同一个号 → 撞号 |

**修法**（`lib/index.js` 的 `syncAgentTurnCounter`）：写完合成轮次后，把 `agent.phase.lastTurn` 设成投影给出的权威值：

```js
const authoritative = agent.loopCtx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn
phase.lastTurn = authoritative
```

拿 agent 的路径是 `ctx.agents.get(sessionId)`（宿主 typert 注册表里 `resolve: sessionId => this.get(sessionId)`）。

**安全阀**：

- 只在 `phase.kind === 'idle'` 时赋值 —— 轮次跑着的时候改计数器会污染在跑的轮次，这时直接拒绝；
- 全程 try/catch。字段名或结构一变（DSH 升级），同步函数返回 `ok: false` 而**不抛错**，接口会附带一句 warning 提示「需要重开会话」；
- 只读探针 `diagnose?messageId=…` 可以随时确认现场：`phaseKind` / `phaseLastTurn` / `projectedLastTurn` / `canSync`。

> ⚠ **升级 DSH 后第一件事**：先跑一次 `/diagnose`。若 `hasPhase: false` 或 `canSync: false`，
> 说明宿主内部结构变了，同步会静默降级 → 此时每次改写后必须**重开会话**再继续对话。

---

## 已知限制

- **必须等 agent 空闲**。`/find` 会返回 `openTurn`/`openStep`，非 null 时面板禁用写入并给提示。
- **被改写的原消息若含工具调用**，工具调用/结果块不会跟着回到上下文（伪造「我调用过某工具」会被校验器挑出来）。
- **改写后新消息的 messageId 是全新的**（这是刻意的）。早期版本复用了原 id，客户端按 id 认消息 → 把改写版当成旧版「重新生成」，用户的新内容会消失。实测踩过。
- **`stream` 按 content 现场生成**（block-end 序列）。现行 v4 读路径不复放 stream，但历史代迁移校验器会把 stream 重放成 blocks 与 content 深比较，自洽才安全。
- **0.5.1 之前做过的改写无法「还原原样」**：当时没写 `source.replacedBy`，血统回溯不到原稿，面板不会出现「还原原样」按钮。此时只能手动重新改写。

---

## 安装与回退

**安装位置**：`~\.dsh\profiles\desktop\plugins\dsh-ctxedit\`，并在 profile 的 `cordis.patch.yml` 末尾注册一行：

```yaml
- insert:
    - id: dsh-ctxedit
      name: ./plugins/dsh-ctxedit/lib/index.js
      config: {}
```

**回退**：

1. 删掉 `cordis.patch.yml` 里上面那段 `insert` → 重启 DSH 即停用；
2. 或删掉整个 `plugins\dsh-ctxedit\` 目录；
3. 已经写进日志的替换事件**不会被撤销**（append-only）——卸载后界面会回到原始内容，但模型仍读着被改写的历史。要彻底还原，用面板里的「还原原样」。

---

## 工具（`tools/`）

常用入口（**完整清单见 [MANIFEST.md](MANIFEST.md)，共 17 个脚本**）：

| 脚本 | 用途 |
|---|---|
| `verify-host.mjs` | **升级后自检**：读会话日志 → 打 `/find` `/diagnose` → 判定计数器同步是否仍可用 |
| `check-log.mjs` | 打印任意会话日志的轮次结构 / 可见节点 / 替换事件 |
| `test-restore.mjs` | **固定场景回归测试**：真实日志副本上跑 改写 → `/find` 血统 → 还原 → `fromRestore`；需要真实日志入参（运行方式见脚本头，app.asar 需 Electron-as-node） |
| `fix-turns.mjs` | 修复「重复轮次号」（先 dry-run，`--write` 才落盘；需 DSH 已关闭） |
