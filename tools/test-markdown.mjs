// 离线验证内置 Markdown 兜底渲染器：从 client.js 里抽出 renderInline/renderMarkdown，
// 用假 React 执行，检查块级/行内节点结构。
import fs from 'node:fs';

const source = fs.readFileSync(process.argv[2], 'utf8');
const start = source.indexOf('function renderInline(');
const end = source.indexOf('function MarkdownEditor(');
if (start < 0 || end < 0 || end <= start) { console.log('❌ 找不到渲染器源码'); process.exit(1) }
const snippet = source.slice(start, end);

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
};
const factory = new Function('React', `${snippet}\nreturn { renderInline, renderMarkdown };`);
const { renderMarkdown } = factory(fakeReact);

const md = [
  '# 标题一',
  '',
  '段落 **粗体** 和 *斜体* 和 `code` 和 [链接](https://example.com)。',
  '',
  '- 项目 A',
  '- 项目 B',
  '',
  '1. 第一',
  '2. 第二',
  '',
  '> 引用',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '---',
].join('\n');

const tree = renderMarkdown(md);
const types = tree.children.map((c) => c.type);
const flat = JSON.stringify(tree);

let fail = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`); if (!ok) fail += 1 };

check(types.includes('h1'), '标题 → h1', types.join(','));
check(types.includes('ul'), '无序列表 → ul');
check(types.includes('ol'), '有序列表 → ol');
check(types.includes('blockquote'), '引用 → blockquote');
check(types.includes('pre'), '围栏代码 → pre');
check(types.includes('hr'), '分隔线 → hr');
check(flat.includes('"strong"'), '粗体 → strong');
check(flat.includes('"em"'), '斜体 → em');
check(flat.includes('"code"'), '行内代码 → code');
check(flat.includes('"a"') && flat.includes('https://example.com'), '链接 → a[href]');
check(flat.includes('const a = 1'), '代码内容完整');
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
