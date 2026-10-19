/**
 * dsh-ctxedit 推广片场景（Canvas 2D，纯 t 函数）。
 * 暴露 window.DURATION / window.seek / window.__ready。
 * 横竖版共用：canvas 尺寸决定布局（V = H > W）。
 */
(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const V = H > W;

  const C = {
    bg0: '#0F1115',
    bg1: '#171B26',
    fg: '#F4F6FB',
    muted: '#9AA0AC',
    dim: '#5C6270',
    accent: '#4D6BFE',
    card: '#1B1B1F',
    stroke: '#2C2C2E',
    bubble: '#25304A',
    bubbleText: '#DCE4FF',
    warm: '#E8A33D',
    red: '#C05050',
  };

  const FONT = '"Microsoft YaHei", "Noto Sans SC", sans-serif';

  // ---------- 工具 ----------
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const ease = (x) => {
    x = clamp01(x);
    return x * x * (3 - 2 * x);
  };
  const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
  const lerp = (a, b, k) => a + (b - a) * k;
  /** t 在 [start, start+dur] 的进度 0→1 */
  const prog = (t, start, dur) => clamp01((t - start) / dur);

  function font(size, weight) {
    return `${weight || 400} ${size}px ${FONT}`;
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
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

  /** 逐字加字距并居中；返回总宽 */
  function spaced(str, cx, y, size, color, weight, spacing) {
    const chars = [...str];
    const widths = chars.map((c) => measure(c, size, weight));
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = cx - total / 2;
    ctx.fillStyle = color;
    ctx.font = font(size, weight);
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
      ctx.fillText(c, x, y);
      x += widths[i] + spacing;
    });
    return total;
  }

  /** 打字机：已显示的字符数 */
  function typed(str, t, start, cps) {
    const count = Math.max(0, Math.floor((t - start) * cps));
    return str.slice(0, Math.min(str.length, count));
  }

  function bg(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg0);
    g.addColorStop(1, C.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 细网格（低对比）
    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.lineWidth = 1;
    const step = V ? 72 : 96;
    for (let x = 0; x <= W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function footer(t, alpha) {
    const size = V ? 26 : 22;
    const s = 'github.com/AtinyFurina/dsh-ctxedit';
    const w = measure(s, size, 400);
    ctx.globalAlpha = alpha;
    text(s, (W - w) / 2, H - (V ? 90 : 60), size, '#6E7480', 400);
    ctx.globalAlpha = 1;
  }

  // ---------- 场景 ----------
  const T = 22.0;
  const S = { intro: 0, rewrite: 3.5, rewind: 9.0, restore: 14.5, outro: 19.5 };

  function sceneIntro(t) {
    const a = ease(prog(t, 0.0, 0.9));
    const out = 1 - ease(prog(t, S.rewrite - 0.5, 0.5));
    ctx.globalAlpha = a * out;
    const cx = W / 2;
    const titleSize = V ? 132 : 150;
    spaced('dsh-ctxedit', cx, V ? 760 : 470, titleSize, C.fg, 700, V ? 2 : 4);
    text('DeepSeek Harness · 上下文编辑插件', cx, V ? 850 : 545, V ? 42 : 40, C.muted, 400, 'center');
    const lineW = (V ? 360 : 520) * ease(prog(t, 0.5, 0.8));
    ctx.fillStyle = C.accent;
    ctx.fillRect(cx - lineW / 2, V ? 920 : 600, lineW, 4);
    text('改的是模型记忆，不是日志。', cx, V ? 1040 : 690, V ? 46 : 44, C.fg, 400, 'center');
    ctx.globalAlpha = 1;
  }

  function chatCard(x, y, w, h, alpha) {
    ctx.globalAlpha = alpha;
    roundRect(x, y, w, h, 24);
    ctx.fillStyle = C.card;
    ctx.fill();
    ctx.strokeStyle = C.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function bubble(x, y, w, h, fill, alpha) {
    ctx.globalAlpha = alpha;
    roundRect(x, y, w, h, 16);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function sceneRewrite(t) {
    const local = t - S.rewrite;
    const inA = ease(prog(local, 0.0, 0.4));
    const outA = 1 - ease(prog(t, S.rewind - 0.4, 0.4));
    ctx.globalAlpha = inA * outA;

    if (V) {
      text('01', 110, 300, 40, C.accent, 700);
      text('改写回复', 110, 420, 84, C.fg, 700);
      text('模型下一轮读新版 · 原日志不动', 110, 510, 32, C.muted, 400);
      chatCard(90, 560, W - 180, 620, 1);
    } else {
      text('01', 140, 300, 36, C.accent, 700);
      text('改写回复', 140, 420, 78, C.fg, 700);
      text('模型下一轮读新版 · 原日志不动', 140, 510, 30, C.muted, 400);
      chatCard(1040, 220, W - 1180, 560, 1);
    }

    const cardX = V ? 90 : 1040;
    const cardY = V ? 560 : 220;
    const cardW = V ? W - 180 : W - 1180;
    const cardH = V ? 620 : 560;
    const pad = 60;

    // 用户气泡（右对齐）
    const ubW = cardW * 0.66;
    const ubH = V ? 120 : 96;
    const ubX = cardX + cardW - pad - ubW;
    const ubY = cardY + 50;
    bubble(ubX, ubY, ubW, ubH, C.bubble, 1);
    text('把上一轮的回答改短一点', ubX + 28, ubY + (V ? 52 : 42), V ? 30 : 26, C.bubbleText, 400);

    // 旧回复
    const oy = ubY + ubH + (V ? 80 : 56);
    text('旧回复', cardX + pad, oy, V ? 26 : 22, C.dim, 400);
    const obY = oy + 24;
    const obH = V ? 110 : 84;
    bubble(cardX + pad, obY, cardW - pad * 2, obH, '#202024', 1);
    const oldText = '原来的回答……';
    text(oldText, cardX + pad + 30, obY + (V ? 66 : 50), V ? 30 : 26, C.dim, 400);
    // 划掉
    const strike = ease(prog(local, 1.2, 0.6));
    const ow = measure(oldText, V ? 30 : 26, 400);
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cardX + pad + 28, obY + (V ? 60 : 46));
    ctx.lineTo(cardX + pad + 28 + ow * strike, obY + (V ? 60 : 46));
    ctx.stroke();

    // 新回复（打字机）
    const ny = obY + obH + (V ? 70 : 48);
    if (local > 2.4) {
      const na = ease(prog(local, 2.4, 0.4));
      bubble(cardX + pad, ny, cardW - pad * 2, V ? 130 : 104, '#23283A', na);
      const s = '已改写：模型下一轮读到新版';
      text(typed(s, local, 2.6, 22), cardX + pad + 30, ny + (V ? 76 : 60), V ? 30 : 26, C.fg, 400);
    }
    ctx.globalAlpha = 1;
  }

  function sceneRewind(t) {
    const local = t - S.rewind;
    const inA = ease(prog(local, 0.0, 0.4));
    const outA = 1 - ease(prog(t, S.restore - 0.4, 0.4));
    ctx.globalAlpha = inA * outA;

    if (V) {
      text('02', 110, 300, 40, C.accent, 700);
      text('就地回退', 110, 420, 84, C.fg, 700);
      text('这条及之后移出模型视野 · 界面同步隐藏', 110, 510, 32, C.muted, 400);
      chatCard(90, 560, W - 180, 620, 1);
    } else {
      text('02', 140, 300, 36, C.accent, 700);
      text('就地回退', 140, 420, 78, C.fg, 700);
      text('这条及之后移出模型视野 · 界面同步隐藏', 140, 510, 30, C.muted, 400);
      chatCard(1040, 220, W - 1180, 560, 1);
    }

    const cardX = V ? 90 : 1040;
    const cardY = V ? 560 : 220;
    const cardW = V ? W - 180 : W - 1180;
    const pad = 60;
    const rowH = V ? 110 : 86;
    const gap = V ? 26 : 18;
    const rows = [
      { text: '你：这条消息保留', fill: '#232326', color: C.fg },
      { text: '你：这条及之后回退', fill: C.bubble, color: C.bubbleText, target: true },
      { text: '助手：被移出视野', fill: '#1A1A1D', color: C.dim, gone: true },
      { text: '助手：同样移出', fill: '#1A1A1D', color: C.dim, gone: true },
    ];

    const start = cardY + 60;
    rows.forEach((row, i) => {
      const ry = start + i * (rowH + gap);
      let a = 1;
      let dx = 0;
      if (row.gone) {
        const k = ease(prog(local, 1.6 + i * 0.15, 0.6));
        a = 1 - 0.85 * k;
        dx = 30 * k;
      }
      ctx.globalAlpha = inA * outA * a;
      roundRect(cardX + pad + dx, ry, cardW - pad * 2, rowH, 14);
      ctx.fillStyle = row.fill;
      ctx.fill();
      text(row.text, cardX + pad + 34 + dx, ry + (V ? 66 : 52), V ? 30 : 26, row.color, 400);
      if (row.target) {
        // ↩ 图标（圆底 + 撤销箭头字形）
        const ix = cardX + pad - 34;
        const iy = ry + rowH / 2;
        const ia = ease(prog(local, 0.7, 0.4));
        ctx.globalAlpha = inA * outA * ia;
        ctx.beginPath();
        ctx.arc(ix, iy, 20, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 3;
        ctx.stroke();
        text('↩', ix - 11, iy + 10, V ? 30 : 28, C.fg, 400);
        ctx.globalAlpha = inA * outA;
      }
      ctx.globalAlpha = inA * outA;
    });
    ctx.globalAlpha = 1;
  }

  function sceneRestore(t) {
    const local = t - S.restore;
    const inA = ease(prog(local, 0.0, 0.4));
    const outA = 1 - ease(prog(t, S.outro - 0.4, 0.4));
    ctx.globalAlpha = inA * outA;

    if (V) {
      text('03', 110, 300, 40, C.accent, 700);
      text('还原原稿', 110, 420, 84, C.fg, 700);
      text('血统回溯 · 改坏了能找回', 110, 510, 32, C.muted, 400);
      chatCard(90, 560, W - 180, 620, 1);
    } else {
      text('03', 140, 300, 36, C.accent, 700);
      text('还原原稿', 140, 420, 78, C.fg, 700);
      text('血统回溯 · 改坏了能找回', 140, 510, 30, C.muted, 400);
      chatCard(1040, 220, W - 1180, 560, 1);
    }

    const cardX = V ? 90 : 1040;
    const cardY = V ? 560 : 220;
    const cardW = V ? W - 180 : W - 1180;
    const pad = 60;

    // 改写版（变暗）
    const dimK = ease(prog(local, 0.6, 0.8));
    ctx.globalAlpha = inA * outA * (1 - 0.55 * dimK);
    text('改写版', cardX + pad, cardY + 60, V ? 26 : 22, C.dim, 400);
    bubble(cardX + pad, cardY + 86, cardW - pad * 2, V ? 120 : 92, '#202024', 1);
    text('被改过的内容', cardX + pad + 30, cardY + 86 + (V ? 72 : 56), V ? 30 : 26, C.dim, 400);

    // 箭头
    const arrowK = ease(prog(local, 1.2, 0.5));
    const ax = cardX + cardW / 2;
    const ay = cardY + (V ? 250 : 210);
    ctx.globalAlpha = inA * outA * arrowK;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay + (V ? 90 : 70));
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax - 12, ay + 14);
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax + 12, ay + 14);
    ctx.stroke();

    // 原稿（高亮）
    const okK = ease(prog(local, 1.8, 0.6));
    ctx.globalAlpha = inA * outA * okK;
    text('原稿', cardX + pad, cardY + (V ? 360 : 300), V ? 26 : 22, C.muted, 400);
    bubble(cardX + pad, cardY + (V ? 386 : 326), cardW - pad * 2, V ? 140 : 110, '#23283A', 1);
    text('最初的版本回来了', cardX + pad + 30, cardY + (V ? 466 : 392), V ? 32 : 28, C.fg, 400);
    ctx.globalAlpha = 1;
  }

  function sceneOutro(t) {
    const local = t - S.outro;
    const a = ease(prog(local, 0.0, 0.6));
    ctx.globalAlpha = a * (1 - 0.0);
    const cx = W / 2;
    spaced('开源在 GitHub', cx, V ? 780 : 430, V ? 86 : 84, C.fg, 700, V ? 2 : 3);
    text('github.com/AtinyFurina/dsh-ctxedit', cx, V ? 900 : 530, V ? 42 : 42, C.accent, 400, 'center');
    text('MIT · 欢迎 issue / PR', cx, V ? 990 : 610, V ? 32 : 30, C.muted, 400, 'center');
    ctx.globalAlpha = 1;
  }

  const scenes = [
    { start: S.intro, end: S.rewrite, draw: sceneIntro },
    { start: S.rewrite, end: S.rewind, draw: sceneRewrite },
    { start: S.rewind, end: S.restore, draw: sceneRewind },
    { start: S.restore, end: S.outro, draw: sceneRestore },
    { start: S.outro, end: T, draw: sceneOutro },
  ];

  window.DURATION = T;
  window.seek = async (t) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    bg(t);
    // 交叉淡入：每个场景自己按时间控制 alpha，这里只按区间调用
    for (const s of scenes) {
      const fade = 0.45;
      if (t < s.start - fade || t > s.end + fade) continue;
      ctx.save();
      s.draw(t);
      ctx.restore();
    }
    // 首尾黑场
    const fadeIn = 1 - ease(prog(t, 0, 0.45));
    const fadeOut = ease(prog(t, T - 0.5, 0.5));
    if (fadeIn > 0 || fadeOut > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.max(fadeIn, fadeOut)})`;
      ctx.fillRect(0, 0, W, H);
    }
    footer(t, 0.55 * (1 - fadeOut));
    return true;
  };

  window.__ready = document.fonts.ready.then(() => true);
})();


