/**
 * dsh-ctxedit — browser half.
 *
 * 两个界面：
 *   1. 助手消息动作行里的「改上下文」按钮（conversation.chat.assistant-actions）
 *   2. 点击后弹出的编辑面板（shell.overlay）：可改「回复正文」和「思考过程」，
 *      也可以把这条回复从模型可见历史里抹掉。
 *
 * 模块契约：window.__ModuleLoader__.load({ id, factory })，factory 返回 { inject, apply }。
 * 纯 React，无 JSX，无打包器。定位只靠 messageId —— 宿主自己在所有活会话里找。
 */
window.__ModuleLoader__.load({
  id: '@atinyfurina/dsh-ctxedit',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useState, useEffect } = React

    const API = { find: '/api/dsh-ctxedit/find', apply: '/api/dsh-ctxedit/apply' }
    // 全部颜色走 DSH 主题 token（--dsw-alias-*），亮色/暗色自动跟随；fallback 只是兜底。
    const CSS = `
.dshce-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 6px;
  border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75));cursor:pointer;
  font-size:var(--dsh-content-font-size-secondary,13px);line-height:1;font-family:inherit}
.dshce-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9))}
.dshce-btn[disabled]{opacity:.3;cursor:default}
.dshce-tip{position:relative;display:inline-flex}
.dshce-tip::after{content:attr(data-tip);position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);z-index:30;
  width:max-content;max-width:240px;padding:4px 8px;border-radius:6px;
  font-size:11px;line-height:14px;text-align:center;white-space:nowrap;
  pointer-events:none;opacity:0;transition:opacity .12s;
  background:var(--dsw-alias-tooltip-bg,#353638);color:var(--dsw-alias-toast-label,#fff);
  box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,.25))}
.dshce-tip:hover::after,.dshce-tip:focus-within::after{opacity:1}
.dshce-mask{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4));
  display:flex;align-items:center;justify-content:center;padding:24px}
.dshce-card{width:min(1100px,100%);height:min(88vh,920px);max-height:92vh;overflow:hidden;
  --dshce-fs:var(--dsh-content-font-size,14px);
  --dshce-fs-2:var(--dsh-content-font-size-secondary,13px);
  --dshce-fs-3:calc(var(--dsh-content-font-size,14px) - 3px);
  display:flex;flex-direction:column;border-radius:var(--dsw-radius-xl,20px);
  background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2,#fff));color:var(--dsw-alias-label-primary,#1b1b1f);
  border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));
  box-shadow:var(--dsw-elevation-prominent,0 18px 60px rgba(0,0,0,.34));padding:18px 20px 16px;box-sizing:border-box}
.dshce-confirm{width:min(440px,100%);height:auto;max-height:min(70vh,420px);overflow:auto;padding:18px 20px 16px}
.dshce-confirm-msg{font-size:var(--dshce-fs-2);line-height:1.65;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
  white-space:pre-wrap;margin:8px 0 0}
.dshce-title{font-size:calc(var(--dshce-fs) + 1px);font-weight:600;margin:0 0 6px;color:var(--dsw-alias-label-primary,#1b1b1f)}
.dshce-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:2px}
.dshce-head .dshce-title{margin:0}
.dshce-x{width:28px;height:28px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);
  font-size:18px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dshce-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#1b1b1f)}
.dshce-sub{font-size:var(--dshce-fs-2);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));margin:0 0 4px;line-height:1.55}
.dshce-meta{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}
.dshce-chip{font-size:var(--dshce-fs-3);line-height:20px;padding:0 8px;border-radius:6px;
  background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.08));
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7))}
.dshce-hint{font-size:var(--dshce-fs-3);color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));font-weight:400;margin-left:6px}
.dshce-body{display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px;margin-top:12px;flex:1;min-height:0}
.dshce-nav{display:flex;flex-direction:column;gap:2px;border-right:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));padding-right:10px;overflow:auto}
.dshce-nav-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;
  border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
  font-size:var(--dshce-fs);line-height:20px;cursor:pointer;font-family:inherit;text-align:left}
.dshce-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dshce-nav-item[aria-selected="true"]{background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.12));
  color:var(--dsw-alias-label-primary,#1b1b1f);font-weight:500}
.dshce-nav-hint{font-size:var(--dshce-fs-3);color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));font-weight:400;flex:none}
.dshce-detail{min-width:0;min-height:0;display:flex;flex-direction:column}
.dshce-detail .dshce-field{border-top:0;margin-top:0;padding-top:0;flex:1;min-height:0;display:flex;flex-direction:column}
.dshce-detail .dshce-area{flex:1;min-height:0;height:100%}
.dshce-detail .dshce-preview{flex:1;min-height:0;height:100%;max-height:none}
@media (max-width:820px){
  .dshce-body{grid-template-columns:1fr;min-height:0}
  .dshce-nav{flex-direction:row;border-right:0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));padding:0 0 8px}
  .dshce-nav-item{flex:1;justify-content:center}
  .dshce-detail .dshce-area,.dshce-detail .dshce-preview{min-height:240px}
}
.dshce-field{border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));padding:12px 0 2px;margin-top:8px}
.dshce-field-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.dshce-field-title{font-size:var(--dshce-fs);font-weight:600;color:var(--dsw-alias-label-primary,#1b1b1f);min-width:0}
.dshce-tabs{display:inline-flex;gap:2px;padding:2px;border-radius:8px;
  background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.08))}
.dshce-tab{height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75));font-size:var(--dshce-fs-2);cursor:pointer;font-family:inherit}
.dshce-tab:hover{color:var(--dsw-alias-label-primary,#1b1b1f)}
.dshce-tab-on{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1b1b1f);
  box-shadow:0 0 0 .5px var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.dshce-area{width:100%;box-sizing:border-box;border-radius:var(--dsw-radius-md,9px);
  border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));
  background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.07));color:inherit;
  font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:var(--dshce-fs-2);line-height:1.6;
  padding:10px 12px;resize:vertical;outline:none;min-height:140px}
.dshce-area:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshce-preview{min-height:140px;max-height:300px;overflow:auto;padding:10px 12px;border-radius:var(--dsw-radius-md,9px);
  border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.05));
  font-size:var(--dshce-fs);line-height:1.65;color:var(--dsw-alias-label-primary,#1b1b1f)}
.dshce-md>:first-child{margin-top:0}
.dshce-md>:last-child{margin-bottom:0}
.dshce-md h1,.dshce-md h2,.dshce-md h3,.dshce-md h4,.dshce-md h5,.dshce-md h6{margin:12px 0 6px;font-weight:600;line-height:1.3}
.dshce-md h1{font-size:1.35em}.dshce-md h2{font-size:1.2em}.dshce-md h3{font-size:1.05em}.dshce-md h4,.dshce-md h5,.dshce-md h6{font-size:1em}
.dshce-md p{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}
.dshce-md ul,.dshce-md ol{margin:0 0 8px;padding-left:20px}
.dshce-md li{margin:2px 0}
.dshce-md blockquote{margin:0 0 8px;padding:2px 10px;
  border-left:2px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.4));
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85))}
.dshce-md pre{margin:0 0 8px;padding:10px 12px;border-radius:8px;overflow:auto;
  background:var(--dsw-alias-markdown-code-block,rgba(127,127,127,.12));
  font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:var(--dshce-fs-2);line-height:1.55}
.dshce-md code{font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:.92em;
  padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-code-block,rgba(127,127,127,.14))}
.dshce-md pre code{padding:0;background:transparent;font-size:inherit}
.dshce-md a{color:var(--dsw-alias-state-business-primary,#4d6bfe);text-decoration:none}
.dshce-md a:hover{text-decoration:underline}
.dshce-md hr{border:0;border-top:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.3));margin:12px 0}
.dshce-md em{font-style:italic}
.dshce-md strong{font-weight:600}
.dshce-md table{border-collapse:collapse;margin:0 0 8px}
.dshce-md th,.dshce-md td{border:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.3));padding:4px 8px}
.dshce-row{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:16px;flex-wrap:wrap}
.dshce-foot{border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));padding-top:12px;margin-top:14px}
.dshce-row-tight{margin-top:8px;margin-bottom:6px}
.dshce-note{margin-right:auto;font-size:var(--dshce-fs-2);line-height:1.5;max-width:62%}
.dshce-ok{color:var(--dsw-alias-state-business-primary,#2ea44f)}
.dshce-err{color:var(--dsw-alias-state-error-primary,#e5484d)}
.dshce-warn{color:var(--dsw-alias-state-warn-primary,#c47f17)}
.dshce-primary,.dshce-ghost,.dshce-danger{height:32px;padding:0 14px;border-radius:9px;font-size:var(--dshce-fs-2);
  cursor:pointer;font-family:inherit;border:1px solid transparent}
.dshce-primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff}
.dshce-primary[disabled]{opacity:.5;cursor:default}
.dshce-ghost{background:transparent;border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.34));color:inherit}
.dshce-ghost:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dshce-danger{background:transparent;border-color:var(--dsw-alias-state-error-primary,rgba(229,72,77,.5));
  color:var(--dsw-alias-state-error-primary,#e5484d)}
.dshce-list{display:flex;flex-direction:column;gap:6px;max-height:46vh;overflow:auto;margin:10px 0 0;padding:0;list-style:none}
.dshce-item{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;
  border:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.22));border-radius:9px}
.dshce-item-body{flex:1;min-width:0}
.dshce-item-text{font-size:var(--dshce-fs);line-height:1.5;white-space:pre-wrap;word-break:break-word;
  max-height:4.6em;overflow:hidden}
.dshce-item-meta{font-size:var(--dshce-fs-3);color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));margin-top:3px}
.dshce-item-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start}
.dshce-mini{height:26px;padding:0 9px;font-size:var(--dshce-fs-3);border-radius:7px;
  border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.34));
  background:transparent;color:inherit;cursor:pointer;font-family:inherit}
.dshce-mini[disabled]{opacity:.4;cursor:default}
.dshce-mini:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dshce-mini-primary{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshce-mini-danger{border-color:var(--dsw-alias-state-error-primary,rgba(229,72,77,.5));color:var(--dsw-alias-state-error-primary,#e5484d)}
.dshce-actions{position:absolute;right:100%;top:50%;transform:translateY(calc(-50% - 1px));margin-right:6px;display:flex}
.dshce-actions-inline{position:static;transform:none;margin:2px 0 0;justify-content:flex-end}
.dshce-icon-btn{width:26px;height:26px;padding:0;border:0;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;
  background:transparent;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75));cursor:pointer;opacity:.7}
.dshce-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));
  color:var(--dsw-alias-label-primary,#1b1b1f);opacity:1}
.dshce-icon-btn[disabled]{opacity:.4;cursor:default}
.dshce-icon-btn svg{width:15px;height:15px}
`

    // 共享状态：按钮只负责「打开面板」，真正的读写都在面板里做
    const store = { request: null, listeners: new Set() }
    function subscribe(listener) {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    }
    function openPanel(request) {
      store.request = { ...request, nonce: Date.now() }
      for (const listener of [...store.listeners]) listener()
    }
    function closePanel() {
      store.request = null
      for (const listener of [...store.listeners]) listener()
    }

    // ------------------------------------------------------------- 确认框（DSH 风格）
    // 不用 window.confirm（系统原生弹窗，和界面风格不统一）。
    const confirmStore = { current: null, resolve: null, listeners: new Set() }
    function subscribeConfirm(listener) {
      confirmStore.listeners.add(listener)
      return () => confirmStore.listeners.delete(listener)
    }
    function notifyConfirm() {
      for (const listener of [...confirmStore.listeners]) listener()
    }
    function askConfirm(options) {
      return new Promise((resolve) => {
        confirmStore.current = options
        confirmStore.resolve = resolve
        notifyConfirm()
      })
    }
    function settleConfirm(result) {
      const resolve = confirmStore.resolve
      confirmStore.current = null
      confirmStore.resolve = null
      notifyConfirm()
      if (typeof resolve === 'function') resolve(result)
    }

    function ConfirmDialog() {
      const [current, setCurrent] = useState(confirmStore.current)
      useEffect(() => subscribeConfirm(() => setCurrent(confirmStore.current)), [])
      useEffect(() => {
        if (current === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') settleConfirm(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [current])
      if (current === null) return null
      return React.createElement('div', {
        className: 'dshce-mask',
        onClick: (event) => { if (event.target === event.currentTarget) settleConfirm(false) },
      }, React.createElement('div', { className: 'dshce-card dshce-confirm' }, [
        React.createElement('h2', { key: 't', className: 'dshce-title' }, current.title ?? '确认'),
        React.createElement('p', { key: 'm', className: 'dshce-confirm-msg' }, current.message ?? ''),
        React.createElement('div', { key: 'row', className: 'dshce-row' }, [
          React.createElement('button', {
            key: 'c', type: 'button', className: 'dshce-ghost',
            onClick: () => settleConfirm(false),
          }, current.cancelText ?? '取消'),
          React.createElement('button', {
            key: 'o', type: 'button', className: current.danger ? 'dshce-danger' : 'dshce-primary',
            onClick: () => settleConfirm(true),
          }, current.confirmText ?? '确定'),
        ]),
      ]))
    }

    async function callJson(url, options) {
      const response = await fetch(url, options)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    // ------------------------------------------------------------- 按钮
    function EditButton(props) {
      const messageId = props.messageId
      if (typeof messageId !== 'string' || messageId.length === 0) return null
      const button = React.createElement('button', {
        type: 'button',
        className: 'dshce-btn',
        'aria-label': '更改输出',
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          openPanel({ messageId })
        },
      }, React.createElement('svg', {
        width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, [
        React.createElement('path', { key: 'p1', d: 'M2.5 13.5h3L13 6a1.8 1.8 0 0 0-2.5-2.5L3 11v2.5Z' }),
        React.createElement('path', { key: 'p2', d: 'M9.5 5l2.5 2.5' }),
      ]))
      // 优先用平台 Tooltip：尺寸、圆角、字号与 DSH 自带提示完全一致。
      if (PlatformTooltip !== null) {
        return React.createElement(PlatformTooltip, { label: '更改输出', side: 'bottom' }, button)
      }
      return React.createElement('span', { className: 'dshce-tip', 'data-tip': '更改输出' }, button)
    }

    // ------------------------------------------------------------- Markdown
    // 优先用平台自带的 MarkdownText（与聊天正文同款渲染、同款主题）；
    // 取不到时用下面的轻量渲染器兜底。源码始终在左侧可见，符号不会被吞。
    let PlatformMarkdown = null
    let PlatformTooltip = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      if (primitives !== null && typeof primitives?.MarkdownText === 'function') PlatformMarkdown = primitives.MarkdownText
      if (primitives !== null && typeof primitives?.Tooltip === 'function') PlatformTooltip = primitives.Tooltip
    } catch { /* 平台不提供就用自己的 */ }

    class MarkdownBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch() { /* 静默降级 */ }
      render() {
        return this.state.failed ? this.props.fallback : this.props.children
      }
    }

    /** 行内语法：`code`、**粗体**、*斜体*、[文字](url)。 */
    function renderInline(text, keyBase) {
      const nodes = []
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) {
          nodes.push(React.createElement('code', { key: `${keyBase}-c${index += 1}` }, token.slice(1, -1)))
        } else if (token.startsWith('**')) {
          nodes.push(React.createElement('strong', { key: `${keyBase}-b${index += 1}` }, token.slice(2, -2)))
        } else if (token.startsWith('*')) {
          nodes.push(React.createElement('em', { key: `${keyBase}-e${index += 1}` }, token.slice(1, -1)))
        } else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          nodes.push(React.createElement('a', {
            key: `${keyBase}-a${index += 1}`,
            href: link[2],
            target: '_blank',
            rel: 'noreferrer',
          }, link[1]))
        }
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /** 块级兜底渲染：标题、围栏代码、列表、引用、分隔线、段落。 */
    function renderMarkdown(text) {
      const lines = String(text ?? '').split('\n')
      const blocks = []
      let paragraph = []
      let i = 0
      const flush = () => {
        if (paragraph.length === 0) return
        const key = `p${blocks.length}`
        blocks.push(React.createElement('p', { key }, renderInline(paragraph.join('\n'), key)))
        paragraph = []
      }
      while (i < lines.length) {
        const line = lines[i]
        if (/^```/.test(line)) {
          flush()
          const lang = line.slice(3).trim()
          const body = []
          i += 1
          while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i += 1 }
          i += 1
          blocks.push(React.createElement('pre', { key: `pre${blocks.length}` },
            React.createElement('code', { className: lang.length > 0 ? `language-${lang}` : undefined }, body.join('\n'))))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          flush()
          const level = Math.min(heading[1].length, 6)
          blocks.push(React.createElement(`h${level}`, { key: `h${blocks.length}` }, renderInline(heading[2], `h${blocks.length}`)))
          i += 1
          continue
        }
        if (/^\s*[-*+]\s+/.test(line)) {
          flush()
          const items = []
          while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
            i += 1
          }
          const key = `ul${blocks.length}`
          blocks.push(React.createElement('ul', { key }, items.map((item, k) => React.createElement('li', { key: k }, renderInline(item, `${key}-${k}`)))))
          continue
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          flush()
          const items = []
          while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
            i += 1
          }
          const key = `ol${blocks.length}`
          blocks.push(React.createElement('ol', { key }, items.map((item, k) => React.createElement('li', { key: k }, renderInline(item, `${key}-${k}`)))))
          continue
        }
        if (/^>\s?/.test(line)) {
          flush()
          const body = []
          while (i < lines.length && /^>\s?/.test(lines[i])) {
            body.push(lines[i].replace(/^>\s?/, ''))
            i += 1
          }
          blocks.push(React.createElement('blockquote', { key: `q${blocks.length}` }, renderInline(body.join('\n'), `q${blocks.length}`)))
          continue
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          flush()
          blocks.push(React.createElement('hr', { key: `hr${blocks.length}` }))
          i += 1
          continue
        }
        if (line.trim().length === 0) {
          flush()
          i += 1
          continue
        }
        paragraph.push(line)
        i += 1
      }
      flush()
      return React.createElement('div', { className: 'dshce-md' }, blocks)
    }

    /** 单个字段：标题 + 编辑/预览切换，一次只显示一种视图，避免并排重复。 */
    function MarkdownEditor(props) {
      const { value, onChange, rows, title, hint } = props
      const [mode, setMode] = useState('edit')
      const preview = PlatformMarkdown === null
        ? renderMarkdown(value)
        : React.createElement(MarkdownBoundary, { fallback: renderMarkdown(value) },
          React.createElement(PlatformMarkdown, { text: value }))
      const tabs = React.createElement('div', { key: 'tabs', className: 'dshce-tabs' }, [
        React.createElement('button', {
          key: 'e', type: 'button',
          className: `dshce-tab${mode === 'edit' ? ' dshce-tab-on' : ''}`,
          onClick: () => setMode('edit'),
        }, '编辑'),
        React.createElement('button', {
          key: 'p', type: 'button',
          className: `dshce-tab${mode === 'preview' ? ' dshce-tab-on' : ''}`,
          onClick: () => setMode('preview'),
        }, '预览'),
      ])
      return React.createElement('section', { className: 'dshce-field' }, [
        React.createElement('div', { key: 'head', className: 'dshce-field-head' }, [
          React.createElement('span', { key: 't', className: 'dshce-field-title' },
            title, hint ? React.createElement('span', { className: 'dshce-hint' }, hint) : null),
          tabs,
        ]),
        mode === 'edit'
          ? React.createElement('textarea', {
            key: 'a', className: 'dshce-area', rows, value, spellCheck: false,
            onChange: (event) => onChange(event.target.value),
          })
          : React.createElement('div', { key: 'p', className: 'dshce-preview' }, preview),
      ])
    }

    // ------------------------------------------------------------- 面板
    function Panel() {
      const [request, setRequest] = useState(store.request)
      useEffect(() => subscribe(() => setRequest(store.request)), [])

      const [status, setStatus] = useState('loading')
      const [state, setState] = useState(null)
      const [text, setText] = useState('')
      const [reasoning, setReasoning] = useState('')
      const [pane, setPane] = useState('text')
      const [message, setMessage] = useState(null)
      const [busy, setBusy] = useState(false)

      const nonce = request?.nonce
      useEffect(() => {
        if (request === null) return
        let alive = true
        setStatus('loading'); setState(null); setMessage(null); setBusy(false)
        callJson(`${API.find}?messageId=${encodeURIComponent(request.messageId)}`)
          .then((found) => {
            if (!alive) return
            setState(found); setText(found.row.text ?? ''); setReasoning(found.row.reasoning ?? '')
            setStatus('ready')
          })
          .catch((error) => { if (alive) { setStatus('error'); setMessage(String(error.message ?? error)) } })
        return () => { alive = false }
      }, [request?.messageId, nonce])

      useEffect(() => {
        if (request === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') closePanel() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [request === null])

      if (request === null) return null

      async function submit(mode) {
        setBusy(true); setMessage(null)
        try {
          const result = await callJson(API.apply, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              messageId: request.messageId,
              mode,
              text,
              reasoning,
            }),
          })
          const synced = result.turnSync?.ok === true
            ? `轮次计数器已同步（宿主下轮接 ${Number(result.turnSync.lastTurn) + 1} 号）`
            : result.turnSync?.reason ? `⚠ ${result.turnSync.reason}` : ''
          const note = {
            rewrite: `已改写：模型下一轮读到的是新内容（新事件 seq ${result.writtenSeqs?.join(', ')}）。原始日志没被改动。`,
            delete: `已抹掉：模型下一轮不再看到这条回复（遮蔽事件 seq ${result.shadowedSeq}）。`,
            restore: `已还原：被遮蔽的原内容重新回到模型视野（还原事件 seq ${result.writtenSeqs?.join(', ')}）。`,
          }[mode] ?? '已处理。'
          setMessage({ kind: result.warning ? 'warn' : 'ok', text: `${note}${synced ? '　' + synced : ''}${result.warning ? '　' + result.warning : ''}` })
          // 唤醒对话流的视图过滤：刷新「死轮次」，避免旧回复和新回复同时显示。
          window.dispatchEvent(new Event('dshce-zones-changed'))
        } catch (error) {
          setMessage({ kind: 'err', text: String(error.message ?? error) })
        } finally {
          setBusy(false)
        }
      }

      const row = state?.row
      const history = state?.history
      const blocked = state?.openTurn !== null || state?.openStep !== null
      const body = []
      body.push(React.createElement('div', { className: 'dshce-head', key: 'head' }, [
        React.createElement('h2', { className: 'dshce-title', key: 'title' }, '改上下文'),
        React.createElement('button', {
          key: 'x', type: 'button', className: 'dshce-x', title: '关闭（Esc）', disabled: busy,
          onClick: closePanel,
        }, '×'),
      ]))
      body.push(React.createElement('p', { className: 'dshce-sub', key: 'sub' },
        status === 'loading' ? '正在读取这条回复…'
          : status === 'error' ? '读取失败'
            : '改动只影响模型下一轮读到的内容，原始日志不动。'))

      if (status === 'ready') {
        const chips = [
          `seq ${state.seq}`,
          row?.role ?? '?',
          row?.toolCalls > 0 ? `含 ${row.toolCalls} 个工具调用` : '',
          history?.rewrites > 0 ? `已改过 ${history.rewrites} 次` : '',
        ].filter(Boolean)
        body.push(React.createElement('div', { className: 'dshce-meta', key: 'meta' },
          chips.map((chip, index) => React.createElement('span', { key: index, className: 'dshce-chip' }, chip))))
      }

      if (status === 'ready' && blocked) {
        body.push(React.createElement('p', { className: 'dshce-sub dshce-warn', key: 'warn' },
          '⚠ 这条会话尾部还有未结束的回合/步骤（agent 正在跑，或刚被中断）。此时写入会让轮次号错位，先等它跑完（回复结束）再动。'))
      }

      if (status === 'ready') {
        const panes = [
          { id: 'text', label: '输出内容', hint: `${text.length} 字` },
          { id: 'reasoning', label: '思考过程', hint: reasoning.length > 0 ? `${reasoning.length} 字` : '可选' },
        ]
        body.push(React.createElement('div', { className: 'dshce-body', key: 'body' }, [
          React.createElement('nav', { className: 'dshce-nav', key: 'nav' },
            panes.map((item) => React.createElement('button', {
              key: item.id,
              type: 'button',
              className: 'dshce-nav-item',
              'aria-selected': pane === item.id,
              onClick: () => setPane(item.id),
            }, [
              React.createElement('span', { key: 'l' }, item.label),
              React.createElement('span', { key: 'h', className: 'dshce-nav-hint' }, item.hint),
            ]))),
          React.createElement('div', { className: 'dshce-detail', key: 'detail' },
            pane === 'text'
              ? React.createElement(MarkdownEditor, {
                key: 'text', title: '输出内容', hint: '模型下一轮读到的是这段正文',
                rows: 16, value: text, onChange: setText,
              })
              : React.createElement(MarkdownEditor, {
                key: 'reasoning', title: '思考过程', hint: '留空 = 这条回复不带思考过程',
                rows: 16, value: reasoning, onChange: setReasoning,
              })),
        ]))
      }

      const rowButtons = []
      if (message !== null) {
        rowButtons.push(React.createElement('span', {
          key: 'msg',
          className: `dshce-note ${message.kind === 'ok' ? 'dshce-ok' : message.kind === 'warn' ? 'dshce-warn' : 'dshce-err'}`,
        }, message.text))
      }
      // 还原：把被遮蔽的原稿放回模型视野。只在「这一轮里有遮蔽事件」时才有意义。
      if (status === 'ready' && history?.rewrites > 0) {
        rowButtons.push(React.createElement('button', {
          key: 'restore', type: 'button', className: 'dshce-ghost',
          disabled: busy || blocked,
          title: `把原始版本（seq ${history.originSeq}）重新放回模型视野，覆盖现在的改写版。原稿一直在日志里，所以这一步不需要重新输入。`,
          onClick: async () => {
            const ok = await askConfirm({
              title: '还原原样',
              message: `把原始版本（seq ${history.originSeq}）重新放回模型视野？现在的改写版会被遮蔽。`,
              confirmText: '还原',
            })
            if (ok) submit('restore')
          },
        }, '还原原样'))
      }
      rowButtons.push(React.createElement('button', {
        key: 'del', type: 'button', className: 'dshce-danger',
        disabled: busy || status !== 'ready' || blocked,
        title: '把这条回复从模型可见历史里整个抹掉：模型下一轮连「我说过这句话」都看不到。原始日志仍保留。',
        onClick: async () => {
          const ok = await askConfirm({
            title: '抹掉这条回复',
            message: '这条回复会从模型可见历史里整个移除：模型下一轮连「我说过这句话」都看不到。原始日志仍保留。',
            confirmText: '抹掉',
            danger: true,
          })
          if (ok) submit('delete')
        },
      }, '抹掉这条'))
      rowButtons.push(React.createElement('button', {
        key: 'close', type: 'button', className: 'dshce-ghost', disabled: busy,
        title: '关闭面板，什么都不改（Esc 同效）',
        onClick: closePanel,
      }, '关闭'))
      rowButtons.push(React.createElement('button', {
        key: 'save', type: 'button', className: 'dshce-primary',
        disabled: busy || status !== 'ready' || blocked || text.trim().length === 0,
        title: '写入改写：只影响模型下一轮读到的内容，不改磁盘上的原始记录。会顺带同步宿主的轮次计数器。',
        onClick: () => submit('rewrite'),
      }, busy ? '写入中…' : '保存改写'))
      body.push(React.createElement('div', { className: 'dshce-row dshce-foot', key: 'row' }, rowButtons))

      return React.createElement('div', {
        className: 'dshce-mask',
        onClick: (event) => { if (event.target === event.currentTarget) closePanel() },
      }, React.createElement('div', { className: 'dshce-card' }, body))
    }

    // ------------------------------------------------------------- 就地回溯
    // 用户要的是：自己在对话流里翻到某条消息，直接在那条上点「回溯」，
    // 后面的内容就地消失（不新开会话、不弹列表）。
    //
    // 平台客户端不折叠替换事件，所以模型侧遮蔽之后界面不会自己删行。
    // 这里做视图过滤：宿主记录回退区域（锚点消息 id + 标记消息 id），
    // 客户端把这两行之间的 DOM 行隐藏；刷新后重新拉区域、重新应用。
    function FlowRewind(props) {
      const sessionId = props.sessionId
      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        let disposed = false
        let zones = []
        let deadTurns = []
        const HIDDEN = 'data-ctxedit-hidden'
        const BTN = 'data-ctxedit-btn'
        const FLOW = '[data-slot="conversation.chat.flow"]'

        const uuidOf = (key) => {
          if (typeof key !== 'string') return undefined
          const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(key)
          return m === null ? undefined : m[1]
        }

        function applyZones() {
          const flow = document.querySelector(FLOW)
          if (!flow) return
          // 选所有 flow 项（含分组容器）：只选 [data-chat-node-key] 会漏掉
          // 「执行了命令」这种分组头/空壳行，留下残余。
          const rows = [...flow.querySelectorAll('[data-chat-flow-key]')]
          for (const row of rows) {
            if (row.hasAttribute(HIDDEN)) { row.style.display = ''; row.removeAttribute(HIDDEN) }
          }
          // 首选精确 key 隐藏：不依赖 DOM 顺序/分组/分页。
          const keys = new Set()
          for (const zone of zones) {
            if (Array.isArray(zone?.hiddenKeys)) for (const key of zone.hiddenKeys) keys.add(key)
          }
          if (keys.size > 0) {
            for (const row of rows) {
              if (keys.has(row.dataset.chatNodeKey)) {
                row.style.display = 'none'
                row.setAttribute(HIDDEN, '1')
              }
            }
          }
          // 折叠的思考/工具块（turn-process）用的是轮次号，不在 key 集合里：
          // 被回退轮次的所有行整块隐藏（新产生的轮次不在集合里，不受影响）。
          const turns = new Set()
          for (const zone of zones) {
            if (Array.isArray(zone?.hiddenTurns)) for (const t of zone.hiddenTurns) { if (Number.isSafeInteger(Number(t))) turns.add(Number(t)) }
          }
          if (turns.size > 0) {
            for (const row of rows) {
              const turn = Number(row.dataset.chatTurn)
              if (Number.isSafeInteger(turn) && turns.has(turn)) {
                row.style.display = 'none'
                row.setAttribute(HIDDEN, '1')
              }
            }
          }
          // 被本插件遮蔽的 assistant 轮次：只隐藏该轮的非用户行（用户提问保留）。
          if (deadTurns.length > 0) {
            const dead = new Set(deadTurns.map(Number))
            for (const row of rows) {
              const turn = Number(row.dataset.chatTurn)
              if (!Number.isSafeInteger(turn) || !dead.has(turn)) continue
              if (row.dataset.chatFlowKind === 'user') continue
              row.style.display = 'none'
              row.setAttribute(HIDDEN, '1')
            }
          }
          // 旧区域（没有 hiddenKeys）回退到「锚点行 ~ 标记行之间」的区间隐藏。
          // 有 hiddenKeys 也照样跑一遍：折叠的思考/工具行（turn-process 等）不在 key 集合里，
          // 只有整段区间隐藏才能把它们一起收掉。
          for (const zone of zones) {
            if (!zone) continue
            if (typeof zone.anchorId !== 'string' || typeof zone.markerId !== 'string') continue
            const a = rows.findIndex((r) => (r.dataset.chatNodeKey ?? '').endsWith(zone.anchorId))
            const m = rows.findIndex((r) => (r.dataset.chatNodeKey ?? '').endsWith(zone.markerId))
            if (a < 0 || m < 0 || m <= a) continue
            const anchorEl = rows[a]
            const markerEl = rows[m]
            const from = zone.includeAnchor === true ? a : a + 1
            for (let i = from; i < m; i += 1) {
              // 跳过包含锚点/标记的容器：隐藏它们会连带吃掉前面的正常内容。
              if (rows[i].contains(anchorEl) || rows[i].contains(markerEl)) continue
              rows[i].style.display = 'none'
              rows[i].setAttribute(HIDDEN, '1')
            }
          }
        }

        function addButtons() {
          const flow = document.querySelector(FLOW)
          if (!flow) return
          for (const row of flow.querySelectorAll('[data-chat-flow-kind="user"]')) {
            if (row.querySelector('[data-ctxedit-btn]') !== null) continue
            const id = uuidOf(row.dataset.chatNodeKey)
            if (id === undefined) continue
            const button = document.createElement('button')
            button.setAttribute(BTN, '1')
            button.type = 'button'
            // 常显的纯图标按钮（撤销箭头），不补文字。
            button.className = 'dshce-icon-btn'
            button.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4.5 3 8l3.5 3.5"/><path d="M3 8h6a3.5 3.5 0 0 1 0 7H7.5"/></svg>'
            button.addEventListener('click', async (event) => {
              event.preventDefault()
              event.stopPropagation()
              const ok = await askConfirm({
                title: '回退到这条消息？',
                message: '这条消息和它后面的内容都会从模型视野移除，并在界面上隐藏。原文会复制到剪贴板，方便你改完重发。',
                confirmText: '回退',
                danger: true,
              })
              if (!ok) return
              button.disabled = true
              try {
                const result = await callJson('/api/dsh-ctxedit/rewind-here', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ messageId: id }),
                })
                if (result?.zone) zones = [...zones, result.zone]
                applyZones()
                if (typeof result?.anchorText === 'string' && result.anchorText.trim().length > 0) {
                  try { await navigator.clipboard.writeText(result.anchorText) } catch { /* 剪贴板不可用就算了 */ }
                }
              } catch (error) {
                let text = String(error.message ?? error)
                if (/HTTP 40[14]/.test(text)) text += ' —— 宿主进程里没有这条路由：脚本是新写的，但 DSH 还没重启。请完全退出 DSH 再打开后重试。'
                window.alert(text)
              } finally {
                button.disabled = false
              }
            })
            // 挂到气泡本体（_bubble）：图片消息也按气泡本身垂直居中，而不是按整块。
            const bubble = row.querySelector('[class*="_bubble"]')
            const stack = row.querySelector('[class*="_userStack"]')
            // 纯图片消息的气泡可能为空/零高：此时退回 userStack，按整条消息居中。
            const host = bubble !== null && bubble.offsetHeight > 0 ? bubble : (stack ?? null)
            if (host !== null && getComputedStyle(host).position === 'static') host.style.position = 'relative'
            const tip = document.createElement('span')
            tip.className = 'dshce-tip'
            tip.dataset.tip = '回退到这条消息（含它及之后）'
            tip.appendChild(button)
            const line = document.createElement('div')
            line.className = host === null ? 'dshce-actions dshce-actions-inline' : 'dshce-actions'
            line.appendChild(tip)
            ;(host ?? row.firstElementChild ?? row).appendChild(line)
          }
        }

        const refresh = () => { if (!disposed) { applyZones(); addButtons() } }

        const loadZones = () => {
          callJson(`/api/dsh-ctxedit/zones?sessionId=${encodeURIComponent(sessionId)}`)
            .then((result) => {
              if (disposed) return
              zones = Array.isArray(result?.zones) ? result.zones : []
              deadTurns = Array.isArray(result?.deadTurns) ? result.deadTurns : []
              refresh()
            })
            .catch(() => {})
        }
        loadZones()

        // 面板里保存改写/抹除/还原之后，宿主侧的「死轮次」会变：重新拉一次并重绘。
        const onChanged = () => { loadZones() }
        window.addEventListener('dshce-zones-changed', onChanged)

        const observer = new MutationObserver(() => { refresh() })
        if (document.body !== null) observer.observe(document.body, { childList: true, subtree: true })
        const timer = window.setInterval(refresh, 1500)

        return () => {
          disposed = true
          window.removeEventListener('dshce-zones-changed', onChanged)
          observer.disconnect()
          clearInterval(timer)
          for (const line of document.querySelectorAll('.dshce-actions, .dshce-actions-inline')) line.remove()
          for (const button of document.querySelectorAll(`[${BTN}]`)) button.remove()
          for (const row of document.querySelectorAll(`[${HIDDEN}]`)) { row.style.display = ''; row.removeAttribute(HIDDEN) }
        }
      }, [sessionId])
      return null
    }

    // ------------------------------------------------------------- 回退（fork）
    // 界面级「真的消失」只能靠 fork：新会话的日志里根本没有后续事件，
    // 平台按追加事件渲染，因此打开新会话时那些消息是真的不存在。
    const API_REWIND = { prompts: '/api/dsh-ctxedit/prompts', rewind: '/api/dsh-ctxedit/rewind' }
    const rwStore = { sessionId: null, nonce: 0, listeners: new Set() }
    function subscribeRewind(listener) {
      rwStore.listeners.add(listener)
      return () => rwStore.listeners.delete(listener)
    }
    function openRewind(sessionId) {
      rwStore.sessionId = sessionId
      rwStore.nonce = Date.now()
      for (const listener of [...rwStore.listeners]) listener()
    }
    function closeRewind() {
      rwStore.sessionId = null
      for (const listener of [...rwStore.listeners]) listener()
    }

    /** apply() 时注入的插件上下文，用来取 uiWorkspace.openSession。 */
    let pluginCtx = null

    function openChildSession(sessionId) {
      try {
        const ws = pluginCtx?.uiWorkspace ?? pluginCtx?.get?.('uiWorkspace')
        if (ws && typeof ws.openSession === 'function') {
          ws.openSession(sessionId)
          return true
        }
      } catch { /* 落回 false */ }
      return false
    }
    function RewindButton(props) {
      const sessionId = props.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      return React.createElement('button', {
        type: 'button',
        className: 'dshce-btn',
        title: [
          '回退（Claude Code rewind 语义）',
          '· 选一条提问，回退到它之前：后面的内容从模型上下文里移除，并创建一条更短的新会话',
          '· 新会话会真的没有那些消息（不是遮住，是根本没有）',
          '· 旧会话原样保留为归档',
          '· 可把提问原文放回剪贴板，或直接改完重发',
        ].join('\n'),
        'aria-label': '回退',
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          openRewind(sessionId)
        },
      }, React.createElement('svg', {
        width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, [
        React.createElement('path', { key: 'a', d: 'M6.5 4.5 3 8l3.5 3.5' }),
        React.createElement('path', { key: 'b', d: 'M3 8h6a3.5 3.5 0 0 1 0 7H7.5' }),
      ]), React.createElement('span', { key: 't' }, '回退'))
    }

    function RewindPanel() {
      const [sessionId, setSessionId] = useState(rwStore.sessionId)
      const [nonce, setNonce] = useState(rwStore.nonce)
      useEffect(() => subscribeRewind(() => { setSessionId(rwStore.sessionId); setNonce(rwStore.nonce) }), [])

      const [status, setStatus] = useState('loading')
      const [data, setData] = useState(null)
      const [message, setMessage] = useState(null)
      const [busy, setBusy] = useState(false)
      const [editing, setEditing] = useState(null)
      const [editText, setEditText] = useState('')

      useEffect(() => {
        if (sessionId === null) return undefined
        let alive = true
        setStatus('loading'); setData(null); setMessage(null); setEditing(null)
        callJson(`${API_REWIND.prompts}?sessionId=${encodeURIComponent(sessionId)}`)
          .then((result) => { if (alive) { setData(result); setStatus('ready') } })
          .catch((error) => { if (alive) { setStatus('error'); setMessage({ kind: 'err', text: String(error.message ?? error) }) } })
        return () => { alive = false }
      }, [sessionId, nonce])

      useEffect(() => {
        if (sessionId === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') closeRewind() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [sessionId])

      if (sessionId === null) return null

      const blocked = data?.openTurn !== null && data?.openTurn !== undefined
      const canOpen = pluginCtx?.uiWorkspace !== undefined || typeof pluginCtx?.get === 'function'

      async function run(prompt, mode, text) {
        setBusy(true); setMessage(null)
        try {
          const result = await callJson(API_REWIND.rewind, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, promptSeq: prompt.promptSeq, mode, text }),
          })
          const opened = openChildSession(result.childSessionId)
          const parts = [
            `已回退：新会话 ${String(result.childSessionId).replace(/^session-/, '').slice(0, 8)}`,
            `移除 ${result.removedCount} 条（含 ${result.assistantCount} 条回复）`,
            opened ? '已自动切过去' : '请在侧栏打开它',
          ]
          if (mode === 'keep' || result.needsComposer) {
            try { await navigator.clipboard.writeText(mode === 'keep' ? result.promptText : text) ; parts.push('提问原文已复制') } catch { parts.push('请手动复制提问原文') }
          }
          if (result.resend?.attempted && result.resend?.ok) parts.push('新提问已发送')
          if (result.resend?.attempted && !result.resend?.ok) parts.push(`重发失败：${result.resend.error}`)
          setMessage({ kind: result.resend?.attempted && !result.resend?.ok ? 'warn' : 'ok', text: parts.join('；') })
          setEditing(null)
        } catch (error) {
          setMessage({ kind: 'err', text: String(error.message ?? error) })
        } finally {
          setBusy(false)
        }
      }

      const rows = []
      for (const prompt of data?.prompts ?? []) {
        const isEditing = editing === prompt.promptSeq
        const preview = prompt.text.length > 90 ? `${prompt.text.slice(0, 90)}…` : prompt.text
        rows.push(React.createElement('div', { key: prompt.promptSeq, className: 'dshce-item' }, [
          React.createElement('div', { key: 'body', className: 'dshce-item-body' }, [
            React.createElement('div', { key: 'text', className: 'dshce-item-text' }, preview),
            React.createElement('div', { key: 'meta', className: 'dshce-item-meta' },
              `第 ${prompt.turn ?? '?'} 轮 · seq ${prompt.promptSeq} · 回退边界 seq ${prompt.boundarySeq}`),
            isEditing ? React.createElement('textarea', {
              key: 'edit', className: 'dshce-area', rows: 4, value: editText,
              style: { marginTop: '8px' },
              onChange: (event) => setEditText(event.target.value),
            }) : null,
            isEditing ? React.createElement('div', { key: 'edit-row', className: 'dshce-item-actions', style: { marginTop: '8px' } }, [
              React.createElement('button', {
                key: 'cancel', type: 'button', className: 'dshce-mini', disabled: busy,
                onClick: () => { setEditing(null); setEditText('') },
              }, '取消'),
              React.createElement('button', {
                key: 'go', type: 'button', className: 'dshce-mini dshce-mini-primary',
                disabled: busy || blocked || editText.trim().length === 0,
                onClick: () => run(prompt, 'resend', editText),
              }, '回退并重发'),
            ]) : null,
          ]),
          React.createElement('div', { key: 'actions', className: 'dshce-item-actions' }, [
            React.createElement('button', {
              key: 'keep', type: 'button', className: 'dshce-mini',
              disabled: busy || blocked,
              title: '回退到这条提问之前；提问原文复制到剪贴板，你可以自己改完再发。',
              onClick: () => {
                if (window.confirm(`回退到「第 ${prompt.turn ?? '?'} 轮」这条提问之前？\n将移除 ${data.prompts.length - (data.prompts.indexOf(prompt) + 1)} 轮之后的全部内容，并创建一条更短的新会话。`)) run(prompt, 'keep')
              },
            }, '回退'),
            React.createElement('button', {
              key: 'edit', type: 'button', className: 'dshce-mini',
              disabled: busy || blocked,
              title: '回退并改写这条提问，然后直接发出去。',
              onClick: () => { setEditing(prompt.promptSeq); setEditText(prompt.text) },
            }, '回退并改'),
            React.createElement('button', {
              key: 'drop', type: 'button', className: 'dshce-mini dshce-mini-danger',
              disabled: busy || blocked,
              title: '回退并撤回这条提问：这条及之后的全部内容都不再进入模型上下文。',
              onClick: () => {
                if (window.confirm('回退并撤回这条提问？这条及之后的内容都会从模型上下文移除，并创建一条更短的新会话。')) run(prompt, 'notext')
              },
            }, '撤回'),
          ]),
        ]))
      }

      return React.createElement('div', {
        className: 'dshce-mask',
        onClick: (event) => { if (event.target === event.currentTarget) closeRewind() },
      }, React.createElement('div', { className: 'dshce-card' }, [
        React.createElement('h2', { key: 'title', className: 'dshce-title' }, '回退（rewind）'),
        React.createElement('p', { key: 'sub', className: 'dshce-sub' },
          '回退会以「这条提问之前」为边界创建一条更短的新会话并切过去：后续消息在新会话里根本不存在，所以界面上是真的消失。旧会话原样保留为归档。'),
        blocked ? React.createElement('p', { key: 'warn', className: 'dshce-sub dshce-warn' },
          '⚠ 这一轮还在跑（或刚被中断）。等回复结束后再回退。') : null,
        message !== null ? React.createElement('p', {
          key: 'msg',
          className: `dshce-sub ${message.kind === 'ok' ? 'dshce-ok' : message.kind === 'warn' ? 'dshce-warn' : 'dshce-err'}`,
        }, message.text) : null,
        status === 'loading' ? React.createElement('p', { key: 'loading', className: 'dshce-sub' }, '正在读取提问列表…') : null,
        status === 'error' ? null : React.createElement('div', { key: 'list', className: 'dshce-list' }, rows.length > 0 ? rows : [
          React.createElement('p', { key: 'empty', className: 'dshce-sub' }, '这条会话里还没有可回退的提问。'),
        ]),
        React.createElement('div', { key: 'row', className: 'dshce-row' }, [
          React.createElement('button', {
            key: 'close', type: 'button', className: 'dshce-ghost', disabled: busy, onClick: closeRewind,
          }, '关闭'),
        ]),
      ]))
    }

    // ------------------------------------------------------------- plugin
    const inject = ['slots']

    // 兜底：本插件激活失败只丢界面入口，绝不能让整个 web boot 判「entry did not activate」
    // 而把桌面端带崩（0.4.0 的 ctx.uiWorkspace 事故就是这么炸的）。
    function apply(ctx) {
      try {
        applyInside(ctx)
      } catch (error) {
        console.error('dsh-ctxedit: activate failed — 界面入口不可用，但启动继续', error)
      }
    }

    function applyInside(ctx) {
      pluginCtx = {
        // 只能走 ctx.get()：直接读 ctx.uiWorkspace 会触发 cordis 的
        // "cannot get property ... without inject"（本条目 inject 只有 slots），
        // 一旦抛错整个 web boot 会因「entry did not activate」失败。
        uiWorkspace: typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined,
        get: (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined),
      }
      const style = document.createElement('style')
      style.id = 'dsh-ctxedit-style'
      style.textContent = CSS
      document.head.append(style)
      ctx.effect(() => () => style.remove(), 'dsh-ctxedit: styles')

      // 每个槽位独立兜底：一个槽位在某个版本里不存在/改名，只丢那一个入口，
      // 不影响其他入口，更不会让整个 web boot 失败。
      const injectSlot = (name, register) => {
        try {
          ctx.slots.inject(name, register)
        } catch (error) {
          console.warn(`dsh-ctxedit: slot "${name}" unavailable — that entry is skipped`, error)
        }
      }

      injectSlot('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'ctxedit',
        order: 40,
        label: '改上下文',
      }, (props) => React.createElement(EditButton, props)))

      // 就地回溯：挂在每条「你」的消息上。组件本身渲染 null，
      // 只在会话作用域里拿 sessionId，然后直接操作对话流 DOM。
      injectSlot('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'ctxedit-rewind',
        order: 40,
        label: '回溯',
      }, (props) => React.createElement(FlowRewind, props)))

      injectSlot('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-ctxedit-panel', label: '改上下文' },
        () => React.createElement(Panel),
      ))

      // 确认框单独注册：层级在面板之上。
      injectSlot('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-ctxedit-confirm', label: '确认' },
        () => React.createElement(ConfirmDialog),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

