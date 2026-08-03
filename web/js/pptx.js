/* pptx.js — 用 PptxGenJS 把 layout ops 組成 .pptx 並觸發下載 */
(function (global) {
  'use strict';

  function toDataURL(canvas) { return canvas.toDataURL('image/png'); }

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
        slide.addImage({ data: toDataURL(op.canvas), x: op.x, y: op.y, w: op.w, h: op.h });
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

  async function buildAndDownload(chapter, renderer, filename) {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'A4x3', width: 10, height: 7.5 });
    pptx.layout = 'A4x3';
    const label = chapter.footer || '論語 · 學而篇 | The Analects · Book One';
    const slidesCfg = chapter.slides || [];
    const total = slidesCfg.length;
    slidesCfg.forEach((cfg, i) => {
      const slide = pptx.addSlide();
      const meta = { label, idx: i + 1, total };
      const ops = AnalectsLayout.buildSlideOps(cfg, renderer, meta);
      addOpsToSlide(pptx, slide, ops);
    });
    await pptx.writeFile({ fileName: filename || 'analects.pptx' });
  }

  global.AnalectsPptx = { buildAndDownload, addOpsToSlide };
})(window);
