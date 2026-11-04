/* pptx.js — 用 PptxGenJS 把 layout ops 組成 .pptx
 * 投影片上：漢字＋注音是圖片；拼音、英文、頁尾是文字方塊（可在 PowerPoint 裡修改）。
 * 一份簡報可以放一章或多章（整篇合輯），頁碼連續編號。
 */
(function (global) {
  'use strict';

  const EXPORT_RATIO = 3;   // 匯出時注音圖固定 3 倍解析度（與命令列版相同），不隨螢幕改變

  function loadLib() {
    if (global.PptxGenJS) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const v = (document.querySelector('meta[name="build-version"]') || {}).content || 'dev';
      s.src = `js/pptxgen.bundle.js?v=${v}`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('PptxGenJS 載入失敗'));
      document.head.appendChild(s);
    });
  }

  function addOpsToSlide(pptx, slide, ops) {
    for (const op of ops) {
      if (op.t === 'rect') {
        const shape = op.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
        const opt = { x: op.x, y: op.y, w: op.w, h: op.h,
          fill: op.fill ? { color: op.fill } : { type: 'none' },
          line: op.line ? { color: op.line, width: 0.75 } : { type: 'none' } };
        if (op.radius) opt.rectRadius = op.radius;
        slide.addShape(shape, opt);
      } else if (op.t === 'image') {
        slide.addImage({ data: op.canvas.toDataURL('image/png'), x: op.x, y: op.y, w: op.w, h: op.h });
      } else if (op.t === 'text') {
        slide.addText(op.text || '', {
          x: op.x, y: op.y, w: op.w, h: op.h,
          fontSize: op.size, color: op.warn ? 'B23B3B' : op.color,
          bold: !!op.bold, italic: !!op.italic,
          align: op.align || 'left', valign: op.valign || 'top',
          fontFace: op.cjk ? 'Microsoft JhengHei' : 'Calibri',
          margin: 0, wrap: true, lineSpacingMultiple: 1.0,
        });
      }
    }
  }

  /**
   * parts：[{ data: 章節物件, label: 頁尾文字 }, …]
   * 回傳 PptxGenJS 物件（呼叫端再決定 writeFile 或 write）
   */
  async function build(parts, renderer) {
    await loadLib();
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'A4x3', width: 10, height: 7.5 });
    pptx.layout = 'A4x3';
    const all = [];
    for (const p of parts) for (const cfg of (p.data.slides || [])) all.push({ cfg, label: p.label });
    const prev = renderer.forceRatio;
    renderer.forceRatio = EXPORT_RATIO;
    try {
      all.forEach((it, i) => {
        const ops = AnalectsLayout.buildSlideOps(it.cfg, renderer, { label: it.label, idx: i + 1, total: all.length });
        addOpsToSlide(pptx, pptx.addSlide(), ops);
      });
    } finally {
      renderer.forceRatio = prev;
    }
    return pptx;
  }

  async function download(parts, renderer, filename) {
    const pptx = await build(parts, renderer);
    await pptx.writeFile({ fileName: filename || 'analects.pptx' });
  }

  async function toBase64(parts, renderer) {
    const pptx = await build(parts, renderer);
    return pptx.write({ outputType: 'base64' });
  }

  global.AnalectsPptx = { build, download, toBase64, addOpsToSlide, EXPORT_RATIO };
})(window);
