# B 站 / 小红书 视频发布稿

## 视频文件

| 平台 | 文件 | 规格 |
|---|---|---|
| B 站 | `docs/promo/video/bilibili-1080p.mp4` | 1920×1080 · 30fps · 24s · H.264 + AAC（MIDI 配乐） |
| 小红书 | `docs/promo/video/xiaohongshu-vertical.mp4` | 1080×1920 · 30fps · 24s · H.264 + AAC（MIDI 配乐） |

封面：`docs/promo/social-preview.png`（B 站可再用 `docs/promo/video/code/h.html` 渲一帧）

## B 站

**标题（≤80 字）**

```
给 DeepSeek Harness 写了个插件：在对话里改写 / 回退 / 还原上下文（开源）
```

**简介**

```
dsh-ctxedit：DeepSeek Harness 的上下文编辑插件。

它能做三件事：
· 改写回复——模型下一轮读新版，原始会话日志一个字节都不动；
· 就地回退——点用户消息左侧的 ↩，这条及之后移出模型视野，界面同步隐藏；
· 还原原稿——改写过的内容能沿血统找回最初版本。

机制：append-only 日志 + surface 遮蔽（空载体 + 合成轮次）+ 宿主轮次计数器同步。
踩过的坑都写在 README 与 docs/AUDIT 里。

开源（MIT）：https://github.com/AtinyFurina/dsh-ctxedit

限制：目前只对 DSH 0.2.1-rc.2 实测；每次就地编辑会向模型请求注入 1 条空 user 消息。
```

**标签**：软件应用 · 编程 · 开源 · AI · DeepSeek

**分区**：科技 → 软件应用

## 小红书

**标题**

```
给 AI 的记忆加一个编辑键
```

**正文**

```
用 DeepSeek Harness 的人大概都遇到过：想让模型「忘掉」某句回答，只能重开会话，前面的上下文全没了。

我给 Harness 写了个插件 dsh-ctxedit，直接在对话里改：

✅ 改写回复：模型下一轮读新版，原日志不动
✅ 就地回退：点你那条消息左边的 ↩，这条之后全部移出模型视野，界面也跟着隐藏
✅ 还原原稿：改坏了能找回最初版本

不是删日志，是「让模型读不到」。所以卸载插件，旧内容会原样回来。

开源地址看评论区（或 GitHub 搜 dsh-ctxedit）

#DeepSeek #AI工具 #开源 #效率工具
```

**配图/封面**：视频本身；封面用 `docs/promo/social-preview.png`。

## 发布检查

- 视频是 22 秒竖/横两版，B 站建议加「未经作者授权禁止转载」；
- 小红书外链限流：正文不写链接，链接放评论区第一条；
- 若平台要求封面，用 social-preview.png 裁 16:9 / 3:4。

