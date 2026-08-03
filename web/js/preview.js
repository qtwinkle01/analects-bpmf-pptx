/* preview.js — 把 layout ops 畫到螢幕上的 canvas（所見即所得預覽） */
(function (global) {
  'use strict';

  function hex(c) { return c && c[0] !== '#' && !c.startsWith('rgb') ? '#' + c : c; }

  function wrapLines(ctx, text, maxW) {
    const words = String(text).split(/(\s+)/); // 保留空白
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (ctx.measureText(test).width > maxW && cur.trim()) { lines.push(cur.trimEnd()); cur = w.trimStart(); }
      else cur = test;
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines.length ? lines : [''];
  }

  // ops 單位為英吋；S = 每英吋像素
  function drawOps(ops, canvas, S) {
    const ctx = canvas.getContext('2d');
    canvas.width = Math.round(10 * S);
    canvas.height = Math.round(7.5 * S);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'top';

    for (const op of ops) {
      if (op.t === 'rect') {
        const x = op.x * S, y = op.y * S, w = op.w * S, h = op.h * S;
        if (op.fill) { ctx.fillStyle = hex(op.fill); if (op.radius) { roundRect(ctx, x, y, w, h, op.radius * S); ctx.fill(); } else ctx.fillRect(x, y, w, h); }
        if (op.line) { ctx.strokeStyle = hex(op.line); ctx.lineWidth = Math.max(1, 0.01 * S); if (op.radius) { roundRect(ctx, x, y, w, h, op.radius * S); ctx.stroke(); } else ctx.strokeRect(x, y, w, h); }
      } else if (op.t === 'image') {
        ctx.drawImage(op.canvas, op.x * S, op.y * S, op.w * S, op.h * S);
      } else if (op.t === 'text') {
        drawText(ctx, op, S);
      }
    }
  }

  function drawText(ctx, op, S) {
    const px = op.size * S / 72; // pt → px
    const family = op.cjk ? '"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif'
                          : '"Calibri","Segoe UI",Arial,sans-serif';
    ctx.font = `${op.bold ? '700 ' : ''}${op.italic ? 'italic ' : ''}${px}px ${family}`;
    ctx.fillStyle = op.warn ? '#b23b3b' : hex(op.color);
    ctx.textAlign = op.align === 'center' ? 'center' : op.align === 'right' ? 'right' : 'left';
    const boxX = op.x * S, boxY = op.y * S, boxW = op.w * S;
    let tx = boxX;
    if (op.align === 'center') tx = boxX + boxW / 2;
    else if (op.align === 'right') tx = boxX + boxW;
    const lines = wrapLines(ctx, op.text, boxW);
    const lh = px * 1.18;
    lines.forEach((ln, i) => ctx.fillText(ln, tx, boxY + i * lh));
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  global.AnalectsPreview = { drawOps };
})(window);
