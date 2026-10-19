# CHANGELOG

## 0.5.0 — 2026-10-19

**「改上下文」面板 UI 收尾。**

- 删除「本轮的提问」编辑区及「就地改提问 / 改并回退 / 撤回提问」三个按钮（提问回退已由消息上的「↩ 回溯」承担）。
- 样式改用 DSH 主题 token（`--dsw-alias-bg-base`、`-label-*`、`-separator-primary`、`-state-business/error/warn`、
  `-markdown-code-block`），亮色/暗色自动跟随；卡片加宽到 1040px，按钮/字号/间距贴近聊天 UI。
- 正文与思考改为「源码 + 预览」并排编辑器：左侧原文（符号完整保留），右侧实时渲染 Markdown；
  窄屏（<760px）自动堆叠。
- Markdown 优先复用平台 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`，取不到或渲染抛错时
  回退到内置渲染器（标题/列表/引用/围栏代码/行内代码/粗斜体/链接/分隔线）。
- 新增离线单测 `tools/test-markdown.mjs`（抽取内置渲染器，检查节点结构）。

## 0.4.0 — 2026-10-19

**界面级回退（fork rewind）+ 对话流可见标记。**

- 新增输入框左侧「回退」入口（`conversation.input.left`，会话作用域槽位拿 `sessionId`）。
- 新增 `GET /api/dsh-ctxedit/prompts`：按轮次列出真正的人类提问（跳过注入上下文/steering），
  每条带 `promptSeq` 与 `boundarySeq`（该轮 `turn/start` 之前最后一个事件的 seq）。
- 新增 `POST /api/dsh-ctxedit/rewind`：以 `boundarySeq` 调 `ctx.sessions.fork` 创建**更短的新会话**
  （平台原生能力），并在子会话里追加一条「界面可见、模型不可见」的标记行；
  支持 `keep`（复制提问原文）/ `resend`（改完直接发）/ `notext`（连同提问一起撤回）。
- 客户端面板：提问列表 + 三动作（回退 / 回退并改 / 撤回），成功后用 `uiWorkspace.openSession`
  切到新会话；提示原文自动复制到剪贴板。
- 所有就地动作（改写/抹除/还原/改提问）之后追加〔系统提示〕标记行：解决「对话流里什么都没发生」。
  标记行用「追加后立即空载体遮蔽」实现——GUI 渲染该 append 行，模型侧折叠后不存在（0.2.1 校验器实测）。
- 新增离线单测 `tools/test-rewind.mjs`（假 ctx 调真实路由处理器，覆盖边界计算、fork、resend、非法输入）。

## 0.3.1 — 2026-10-19

**提问侧三模式独立复验 + 复验工具归档。**

- 新增 `tools/verify-prompt-modes.mjs`：把日志截到最后一个 `turn/end`（= 点按钮那一刻的稳定状态），
  在内存副本上按 `userCarrier` 规则模拟三种模式，用**安装版 0.2.1** 校验器判定。
- 复验结果（真实会话日志，turn 34 的提问 seq 2938）：
  - `edit-prompt`：关系状态机 PASS；新文字在、旧文字消失、后续回复仍在。
  - `rewind-edit`：PASS；模型末尾只剩新提问，整轮（74 个 surface 节点）已回退。
  - `rewind-delete`：PASS；提问及其后内容都不在模型视野。
- 用户侧实测佐证：`seq 3183` 的 `REPLACE→2938..3178` 就是一次真实的 `rewind-edit`。

## 0.3.0 — 2026-10-19

**新增「提问侧」操作（Claude Code rewind 语义）。**

面板里多出「本轮的提问」区域，三个动作：

| 动作 | 效果 |
|---|---|
| **就地改提问** | 只替换这条提问的文字；这一轮之后的回复保持不动。 |
| **改并回退** | 把提问换成新文字，并把这条提问**之后的所有内容**移出模型视野 —— 等于从这一轮重开。 |
| **撤回提问** | 这条提问及其之后的所有内容都移出模型视野（载体用零宽空格）。 |

实现要点：
- 提问侧操作**不写合成轮次**，因此不需要同步宿主轮次计数器（`phase.lastTurn` 不受影响）。
- 载体是 `user/message`（`role` 被校验器强制为 `user`），跨区间替换时 `sourceEventSeqs`
  完整覆盖被遮蔽的 surface 节点。
- 定位规则：从助手节点往前找最近的 `turn/start`，取其后第一条 `user/message`；
  若该提问已被替换过，自动回溯到当前 surface 上的替代载体。
- 已用安装版 0.2.1 校验器离线验证三种模式：关系状态机 PASS，
  `Session.fromRestore` 折叠结果符合预期（就地改保留后续回复；回退后模型末尾只剩新提问）。

## 0.2.0 — 2026-10-19

**针对 DSH 0.2.1-rc.2 的兼容性迭代。**

- 逐文件核对安装版 0.2.1-rc.2 与 npm 0.2.1-rc.2：`surface.js`、`v3-to-v4`、`agent-loop`
  三个关键文件**逐字节一致**，说明对照结论对实际运行版本成立。
- 实测在新版本上插件存活：`/find`、`/diagnose` 正常；`agent.phase` / `loopCtx` 仍可访问，
  计数器同步方案的结构前提未变（会话日志轮次 `1..30` 连续无重复）。
- 新增 `cordis.patch.yml`：插件现在既能作为 profile 相对路径行挂载，也能作为 bundle 安装。
- 新增 `tools/verify-host.mjs`：升级后一键自检（读日志 → 打 `/find` `/diagnose` → 判定 `canSync`）。
- 新增 `docs/COMPATIBILITY.md`：0.2.0-rc.2 → 0.2.1-rc.2 的逐项证据与残余风险。
- `files` 字段补齐 `docs`、`tools`。

## 0.1.0 — 2026-10-15

首版。
- 助手消息动作行「改上下文」按钮 + 面板：改写（正文 + 思考）、抹掉、还原原样。
- 宿主半体：`/find`（按 messageId 定位活会话）、`/apply`（三种模式）、`/diagnose`（只读探针）。
- `syncAgentTurnCounter`：写入合成轮次后同步宿主 `phase.lastTurn`，避免轮次号撞号导致日志被拒。
- 新消息使用全新 `messageId`；`stream` 与 content 自洽生成。
