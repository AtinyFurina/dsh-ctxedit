# 宣传素材（launch copy）

> 仓库：https://github.com/AtinyFurina/dsh-ctxedit
> 社交预览图：`docs/promo/social-preview.png`（1280×640，GitHub 设置 → Social preview 手动上传）

## 一句话

**dsh-ctxedit**：给 DeepSeek Harness 加一个「改上下文」按钮——改写模型读到的回复、就地回退、还原原稿，原始会话日志一个字节都不动。

## 三条卖点

1. **改的是模型记忆，不是日志**。append-only 日志原样保留，卸载插件旧内容就回来。
2. **就地回退**。用户消息左侧一个图标，点了这条及其后移出模型视野，界面同步隐藏，原文进剪贴板。
3. **可还原**。改写过的回复能从血统里找回最初版本（0.5.1 起支持）。

## X / Twitter（中文）

> 给 DeepSeek Harness 写了个插件：dsh-ctxedit。
>
> 在消息上直接「改上下文」——改写模型下一轮读到的回复、就地回退到某条提问、还原原稿。原始会话日志不动，卸载插件旧内容就回来。
>
> 机制是逆向 surface 语义：空载体遮蔽 + 合成轮次 + 宿主轮次计数器同步。踩坑记录全在 docs/AUDIT。
>
> https://github.com/AtinyFurina/dsh-ctxedit

## X / Twitter（English）

> Built a plugin for DeepSeek Harness: dsh-ctxedit.
>
> Edit what the model reads next turn — rewrite a reply, rewind to a user message in place, or restore the original. The append-only session log stays untouched.
>
> Under the hood: surface shadowing via non-assistant carriers + synthetic turns + host turn-counter sync.
>
> https://github.com/AtinyFurina/dsh-ctxedit

## 小红书

标题：给 AI 的「记忆」加一个编辑键

正文：

用 DeepSeek Harness 的人大概都遇到过：想让模型「忘掉」某句回答，只能重开会话，前面的上下文全没了。

我给 Harness 写了个插件 dsh-ctxedit，直接在对话里改：

✅ 改写回复：模型下一轮读新版，原日志不动
✅ 就地回退：点你那条消息左边的 ↩，这条之后全部移出模型视野，界面也跟着隐藏
✅ 还原原稿：改坏了能找回最初版本

不是删日志，是「让模型读不到」。所以卸载插件，旧内容会原样回来。

开源地址放评论区，自取。

#DeepSeek #AI工具 #开源 #效率工具 #Harness

## V2EX / LINUX DO

标题：［开源］dsh-ctxedit：给 DeepSeek Harness 的上下文编辑插件

正文：

DSH 的会话日志是 append-only，客户端只渲染追加事件、不折叠替换事件。这个插件利用 surface 语义，做了三件事：

- 改写：合成一个合法轮次承载新回复，用空 user 载体遮蔽旧节点；
- 回退：区间遮蔽 + 客户端视图过滤（zones.json / deadTurns），界面同步隐藏；
- 还原：载体上记 `source.replacedBy`，`/find` 反向回溯到最初版本。

踩过的硬约束都写在 README：assistant 不能带 sourceEventSeqs、turn 号必须严格连续、合成轮次后要同步宿主 `phase.lastTurn`、空 user 载体仍会投影成一条空消息（已知代价）。

限制：只支持当前 0.2.1-rc.2；依赖宿主内部结构（client DOM 选择器、phase 私有字段），升级可能失效；有内部审计文档记录全部证据。

仓库：https://github.com/AtinyFurina/dsh-ctxedit

## Hacker News / Reddit（English）

**Show HN: dsh-ctxedit – Edit what an LLM agent remembers, without touching its log**

DeepSeek Harness keeps an append-only session log and a derived "surface" (what the model sees). This plugin appends replacement carriers to shadow nodes on that surface, so you can rewrite a reply, rewind to a message in place, or restore the original — while the raw log stays byte-identical.

Hard parts: assistant messages can't carry `sourceEventSeqs`; synthetic turns must keep the host's turn counter contiguous; the client doesn't fold replacements, so the UI needs a separate view filter (zones + dead turns).

Repo + audit notes: https://github.com/AtinyFurina/dsh-ctxedit

## 安装（贴在任何文案后面）

```powershell
git clone https://github.com/AtinyFurina/dsh-ctxedit.git
# 把目录放进 ~/.dsh/profiles/desktop/plugins/，并在 cordis.patch.yml 末尾注册：
# - insert:
#     - id: dsh-ctxedit
#       name: ./plugins/dsh-ctxedit/lib/index.js
# 重启 DSH；客户端改动刷新页面即可
```

## 配图建议

- 封面：`docs/promo/social-preview.png`；
- 第二张：真实对话截图（打码会话 id），展示「改写前 / 改写后」与左侧回溯图标；
- 第三张：面板截图（左导航 + 编辑/预览），展示 Markdown 实时预览。

## 诚实披露（建议保留）

- 目前只对 DSH `0.2.1-rc.2` 实测；依赖宿主内部结构，升级可能失效；
- 每次就地编辑会向模型请求注入 1 条空 user 消息（已知代价）；
- 0.5.1 之前做过的改写没有 `replacedBy`，无法还原；
- 插件通过回环 HTTP 路由工作，仅限本机。
