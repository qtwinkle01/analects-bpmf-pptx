/* layout.js — 版面計算（移植自 make_analects_deck.py）
 * 產生一組「繪圖指令」(ops)，單位一律為「英吋」，投影片 10 x 7.5 吋 (4:3)。
 * 預覽 (preview.js) 與 PPTX 匯出 (pptx.js) 共用同一份 ops，確保兩者一致。
 *
 * op 型別：
 *   {t:'rect',  x,y,w,h, fill?, line?, radius?}
 *   {t:'image', canvas, x,y,w,h}
 *   {t:'text',  text, x,y,w,h, size(pt), color, align, bold?, italic?, valign?, cjk?, warn?}
 */
(function (global) {
  'use strict';

  const EMU = 914400;
  const emu = (v) => v / EMU;
  const SLIDE_W = 10, SLIDE_H = 7.5;
  const XM = 168165 / EMU;                       // 左右邊界
  const AVAIL = (9144000 - 168165 * 2) / EMU;    // 可用寬度
  const DPI = 120;                               // 注音圖：px → 英吋 的除數

  const C = {
    PAPER: 'FBF6EE', INK: 'rgb(38,34,32)', RED: '9C3626', RED_RGB: 'rgb(156,54,38)',
    PINYIN: '7A6A55', ENGLISH: '2F5D7C', LINE: 'D9C9AD', FOOT: '9C8F7C', CARD: 'F4ECDD',
  };

  function tagAndRule(ops, tag) {
    ops.push({ t: 'text', text: tag || '', x: SLIDE_W - emu(4600000) - XM, y: emu(170000),
      w: emu(4600000), h: emu(330000), size: 14, color: C.RED, align: 'right', bold: true, valign: 'top', cjk: true });
    ops.push({ t: 'rect', x: XM, y: emu(560000), w: AVAIL, h: emu(15000), fill: C.LINE });
  }

  function footer(ops, meta) {
    ops.push({ t: 'text', text: meta.label, x: XM, y: SLIDE_H - emu(300000),
      w: emu(5000000), h: emu(260000), size: 10, color: C.FOOT, align: 'left', valign: 'top', cjk: true });
    ops.push({ t: 'text', text: `${meta.idx} / ${meta.total}`, x: SLIDE_W - emu(2000000) - XM,
      y: SLIDE_H - emu(300000), w: emu(2000000), h: emu(260000), size: 10, color: C.FOOT, align: 'right', valign: 'top' });
  }

  // 課文區塊：注音圖 + 對齊拼音 + 英文；回傳下一個 y
  function block(renderer, ops, zh, py, en, y, size, compact) {
    const r = renderer.renderLine(zh, size, C.INK);
    let naturalW = r.width / DPI, scale = 1, w = naturalW;
    if (naturalW > AVAIL) { scale = AVAIL / naturalW; w = AVAIL; }
    const h = (r.height / DPI) * scale;
    ops.push({ t: 'image', canvas: r.canvas, x: XM, y, w, h });

    const yPy = y + h + emu(40000);
    if (py) {
      const toks = py.trim().split(/\s+/);
      const centers = r.centers.map((cx) => XM + (cx / DPI) * scale);
      if (toks.length === centers.length) {
        toks.forEach((tok, i) => ops.push({ t: 'text', text: tok, x: centers[i] - 0.765,
          y: yPy, w: 1.531, h: 0.437, size: 22, color: C.PINYIN, align: 'center', valign: 'top' }));
      } else {
        ops.push({ t: 'text', text: py, x: XM, y: yPy, w: AVAIL, h: 0.437,
          size: 22, color: C.PINYIN, align: 'left', valign: 'top', warn: true });
      }
    }
    const yEn = yPy + emu(430000);
    let yNext = yEn;
    if (en) {
      ops.push({ t: 'text', text: en, x: XM + emu(20000), y: yEn, w: AVAIL - emu(40000),
        h: emu(700000), size: 23, color: C.ENGLISH, align: 'left', valign: 'top' });
      yNext = yEn + (compact ? emu(430000) : emu(500000));
    }
    return yNext + (compact ? emu(60000) : emu(130000));
  }

  function contentOps(cfg, renderer, meta) {
    const ops = [];
    ops.push({ t: 'rect', x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: C.PAPER });
    tagAndRule(ops, cfg.tag);
    footer(ops, meta);
    const lines = cfg.lines || [];
    const nBlocks = (cfg.speaker ? 1 : 0) + lines.length;
    const compact = nBlocks >= 3;
    let y = emu(700000);
    if (cfg.speaker) y = block(renderer, ops, cfg.speaker.zh, cfg.speaker.py || '', cfg.speaker.en || '', y, 84, compact);
    for (const ln of lines) y = block(renderer, ops, ln.zh, ln.py || '', ln.en || '', y, 100, compact);
    return ops;
  }

  function vocabOps(cfg, renderer, meta) {
    const ops = [];
    ops.push({ t: 'rect', x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: C.PAPER });
    tagAndRule(ops, cfg.tag);
    footer(ops, meta);
    // 「生詞」標題
    const r = renderer.renderLine('生詞', 80, C.RED_RGB);
    const tw = r.width / DPI, th = r.height / DPI;
    ops.push({ t: 'image', canvas: r.canvas, x: XM, y: emu(750000), w: tw, h: th });
    const centers = r.centers.map((cx) => XM + cx / DPI);
    ['shēng', 'cí'].forEach((tok, i) => centers[i] != null && ops.push({ t: 'text', text: tok,
      x: centers[i] - 0.765, y: emu(750000) + th + emu(40000), w: 1.531, h: 0.437, size: 22, color: C.PINYIN, align: 'center', valign: 'top' }));
    const tail = (cfg.tag || '').split('·').pop().trim();
    ops.push({ t: 'text', text: 'Key Words · ' + tail, x: XM + tw + emu(250000), y: emu(900000),
      w: emu(4500000), h: 0.3, size: 18, color: C.FOOT, align: 'left', valign: 'top' });
    // 卡片
    const words = (cfg.words || []).slice(0, 3);
    const n = words.length;
    const gap = emu(200000);
    const cw = n ? (AVAIL - gap * (n - 1)) / n : AVAIL;
    const chCard = emu(3050000), cy0 = emu(2850000);
    words.forEach((wd, i) => {
      const cx0 = XM + i * (cw + gap);
      ops.push({ t: 'rect', x: cx0, y: cy0, w: cw, h: chCard, fill: C.CARD, line: C.LINE, radius: 0.12 });
      const wr = renderer.renderLine(wd.zh, 95, C.INK);
      const maxw = cw - emu(300000);
      let wwn = wr.width / DPI, ws = 1;
      if (wwn > maxw) { ws = maxw / wwn; wwn = maxw; }
      const wh = (wr.height / DPI) * ws;
      ops.push({ t: 'image', canvas: wr.canvas, x: cx0 + (cw - wwn) / 2, y: cy0 + emu(350000), w: wwn, h: wh });
      ops.push({ t: 'text', text: wd.py || '', x: cx0, y: cy0 + emu(350000) + wh + emu(100000),
        w: cw, h: 0.4, size: 24, color: C.PINYIN, align: 'center', valign: 'top' });
      ops.push({ t: 'text', text: wd.en || '', x: cx0 + emu(150000), y: cy0 + emu(350000) + wh + emu(560000),
        w: cw - emu(300000), h: 0.9, size: 17, color: C.ENGLISH, align: 'center', valign: 'top' });
    });
    return ops;
  }

  function centeredBlock(renderer, ops, zh, py, en, y, size, pySz, enSz) {
    const r = renderer.renderLine(zh, size, C.INK);
    let w = r.width / DPI, scale = 1;
    if (w > AVAIL) { scale = AVAIL / w; w = AVAIL; }
    const h = (r.height / DPI) * scale;
    ops.push({ t: 'image', canvas: r.canvas, x: (SLIDE_W - w) / 2, y, w, h });
    let yy = y + h + emu(60000);
    if (py) { ops.push({ t: 'text', text: py, x: 0, y: yy, w: SLIDE_W, h: 0.5, size: pySz, color: C.PINYIN, align: 'center', valign: 'top' }); yy += emu(480000); }
    if (en) { ops.push({ t: 'text', text: en, x: emu(400000), y: yy, w: SLIDE_W - emu(800000), h: 0.6, size: enSz, color: C.ENGLISH, align: 'center', valign: 'top' }); yy += emu(520000); }
    return yy;
  }

  function titleOps(cfg, renderer) {
    const ops = [];
    ops.push({ t: 'rect', x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: C.PAPER });
    ops.push({ t: 'rect', x: (SLIDE_W - emu(900000)) / 2, y: emu(950000), w: emu(900000), h: emu(28000), fill: C.RED });
    let y = centeredBlock(renderer, ops, cfg.zh_main, cfg.py_main || '', '', emu(1250000), 170, 32);
    y = centeredBlock(renderer, ops, cfg.zh_sub, cfg.py_sub || '', '', y + emu(150000), 100, 26);
    if (cfg.en) ops.push({ t: 'text', text: cfg.en, x: emu(400000), y: y + emu(150000), w: SLIDE_W - emu(800000), h: 0.5, size: 24, color: C.ENGLISH, align: 'center', valign: 'top' });
    if (cfg.note) ops.push({ t: 'text', text: cfg.note, x: emu(400000), y: y + emu(620000), w: SLIDE_W - emu(800000), h: 0.4, size: 15, color: C.FOOT, align: 'center', valign: 'top' });
    ops.push({ t: 'rect', x: (SLIDE_W - emu(900000)) / 2, y: SLIDE_H - emu(700000), w: emu(900000), h: emu(28000), fill: C.RED });
    return ops;
  }

  function endOps(cfg, renderer, meta) {
    const ops = [];
    ops.push({ t: 'rect', x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: C.PAPER });
    footer(ops, meta);
    ops.push({ t: 'rect', x: (SLIDE_W - emu(900000)) / 2, y: emu(1500000), w: emu(900000), h: emu(28000), fill: C.RED });
    const y = centeredBlock(renderer, ops, cfg.zh || '謝謝！', cfg.py || '', '', emu(2000000), 140, 30);
    if (cfg.en) ops.push({ t: 'text', text: cfg.en, x: emu(400000), y: y + emu(250000), w: SLIDE_W - emu(800000), h: 0.5, size: 22, color: C.ENGLISH, align: 'center', valign: 'top' });
    return ops;
  }

  function buildSlideOps(cfg, renderer, meta) {
    const t = cfg.type || 'content';
    if (t === 'title') return titleOps(cfg, renderer);
    if (t === 'vocab') return vocabOps(cfg, renderer, meta);
    if (t === 'end') return endOps(cfg, renderer, meta);
    return contentOps(cfg, renderer, meta);
  }

  global.AnalectsLayout = { buildSlideOps, SLIDE_W, SLIDE_H, COLORS: C };
})(window);
