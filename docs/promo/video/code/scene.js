/**
 * dsh-ctxedit 推广片 v3：按真实 DSH 界面绘制（浅灰用户气泡、灰色 ↩、助手动作行、「更改输出」面板）。
 * 纯 t 函数；暴露 window.DURATION / seek / __ready。
 * 设计空间 1280×800，按画布尺寸缩放。
 */
(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const V = H > W;

  const DW = 1280;
  const DH = 800;

  const C = {
    win: '#151517',
    side: '#1B1B1C',
    line: 'rgba(255,255,255,0.07)',
    fg: '#E8E8E8',
    muted: '#9A9DA3',
    dim: '#6B6F76',
    accent: '#4D6BFE',
    bubble: '#E9E9E9',
    bubbleText: '#1B1B1F',
    card: '#1F1F22',
    area: '#26262A',
    green: '#4FD18B',
  };
  const FONT = '"Microsoft YaHei", "Noto Sans SC", sans-serif';

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const ease = (x) => {
    x = clamp01(x);
    return x * x * (3 - 2 * x);
  };
  const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
  const easeInOut = (x) => (clamp01(x) < 0.5 ? 2 * clamp01(x) ** 2 : 1 - Math.pow(-2 * clamp01(x) + 2, 2) / 2);
  const prog = (t, start, dur) => clamp01((t - start) / dur);

  function font(size, weight) {
    return `${weight || 400} ${size}px ${FONT}`;
  }
  function rr(x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    const k = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  function text(str, x, y, size, color, weight, align) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
  }
  function measure(str, size, weight) {
    ctx.font = font(size, weight);
    return ctx.measureText(str).width;
  }
  function typed(str, t, start, cps) {
    return str.slice(0, Math.max(0, Math.min(str.length, Math.floor((t - start) * cps))));
  }

  // ---------- 背景与常驻 ----------
  function bg(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0C0D11');
    g.addColorStop(1, '#111218');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const blobs = V
      ? [{ x: W * 0.25, y: H * 0.2, r: 560, c: 'rgba(70,90,180,0.13)' }, { x: W * 0.8, y: H * 0.8, r: 620, c: 'rgba(100,60,170,0.1)' }]
      : [{ x: W * 0.2, y: H * 0.3, r: 700, c: 'rgba(70,90,180,0.12)' }, { x: W * 0.82, y: H * 0.72, r: 760, c: 'rgba(100,60,170,0.09)' }];
    for (const b of blobs) {
      const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      rg.addColorStop(0, b.c);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    const step = V ? 64 : 80;
    const off = (t * 6) % step;
    for (let x = -step + off; x <= W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = -step + off; y <= H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function progress(t) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, H - 3, W, 3);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, C.accent);
    g.addColorStop(1, '#7C5CFF');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - 3, (W * clamp01(t / 24)) | 0, 3);
  }

  // ---------- 片头 ----------
  function intro(t) {
    const cx = W / 2;
    const title = 'dsh-ctxedit';
    const size = V ? 118 : 132;
    const spacing = V ? 2 : 5;
    const chars = [...title];
    const widths = chars.map((c) => measure(c, size, 700));
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = cx - total / 2;
    const baseY = V ? 700 : 430;
    chars.forEach((c, i) => {
      const k = easeOut(prog(t, 0.1 + i * 0.035, 0.55));
      ctx.globalAlpha = k;
      text(c, x, baseY + (1 - k) * 24, size, '#F4F6FB', 700);
      x += widths[i] + spacing;
    });
    ctx.globalAlpha = 1;
    ctx.globalAlpha = ease(prog(t, 0.9, 0.6));
    text('DeepSeek Harness · 上下文编辑插件', cx, V ? 780 : 500, V ? 36 : 34, C.muted, 400, 'center');
    const uw = (V ? 400 : 520) * easeOut(prog(t, 1.2, 0.7));
    ctx.fillStyle = C.accent;
    ctx.fillRect(cx - uw / 2, V ? 830 : 540, uw, 3);
    ctx.globalAlpha = ease(prog(t, 1.6, 0.6));
    text('改的是模型记忆，不是日志。', cx, V ? 920 : 620, V ? 42 : 38, C.fg, 400, 'center');
    ctx.globalAlpha = 1;
  }

  // ---------- 应用窗口 ----------
  function appScale() {
    const mx = V ? 60 : 100;
    const top = V ? 240 : 150;
    const bottom = V ? 260 : 90;
    return Math.min((W - mx * 2) / DW, (H - top - bottom) / DH);
  }

  function windowFrame() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 24;
    rr(0, 0, DW, DH, 18, C.win, C.line);
    ctx.restore();
    // 侧栏
    ctx.save();
    ctx.beginPath();
    rr(0, 0, DW, DH, 18, null, null);
    ctx.clip();
    ctx.fillStyle = C.side;
    ctx.fillRect(0, 0, 210, DH);
    ctx.fillStyle = C.line;
    ctx.fillRect(210, 0, 1, DH);

    // 侧栏内容
    text('deepseek', 22, 34, 16, C.fg, 700);
    rr(20, 56, 170, 30, 8, 'rgba(255,255,255,0.06)');
    text('＋ 新会话', 36, 76, 12, C.fg, 400);
    const items = ['dsh-ctxedit 项目', '寻找可修改消息的插件', '工作区代码审计'];
    items.forEach((s, i) => {
      if (i === 0) rr(14, 108, 182, 28, 7, 'rgba(255,255,255,0.07)');
      text(s, 26, 126 + i * 36, 11, i === 0 ? C.fg : C.muted, 400);
    });

    // 主区
    text('寻找可修改和撤回消息的插件', 238, 36, 14, C.fg, 600);
    text('9.8K tokens · 上下文 41%', 238, 56, 10, C.dim, 400);

    // 消息：助手 1
    const msgX = 238;
    const msgY = 96;
    text('这条消息的正文是「原来的回答」，模型下一轮会看到它。', msgX, msgY, 13, C.fg, 400);
    text('如果要改，点下面的「更改输出」。', msgX, msgY + 22, 13, C.fg, 400);

    // 动作行（悬停时出现）
    const hover = ease(prog(window.__t || 0, 0, 0.4));
    actionRow(msgX, msgY + 40, hover);

    // 用户消息
    const ubW = 300;
    const ubH = 36;
    const ubX = 940 - ubW;
    const ubY = 210;
    bubbleWithRewind(ubX, ubY, ubW, ubH, '把这条回复改短一点', window.__t || 0);

    // 助手 2 由场景决定

    // 输入框
    rr(238, 700, 1000, 56, 14, C.area, C.line);
    text('发消息或创建任务，/ 调用指令，@ 文件或对话', 258, 733, 11, C.dim, 400);
    ctx.beginPath();
    ctx.arc(1215, 728, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#BBD3FF';
    ctx.fill();

    ctx.restore();
  }

  function actionRow(x, y, alpha) {
    ctx.globalAlpha = alpha;
    const icons = ['⧉', '↻', '⋯'];
    icons.forEach((ic, i) => {
      rr(x + i * 30, y, 26, 24, 6, 'rgba(255,255,255,0.04)');
      text(ic, x + i * 30 + 13, y + 17, 13, C.muted, 400, 'center');
    });
    // 更改输出 按钮
    const bx = x + 102;
    rr(bx, y, 116, 24, 6, 'rgba(77,107,254,0.12)', 'rgba(77,107,254,0.35)');
    text('✎', bx + 12, y + 17, 13, '#AFC0FF', 400);
    text('更改输出', bx + 30, y + 17, 12, '#C7D2FF', 400);
    ctx.globalAlpha = 1;
  }

  function bubbleWithRewind(x, y, w, h, str, t) {
    // ↩（真实界面：气泡左侧一个灰色小图标）
    const a = ease(prog(t, 0, 0.6));
    ctx.globalAlpha = a * 0.8;
    text('↩', x - 26, y + 24, 15, C.muted, 400);
    ctx.globalAlpha = 1;
    rr(x, y, w, h, 12, C.bubble);
    text(str, x + 16, y + 23, 13, C.bubbleText, 400);
  }

  // ---------- 面板 ----------
  function panel(openK) {
    const pw = 780;
    const ph = 540;
    const px = (DW - pw) / 2;
    const py = (DH - ph) / 2;
    const k = openK;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(DW / 2, DH / 2);
    ctx.scale(0.94 + 0.06 * k, 0.94 + 0.06 * k);
    ctx.translate(-DW / 2, -DH / 2);
    rr(px, py, pw, ph, 16, C.card, C.line);
    text('更改输出', px + 22, py + 34, 15, C.fg, 600);
    text('×', px + pw - 34, py + 34, 18, C.muted, 400);

    // 左导航
    rr(px + 18, py + 56, 160, 300, 10, 'rgba(255,255,255,0.03)');
    rr(px + 24, py + 64, 148, 28, 7, 'rgba(255,255,255,0.07)');
    text('输出内容', px + 36, py + 83, 12, C.fg, 400);
    text('思考过程', px + 36, py + 115, 12, C.muted, 400);

    // 右侧
    const rx = px + 196;
    text('输出内容', rx, py + 76, 12, C.fg, 600);
    // tabs
    rr(rx + 420, py + 60, 130, 26, 8, 'rgba(255,255,255,0.05)');
    rr(rx + 424, py + 63, 60, 20, 6, 'rgba(255,255,255,0.1)');
    text('编辑', rx + 444, py + 77, 11, C.fg, 400);
    text('预览', rx + 502, py + 77, 11, C.muted, 400);
    // 文本域
    rr(rx, py + 96, 546, 300, 10, C.area, C.line);
    const s = '已改写：模型下一轮读到新版回复。';
    const dv = window.__panelTyped || '';
    text(dv, rx + 16, py + 130, 12, C.fg, 400);
    text('支持 Markdown，保存后模型下一轮读到这里的内容', rx + 16, py + 380, 10, C.dim, 400);

    // 底部按钮
    rr(rx + 430, py + ph - 58, 116, 32, 9, 'rgba(255,255,255,0.06)');
    text('取消', rx + 474, py + ph - 37, 12, C.muted, 400);
    rr(rx + 430 + 128, py + ph - 58, 116, 32, 9, C.accent);
    text('保存改写', rx + 430 + 150, py + ph - 37, 12, '#fff', 400);
    ctx.restore();
  }

  // ---------- 场景 ----------
  const T = 24.0;
  const S = { intro: 0.0, rewrite: 4.0, rewind: 9.6, restore: 14.9, outro: 20.0 };

  function drawApp(t, phase) {
    const s = appScale();
    const ox = (W - DW * s) / 2;
    const top = V ? 240 : 150;
    const bottom = V ? 260 : 90;
    const oy = top + ((H - top - bottom) - DH * s) / 2;
    const enter = easeOut(prog(t, S.rewrite - 0.4, 0.7));
    ctx.save();
    ctx.globalAlpha = enter;
    ctx.translate(0, (1 - enter) * 30);
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    window.__t = t;
    windowFrame();
    if (phase !== 'rewind') text('好，已经改短了。', 238, 300, 13, C.fg, 400);

    // 改写场景：面板 + 保存
    if (phase === 'rewrite') {
      window.__panelTyped = typed('已改写：模型下一轮读到新版回复。', t, 5.8, 14);
      const openK = easeOut(prog(t, 5.4, 0.5)) * (1 - ease(prog(t, 8.4, 0.4)));
      if (openK > 0) panel(openK);
    }

    // 回退场景：高亮用户气泡 + 下方内容位移
    if (phase === 'rewind') {
      const k = easeInOut(prog(t, 10.4, 0.8));
      const a = 0.06 + 0.1 * k;
      rr(940 - 300 - 8, 202, 316, 52, 14, `rgba(77,107,254,${a})`);
      // 覆盖下方内容：淡出并下移
      ctx.globalAlpha = enter * (1 - 0.85 * k);
      ctx.fillStyle = C.win;
      ctx.fillRect(230, 270, 1010, 120);
      ctx.globalAlpha = enter;
      text('这条及之后已移出模型视野', 238, 300 + 20 * k, 13, C.muted, 400);
    }

    // 还原场景：原稿回来
    if (phase === 'restore') {
      const k = easeOut(prog(t, 15.8, 0.7));
      ctx.globalAlpha = enter * k;
      rr(238, 170, 620, 32, 9, 'rgba(77,107,254,0.10)');
      text('原稿：这条消息的正文是「原来的回答」', 254, 191, 12, C.fg, 400);
      ctx.globalAlpha = enter;
    }

    ctx.restore();
  }

  function captions(t, phase) {
    const items = {
      rewrite: ['改写回复', '模型下一轮读新版 · 原日志不动'],
      rewind: ['就地回退', '这条及之后移出模型视野'],
      restore: ['还原原稿', '可沿血统找回最初版本'],
    };
    if (!items[phase]) return;
    const [title, sub] = items[phase];
    const a = ease(prog(t, 0, 0.5));
    ctx.globalAlpha = a;
    if (V) {
      text(title, 60, 150, 44, '#F4F6FB', 700);
      text(sub, 60, 196, 22, C.muted, 400);
    } else {
      text(title, 60, 70, 30, '#F4F6FB', 700);
      text(sub, 60, 100, 16, C.muted, 400);
    }
    ctx.globalAlpha = 1;
  }

  function bulletsV(t) {
    const y0 = 1390;
    const lines = ['改写：模型下一轮读新版', '回退：这条之后移出视野', '还原：找回最初版本'];
    lines.forEach((s, i) => {
      const a = ease(prog(t - S.rewrite, 0.2 + i * 0.12, 0.4));
      ctx.globalAlpha = a;
      text('✓', 86, y0 + i * 56, 26, C.accent, 700);
      text(s, 126, y0 + i * 56, 27, C.fg, 400);
    });
    ctx.globalAlpha = 1;
  }

  function outro(t) {
    const cx = W / 2;
    const a = ease(prog(t, 0, 0.7));
    ctx.globalAlpha = a;
    text('开源在 GitHub', cx, V ? 700 : 380, V ? 76 : 74, '#F4F6FB', 700, 'center');
    text('github.com/AtinyFurina/dsh-ctxedit', cx, V ? 800 : 470, V ? 38 : 38, C.accent, 400, 'center');
    text('MIT · 欢迎 issue / PR', cx, V ? 870 : 540, V ? 28 : 26, C.muted, 400, 'center');
    ctx.globalAlpha = 1;
  }

  window.DURATION = T;
  window.seek = async (t) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    bg(t);

    if (t < S.rewrite) intro(t);
    else if (t < S.rewind) {
      drawApp(t, 'rewrite');
      captions(t - S.rewrite, 'rewrite');
      if (V) bulletsV(t);
    } else if (t < S.restore) {
      drawApp(t, 'rewind');
      captions(t - S.rewind, 'rewind');
    } else if (t < S.outro) {
      drawApp(t, 'restore');
      captions(t - S.restore, 'restore');
    } else {
      if (t < S.outro + 0.5) drawApp(t, 'restore');
      outro(t - S.outro);
    }

    progress(t);

    const fadeIn = 1 - ease(prog(t, 0, 0.5));
    const fadeOut = ease(prog(t, T - 0.6, 0.6));
    if (fadeIn > 0 || fadeOut > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.max(fadeIn, fadeOut)})`;
      ctx.fillRect(0, 0, W, H);
    }
    return true;
  };

  window.__ready = document.fonts.ready.then(() => true);
})();





