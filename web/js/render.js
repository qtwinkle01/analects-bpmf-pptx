/* render.js — 注音渲染引擎（瀏覽器 canvas 版）
 * 移植自 make_analects_deck.py 的 render_line / draw_manual_zhuyin。
 *
 * 破音字語法（與 YAML 完全相同）：
 *   字        → 字型預設讀音（該字形已內含注音）
 *   [字:1]    → 第 2 讀音，透過 IVS 選擇子 U+E01E1（= ss01）
 *   [字:2]    → 第 3 讀音，IVS U+E01E2（= ss02）
 *   [字|ㄉㄠˇ] → 字型未收錄的讀音，改用 ss00（純字，無注音）再手動合成注音
 */
(function (global) {
  'use strict';

  const FONT = 'BPMF';
  const TONES = 'ˊˇˋ˙';
  const SEL_BASE = 0xe01e0; // 變體選擇子：+0=ss00(純字), +1=ss01, +2=ss02 ...
  const RE_MARK = /\[(.)(?::(\d)|\|([^\]]+))\]/g;

  function isHan(ch) {
    const c = ch.codePointAt(0);
    return (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff);
  }

  // 解析含破音字標記的中文字串 → unit 陣列
  function parseZh(zh) {
    const units = [];
    let pos = 0, m;
    RE_MARK.lastIndex = 0;
    while ((m = RE_MARK.exec(zh))) {
      for (const ch of zh.slice(pos, m.index)) units.push({ ch, feat: null, manual: null });
      const base = m[1], idx = m[2], manual = m[3];
      units.push({ ch: base, feat: idx ? parseInt(idx, 10) : null, manual: manual || null });
      pos = m.index + m[0].length;
    }
    for (const ch of zh.slice(pos)) units.push({ ch, feat: null, manual: null });
    return units;
  }

  // 一個 unit 要送進 canvas 的字串（含變體選擇子）
  function unitText(u) {
    if (u.manual) return u.ch + String.fromCodePoint(SEL_BASE);          // 純字，注音另畫
    if (u.feat != null) return u.ch + String.fromCodePoint(SEL_BASE + u.feat); // 指定讀音
    return u.ch;                                                         // 預設（含注音）
  }

  class Renderer {
    constructor(fontFamily) {
      this.font = fontFamily || FONT;
      const c = document.createElement('canvas');
      this.mctx = c.getContext('2d'); // 量測用
    }

    _measure(text, size) {
      this.mctx.font = `${size}px ${this.font}`;
      return this.mctx.measureText(text).width;
    }

    // 手動合成注音直行（移植自 Python draw_manual_zhuyin）
    _drawManual(ctx, xCol, baseline, F, ann, fg) {
      const tone = TONES.includes(ann[ann.length - 1]) ? ann[ann.length - 1] : null;
      const syms = tone ? ann.slice(0, -1) : ann;
      const s = Math.round(F * 0.26);
      ctx.fillStyle = fg;
      ctx.font = `${s}px ${this.font}`;
      ctx.textBaseline = 'alphabetic';

      // 每個注音符號的實際高度
      const symList = Array.from(syms);
      const heights = symList.map((c) => {
        const m = ctx.measureText(c);
        return Math.max((m.actualBoundingBoxAscent || s * 0.7) + (m.actualBoundingBoxDescent || 0), s * 0.5);
      });
      const widths = symList.map((c) => ctx.measureText(c).width);

      const top = baseline - Math.round(F * 0.64);
      const bottom = baseline - Math.round(F * 0.04);
      const n = symList.length;
      const totalH = heights.reduce((a, b) => a + b, 0);
      let gap = n > 1 ? Math.floor((bottom - top - totalH) / n) : 0;
      gap = Math.max(gap, Math.round(F * 0.03));
      const stackH = totalH + gap * (n - 1);
      let y = top + Math.floor((bottom - top - stackH) / 2);

      let maxW = 0;
      const centers = [];
      for (let i = 0; i < n; i++) {
        const m = ctx.measureText(symList[i]);
        const asc = m.actualBoundingBoxAscent || s * 0.7;
        ctx.fillText(symList[i], xCol, y + asc);
        maxW = Math.max(maxW, widths[i]);
        centers.push(y + heights[i] / 2);
        y += heights[i] + gap;
      }
      if (tone) {
        const tm = ctx.measureText(tone);
        const tAsc = tm.actualBoundingBoxAscent || s * 0.7;
        const tx = xCol + maxW + Math.round(F * 0.02);
        const ty = centers[centers.length - 1] - (tAsc / 2);
        ctx.fillText(tone, tx, ty + tAsc / 2);
      }
    }

    /**
     * 渲染一行字到（新建的）canvas。
     * @returns {canvas, centers:[px], width, height, baseline}
     *   centers 是每個「漢字」的水平中心（px），用來對齊拼音。
     */
    renderLine(zh, size, fgRGB) {
      const fg = fgRGB || 'rgb(38,34,32)';
      const units = parseZh(zh);
      const pad = Math.round(size * 0.1);

      // 量寬
      const widths = units.map((u) => this._measure(unitText(u), size));
      const totalW = widths.reduce((a, b) => a + b, 0);
      const W = Math.ceil(totalW) + pad * 2;
      // 高度：預留注音在右上、字身在下
      const H = Math.ceil(size * 1.5);

      const canvas = document.createElement('canvas');
      const ratio = global.devicePixelRatio > 1 ? 2 : 1.5; // 提高解析度
      canvas.width = Math.ceil(W * ratio);
      canvas.height = Math.ceil(H * ratio);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.textBaseline = 'alphabetic';

      const baseline = Math.round(size * 1.05);
      let penX = pad;
      const centers = [];
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        ctx.fillStyle = fg;
        ctx.font = `${size}px ${this.font}`;
        ctx.fillText(unitText(u), penX, baseline);
        if (u.manual) {
          this._drawManual(ctx, Math.round(penX + size * 1.02), baseline, size, u.manual, fg);
        }
        if (isHan(u.ch)) centers.push(penX + size * 0.5); // 漢字中心（不含右側注音）
        penX += widths[i];
      }

      return { canvas, centers, width: W, height: H, baseline, ratio };
    }
  }

  global.BpmfRenderer = Renderer;
  global.BpmfParse = { parseZh, unitText, isHan, SEL_BASE };
})(window);
