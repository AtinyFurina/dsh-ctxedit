# 兼容性对照：DSH 0.2.0-rc.2 → 0.2.1-rc.2

核查日期：2026-10-18（升级前对照）；**2026-10-19 升级后实测通过**。
方法：从 npm 拉 `@deepseek-ai/*@0.2.1-rc.2` 真实包，与本机 0.2.0-rc.2（app.asar 内）逐文件 diff；
升级后把**安装版** 0.2.1-rc.2 的同名文件再抽出来与 npm 包对比，并用 `tools/verify-host.mjs` 实测运行中的宿主。

## 结论

**0.2.1-rc.2 不破坏 dsh-ctxedit —— 已升级并实测。** 插件依赖的接缝全部保留；
会话格式仍是 v4，没有格式跳代。

## 升级后实测记录（2026-10-19）

| 项 | 结果 |
|---|---|
| 安装版本 | `0.2.1-rc.2`，commit `332895e0f7c9d4dbfb29729f5eb367fa263ff986` |
| 安装版 vs npm 包（surface.js / v3-to-v4 / agent-loop） | `git diff` **无差异**（三个文件逐字节一致） |
| `/api/dsh-ctxedit/find`（真实 messageId） | ✅ 200，正确定位 `session=63617a50 seq=2724 openTurn=30` |
| `/api/dsh-ctxedit/diagnose` | ✅ 200，`hasPhase: true` `hasLoopCtx: true`，`projectedLastTurn: 30` 与日志 `maxTurnInLog: 30` 一致 |
| 会话日志读取 | ✅ 2747 事件、轮次 `1..30` 严格连续、无重复、seq 无撕裂 |
| `verify-host.mjs` | ✅ 7 项全过（当时 agent 在跑，`canSync` 按护栏为 false，属预期） |
| 客户端 GUI 端口 | 从 19387 变为 **53008**（应用重启换了端口，属正常行为；插件路由随之可用） |

> 说明：升级前的最后一轮「预检查」结论完全被实测证实；唯一没能在升级前核对的是
> Electron 桌面壳对 `profile 相对路径行 + 目录联接` 的解析——实测证明**仍然有效**
> （插件行 `./plugins/dsh-ctxedit/lib/index.js` 经 Junction 正常加载）。

## 逐项证据

| 插件依赖的东西 | 0.2.1-rc.2 现场 | 结论 |
|---|---|---|
| 会话格式版本 | `dsh-session/lib/index.js:56` → `SESSION_FORMAT_VERSION = 4`；npm 上无 `dsh-session-format-v4-to-v5` | 不变 |
| 表面替换校验 `surfaceOp` / `sourceEventSeqs` | `dsh-session/lib/types/surface.js` 与 0.2.0 的 diff：**只有注释改动**（2 增 8 删，全在注释） | 语义不变 |
| `assistant/message` 禁止携带 `sourceEventSeqs` | `surface.js:233` 原文仍在 | 不变 |
| 角色强制 `must have role "user"` | `dsh-session/lib/types/index.js:264` | 不变 |
| 结算字段 `turn/step/stream` 校验 | `dsh-session/lib/types/index.js:215` 原文仍在 | 不变 |
| 轮次/步骤状态机（含 `turn/start does not open the expected turn`） | `dsh-session-format-v3-to-v4/lib/index.js` 与 0.2.0 只差 **1 行**，且是 subagent catalog 的新版本事实 | 不变 |
| 宿主轮次计数器 `phase.lastTurn` | `dsh-agent-loop/lib/index.js:753` 公开字段 `phase;`、`:772` `this.loopCtx = loopCtx`、`:783-786` `this.phase = { kind: "idle", lastTurn }`、`:943` `const turn = phase.turn + 1` | 结构不变，同步方案仍成立 |
| 轮次投影 `turnBoundary` 定义 | 与 0.2.0 **逐字节相同**（片段 SHA256 前 16 位 `C5D77BCCC3EEDAA8`） | 不变 |
| `session.surface` / `snapshotEvents()` / `append()` | `dsh-session/lib/types/index.js:411` / `:572` / `:638` | 不变 |
| `ctx.get('sessions').get/list/flush` | `SessionStore` 类在 `dsh-session/lib/types/index.js:861`，`get:1158` / `list:1165` / `flush:1125` | 不变 |
| `ctx.get('agents').get(id)` | `dsh-agent/lib/index.js:596` → `this.store.get(id)?.agent` | 不变 |
| `ctx.webServer.register({kind,path,handler})` | `dsh-host-webserver/lib/index.js:326` | 不变 |
| 客户端模块加载器 `window.__ModuleLoader__.load({id,factory})` | `dsh-client-modules/lib/client.js` 仍有，且 `:758` 校验「必须通过它注册」 | 不变 |
| 槽位 `conversation.chat.assistant-actions` | `dsh-client-ui-chat/lib/client.js:7275`（`kind: "list", scope: "session"`）；`:6988` 仍以 `{ messageId }` 渲染 | 不变 |
| 槽位 `shell.overlay` | `dsh-client-ui-layout/lib/client.js:643` | 不变 |
| `ctx.slots.inject` / `ctx.slots.register` | `dsh-client-ui-slots/lib/index.js:163` `register(options, component)`；内置插件仍用 `ctx.slots.inject`（chat 23 处、conversation 3 处） | 不变 |
| `dsh.bundle.patch` / `dsh.client` 清单约定 | `dsh-app-boot/lib/index.js:517-530`；`dsh-client-modules` 仍解析 `dsh.client` | 不变 |
| peerDependencies 门禁 | `dsh-app-boot/lib/index.js:286-302`：**只校验 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`**，其它 peer 忽略 | 本插件只声明 `react`，不触发门禁 |

`dsh-session/lib/types/index.js` 另有 +123 行新增（`plugin:` 记录 API，`session.appendRecord` 一类）
与 7 行删除（append 路径抽成 `publicationEntry()` 的重构）——都不触碰替换/结算校验。

## 残余风险（诚实标注）

1. **Electron 外壳（主进程）不在 npm 包里**：无法在升级前核对 0.2.1 桌面壳是否改变了
   「profile 相对路径行 / 目录联接」的解析。app-boot 的约定未变，风险低但未实测。
2. **`dsh-client-ui-chat` 客户端 bundle 改动很大**（+6198 / −5373 行）：槽位契约没变，
   但主题变量/动作行排版可能有微调 → 按钮与面板**外观**可能略有出入，功能不受影响。
3. 0.2.1 可能对**已有日志**新增更严的准入规则（我们只核对了 v3-to-v4 迁移校验器与
   surface 校验器，未逐条核对整个 `dsh-session-format` 家族）。升级后跑一次
   `tools/verify-host.mjs` + 打开旧会话即可确认。

## 升级后自检清单

```powershell
# 1) 插件路由是否活着（预期：ok 或 404「找不到这条消息」= 处理器在）
curl http://127.0.0.1:19387/api/dsh-ctxedit/find?messageId=probe

# 2) 一键自检（读会话日志 + 打两条只读接口）
$env:ELECTRON_RUN_AS_NODE="1"
& "C:\Users\AtinyFurina\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" `
  tools\verify-host.mjs <会话日志路径>
```

自检会打印：宿主版本线索、最后一条可见助手消息、`/find` 结果、`/diagnose` 的
`phaseKind / phaseLastTurn / projectedLastTurn / canSync`。**`canSync` 必须是 `true`
（会话空闲时）**，否则说明计数器同步失效 —— 此时插件会降级为「改写后需重开会话」，
按 README 的「升级 DSH 后第一件事」处理。
