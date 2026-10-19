# dsh-ctxedit-project — 迁移清单

从「日常对话」会话里一整套做出来的东西，2026-10-15 归拢到本目录。

## 目录内容

| 路径 | 是什么 |
|---|---|
| `lib\index.js` | **插件宿主半体**：`/find`、`/apply`、`/diagnose` 三条路由 + `syncAgentTurnCounter`（宿主轮次计数器同步） |
| `lib\client.js` | **插件浏览器半体**：助手消息动作行的「改上下文」按钮 + 编辑面板（改写 / 抹掉 / 还原原样） |
| `package.json` | 插件清单：`dsh.bundle.patch` 与 `dsh.client` 两侧声明（版本 **0.2.0**） |
| `cordis.patch.yml` | bundle patch：让插件既能作为 profile 相对路径行挂载，也能作为 bundle 安装 |
| `CHANGELOG.md` | 版本记录（0.2.0 = 0.2.1-rc.2 兼容性迭代） |
| `README.md` | 机制说明、**为什么必须同步计数器**、私有字段风险、接口、限制、回滚 |
| `docs\COMPATIBILITY.md` | **DSH 0.2.0-rc.2 → 0.2.1-rc.2 兼容性核查**（升级前对照 + 升级后实测记录） |
| `tools\*.mjs` | 归拢后的验证/修复工具（见下） |
| `tools\lab\*.mjs` | 当初把机制试出来的原始脚本（写盘注入那一版；历史存档，不推荐再用） |
| `_upgrade-probe\` | 0.2.1-rc.2 的 npm 包与 0.2.0 的 asar 抽取物（做 diff 用；确认升级无误后可删） |
| `_pre-upgrade-backup-*\` | 升级前的 profile 补丁/清单 + 插件源码副本（回退用） |

## 工具一览

| 脚本 | 用途 | 依赖 |
|---|---|---|
| `tools\verify-host.mjs` | **升级后自检**：读会话日志 → 打 `/find` `/diagnose` → 判定计数器同步仍可用 | 运行中的 GUI |
| `tools\check-log.mjs` | 只读打印任意会话日志结构：轮次号、可见节点、替换事件、重复检查 | 无（纯 node） |
| `tools\verify-template.mjs` | 拿真实日志 + 真实校验器验证写入模板 | 见下「外部依赖」 |
| `tools\fix-turns.mjs` | 修复「重复轮次号」（先 dry-run，`--write` 落盘；**需 DSH 已关闭**） | 见下 |
| `tools\repair-dup.mjs` | 清理同 `messageId` 的重复可见版本（dry-run 默认） | 无 |
| `tools\test-restore.mjs` / `test-carrier.mjs` | 离线验证「还原」与「载体角色」两条路径 | 见下 |
| `tools\test-prompt-ops.mjs` | 离线验证提问侧三种模式（就地改 / 改并回退 / 撤回） | 安装版 0.2.1 校验器 |

## 外部依赖（重要）

`verify-template.mjs`、`fix-turns.mjs`、`test-restore.mjs`、`test-carrier.mjs` 里的 `HARNESS` 常量指向
**从 app.asar 抽出来的 @deepseek-ai 包**：

```
C:\Users\AtinyFurina\AppData\Local\Temp\asar-probe-ineffa\all\dsh\node_modules\@deepseek-ai
```

那是**临时目录**（会被系统清理），且节点脚本要用 Electron 当 node 跑：

```powershell
$env:ELECTRON_RUN_AS_NODE="1"
& "C:\Users\AtinyFurina\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" tools\check-log.mjs <日志路径>
```

要重新生成这份抽取物：从 `resources\app.asar` 里解出 `dsh\node_modules\@deepseek-ai\*`
（asar 头部 12 字节处 4 字节 = headerSize，数据区起点 = 16 + headerSize）。
只用 `check-log.mjs` 的话不需要这些 —— 它是纯 node 脚本。

## 还留在原处的东西（没搬）

| 位置 | 内容 | 说明 |
|---|---|---|
| `~\Desktop\日常对话\_ctxedit-lab\` | 隔离测试环境：`profiles\headless`、`profiles\web-test`、`sessions\`、`storages\` | 数据目录（含测试会话日志）；脚本已抽走，剩下的可整目录删 |
| `~\.dsh\profiles\desktop\plugins\dsh-ctxedit` | **目录联接（Junction）** → 指向本目录 | 让 DSH 仍按相对路径 `./plugins/dsh-ctxedit/lib/index.js` 挂载；插件改动不需要重启，宿主半体改动需重启 DSH |
| `~\.dsh\profiles\desktop\plugins\_ctxedit-backup-20261015-081908` | 迁移前的原插件副本 | 确认无误后可删 |
| `cordis.patch.yml` 末尾 | 插件注册行（标了 `dsh-ctxedit` 注释块） | 停用插件 = 删这段 insert |

## 已知结论（写进 README 的那几条，别再踩）

1. **改写助手消息只能靠「合成轮次 + 非 assistant 载体遮蔽」**：`assistant/message` 不能带 `sourceEventSeqs`，
   而 `user/message` 的 `role` 被强制为 `user`。想「保持 assistant 身份的原地编辑」在当前版本无解。
2. **合成轮次写完必须同步宿主计数器**（`agent.phase.lastTurn = 投影 lastTurn`），否则宿主下一轮复用同一个号 →
   日志出现重复轮次号 → 关系校验器拒收整条日志（`turn/start does not open the expected turn`）。
3. **新消息必须用新的 messageId**：复用原 id 会让客户端把改写版当成旧版「重新生成」，用户新内容消失。
4. **`stream` 要与 content 自洽**（block-end 序列），否则历史代迁移校验器会拒。
5. **只能写「每个轮次+步骤都闭合」的会话**；agent 运行时写入会污染在跑的轮次。
