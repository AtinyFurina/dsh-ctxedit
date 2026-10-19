// 统一解析宿主源码（@deepseek-ai/*）的位置。
//
// 优先级：
//   1. %TEMP%\asar-probe-ineffa\all\dsh\node_modules\@deepseek-ai（普通 node 可读）
//   2. Electron-as-node 下直接用 app.asar 内的路径
//   3. 都不可用 → 抛出带运行指引的错误
//
// 用法：
//   import { resolveHarness } from './_lib/harness.mjs'
//   const HARNESS = resolveHarness()
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEMP_HARNESS = path.join(os.tmpdir(), 'asar-probe-ineffa', 'all', 'dsh', 'node_modules', '@deepseek-ai');
const ASAR_HARNESS = 'C:/Users/AtinyFurina/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';

/**
 * @returns {string} 可直接拼 `file:///${harness}/<pkg>/lib/index.js` 的目录。
 */
export function resolveHarness() {
  if (fs.existsSync(path.join(TEMP_HARNESS, 'dsh-session', 'lib', 'index.js'))) return TEMP_HARNESS;
  if (process.versions.electron) return ASAR_HARNESS;
  throw new Error([
    '宿主源码不可读。两种运行方式：',
    '  1) $env:ELECTRON_RUN_AS_NODE="1"; & "<DeepSeek Harness.exe>" <script>',
    '  2) 生成 %TEMP%\\asar-probe-ineffa 抽出物后，用普通 node 运行',
  ].join('\n'));
}
