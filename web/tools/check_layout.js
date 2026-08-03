#!/usr/bin/env node
/*
 * check_layout.js — 部署前的版面／資料自動檢查
 * ===========================================
 * 在沒有瀏覽器的環境（例如 GitHub Actions）驗證網頁編輯器不會爛掉。
 * 做法：用 font_widths.py 匯出的真實字寬表模擬 canvas 的 measureText()，
 * 然後實際載入 render.js + layout.js，把 data/chapters.json 全部章節
 * 每一頁都跑一次版面計算。
 *
 * 會擋下部署的錯誤：
 *   - 版面計算丟例外、座標算出 NaN
 *   - 拼音音節數 ≠ 漢字數（投影片上拼音會對不準漢字）
 *   - YAML 用了 [字:N] 但字型根本沒有該讀音
 *   - index.json 列了 chapters.json 沒有的章節
 *   - 精簡字型缺字（會在網頁上顯示成空白方框）
 *
 * 用法：
 *   python3 web/tools/font_widths.py --out /tmp/widths.json
 *   node    web/tools/check_layout.js /tmp/widths.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const widthsPath = process.argv[2] || path.join(__dirname, '.widths.json');

if (!fs.existsSync(widthsPath)) {
  console.error(`找不到字寬表 ${widthsPath}\n請先執行：python3 web/tools/font_widths.py --out ${widthsPath}`);
  process.exit(2);
}
const W = JSON.parse(fs.readFileSync(widthsPath, 'utf8'));

// ---------- 用字寬表模擬 canvas ----------
const missing = new Set();
const isSelector = (cp) => cp >= 0xe0100 && cp <= 0xe01ef;

function advance(cp, sel) {
  if (sel != null && W.ivs[`${cp}:${sel}`] != null) return W.ivs[`${cp}:${sel}`];
  return W.default[String(cp)];
}

function measure(text, size) {
  const cps = Array.from(text).map((c) => c.codePointAt(0));
  let total = 0;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (isSelector(cp)) continue;                     // 選擇子本身不佔寬度
    const sel = isSelector(cps[i + 1]) ? cps[i + 1] : null;
    const a = advance(cp, sel);
    if (a == null) {
      missing.add(String.fromCodePoint(cp));
      total += size;
      continue;
    }
    total += (a / W.upm) * size;
  }
  return total;
}

function makeCtx() {
  let font = '16px BPMF';
  return {
    set font(v) { font = v; },
    get font() { return font; },
    fillStyle: '',
    textBaseline: '',
    measureText(t) {
      const s = parseFloat(font) || 16;
      return { width: measure(t, s), actualBoundingBoxAscent: s * 0.8, actualBoundingBoxDescent: s * 0.1 };
    },
    fillText() {},
    scale() {},
  };
}

const document = { createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }) };
const window = { devicePixelRatio: 2, document };
global.window = window;
global.document = document;

// ---------- 載入受測程式 ----------
for (const f of ['js/render.js', 'js/layout.js']) {
  const code = fs.readFileSync(path.join(WEB, f), 'utf8');
  new Function('window', 'document', code)(window, document);
}

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(WEB, p), 'utf8'));
const chapters = readJson('data/chapters.json');
const index = readJson('data/index.json');
const readings = readJson('data/readings.json');

const renderer = new window.BpmfRenderer('BPMF');
const { buildSlideOps, SLIDE_W, SLIDE_H } = window.AnalectsLayout;
const { parseZh, isHan } = window.BpmfParse;

const errors = [];
const warns = [];
let nSlides = 0;
let nOps = 0;

const RE_MARK_G = /\[(.)(?::(\d)|\|([^\]]+))\]/g;

for (const id of index.chapters) {
  const cfg = chapters[id];
  if (!cfg) {
    errors.push(`${id}：index.json 有列，但 chapters.json 找不到`);
    continue;
  }
  const slides = cfg.slides || [];
  if (!slides.length) errors.push(`${id}：沒有任何投影片`);

  slides.forEach((sl, i) => {
    nSlides++;
    const where = `${id} 第 ${i + 1} 頁`;
    let ops;
    try {
      ops = buildSlideOps(sl, renderer, { label: cfg.footer || '', idx: i + 1, total: slides.length });
    } catch (e) {
      errors.push(`${where}：版面計算丟出例外 — ${e.message}`);
      return;
    }
    nOps += ops.length;

    for (const op of ops) {
      // layout.js 在拼音音節數對不上時會標 warn，這是版面上看得出來的錯
      if (op.warn) errors.push(`${where}：拼音無法逐字對齊 → "${op.text}"`);

      const { x, y } = op;
      const w = op.w ?? 0;
      const h = op.h ?? 0;
      if (![x, y, w, h].every(Number.isFinite)) {
        errors.push(`${where}：${op.t} 座標算出 NaN/Infinity`);
        continue;
      }
      // 文字框刻意留高（valign: top，多的高度不會畫出東西），只警告不擋
      if (y + h > SLIDE_H + 0.02) {
        warns.push(`${where}：${op.t} 框底 ${(y + h).toFixed(2)}" 超過 ${SLIDE_H}"${op.text ? ` → "${String(op.text).slice(0, 30)}"` : ''}`);
      }
      if (x < -0.02 || x + w > SLIDE_W + 0.02) {
        warns.push(`${where}：${op.t} 框寬超出左右邊界 x=${x.toFixed(2)} w=${w.toFixed(2)}`);
      }
    }

    // 直接對資料檢查：漢字數必須等於拼音音節數
    const checkPy = (o, label) => {
      if (!o || !o.zh || !o.py) return;
      const han = parseZh(o.zh).filter((u) => isHan(u.ch)).length;
      const syl = o.py.trim().split(/\s+/).length;
      if (han !== syl) errors.push(`${where} ${label}：漢字 ${han} 個 vs 拼音 ${syl} 音節 → ${o.zh} / ${o.py}`);
    };
    checkPy(sl.speaker, '（說話者）');
    (sl.lines || []).forEach((ln, k) => checkPy(ln, `（第 ${k + 1} 句）`));
  });

  // 破音字標記 [字:N] 必須是字型真的有的讀音
  const marks = JSON.stringify(cfg).match(RE_MARK_G) || [];
  for (const mk of marks) {
    const m = /\[(.)(?::(\d)|\|([^\]]+))\]/.exec(mk);
    if (!m[2]) continue;
    const avail = readings[m[1]];
    const want = parseInt(m[2], 10);
    if (!avail || !avail.includes(want)) {
      errors.push(`${id}：${mk} 但字型沒有這個讀音（可用：${avail ? avail.join(', ') : '無'}）`);
    }
  }
}

if (missing.size) {
  errors.push(`精簡字型缺字（網頁會顯示空白方框）：${[...missing].join(' ')}　→ 請把它們加進 build_assets.py 的 UI_CHARS`);
}

console.log(`檢查完成：${index.chapters.length} 章、${nSlides} 頁、${nOps} 個繪圖指令`);
if (warns.length) {
  console.log(`\n⚠️  警告 ${warns.length} 則（不擋部署，多為文字框刻意留高／拼音框置中溢出）`);
  warns.slice(0, 10).forEach((w) => console.log('   ' + w));
  if (warns.length > 10) console.log(`   …另有 ${warns.length - 10} 則`);
}
if (errors.length) {
  console.log(`\n❌ 錯誤 ${errors.length} 則：`);
  errors.forEach((e) => console.log('   ' + e));
  process.exit(1);
}
console.log('\n✅ 沒有錯誤。');
