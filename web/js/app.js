/* app.js — 編輯器主邏輯 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  const state = { chapters: {}, order: [], readings: {}, id: null, chapter: null };
  let renderer = null;
  let previewTimer = null;

  // ---------- 破音字標記 (parse / serialize) ----------
  const parseZh = window.BpmfParse.parseZh;
  const isHan = window.BpmfParse.isHan;
  function serialize(units) {
    return units.map((u) => {
      if (u.manual != null && u.manual !== '') return `[${u.ch}|${u.manual}]`;
      if (u.feat != null) return `[${u.ch}:${u.feat}]`;
      return u.ch;
    }).join('');
  }

  // ---------- 載入 ----------
  async function loadAll() {
    const [idx, chs, rds] = await Promise.all([
      fetch('data/index.json').then((r) => r.json()),
      fetch('data/chapters.json').then((r) => r.json()),
      fetch('data/readings.json').then((r) => r.json()),
    ]);
    state.order = idx.chapters; state.chapters = chs; state.readings = rds;
    await document.fonts.load('40px BPMF');
    await document.fonts.load('30px BPMF');
    await document.fonts.ready;
    renderer = new window.BpmfRenderer('BPMF');
  }

  // ---------- 編輯器 ----------
  function selectChapter(id) {
    state.id = id;
    state.chapter = JSON.parse(JSON.stringify(state.chapters[id]));
    buildEditor();
    schedulePreview(true);
  }

  function buildEditor() {
    const root = $('#editor');
    root.innerHTML = '';
    const hint = el('div', 'editor-hint');
    hint.innerHTML =
      '點任一<b>漢字</b>可修改讀音（破音字）；<span class="legend"><span class="swatch" style="background:rgba(156,54,38,.5)"></span>有多音字型可選</span>、' +
      '<span class="legend"><span class="swatch" style="background:rgba(47,93,124,.6)"></span>已自訂注音</span>。拼音與英文可直接在下方輸入框修改，右側即時預覽。';
    root.appendChild(hint);

    (state.chapter.slides || []).forEach((slide, si) => {
      const card = el('div', 'slide-card');
      const h = el('h3');
      h.appendChild(el('span', null, `投影片 ${si + 1}`));
      h.appendChild(el('span', 'type-badge', slideTypeLabel(slide.type)));
      card.appendChild(h);

      const t = slide.type || 'content';
      if (t === 'content') {
        if (slide.speaker) card.appendChild(zhEditRow(slide.speaker, '說話者'));
        (slide.lines || []).forEach((ln, li) => card.appendChild(zhEditRow(ln, `第 ${li + 1} 句`)));
      } else if (t === 'vocab') {
        (slide.words || []).forEach((wd, wi) => card.appendChild(zhEditRow(wd, `生詞 ${wi + 1}`, true)));
      } else {
        card.appendChild(simpleRow(slide));
      }
      root.appendChild(card);
    });
  }

  function slideTypeLabel(t) {
    return { content: '課文', vocab: '生詞卡', title: '標題頁', end: '結尾頁' }[t || 'content'] || '課文';
  }

  // 一個含 .zh 的可編輯物件（line / speaker / word）
  function zhEditRow(obj, roleLabel, isVocab) {
    const row = el('div', 'line-row');
    if (roleLabel) row.appendChild(el('div', 'role-tag', roleLabel));

    const zhLine = el('div', 'zh-line');
    renderZhLine(zhLine, obj);
    row.appendChild(zhLine);

    // 拼音
    const pyField = el('div', 'field');
    pyField.appendChild(el('label', null, '拼音'));
    const pyInput = el('input');
    pyInput.type = 'text'; pyInput.value = obj.py || '';
    pyInput.addEventListener('input', () => { obj.py = pyInput.value; checkPy(obj, pyInput, pyField); schedulePreview(); });
    pyField.appendChild(pyInput);
    const warn = el('div', 'warnmsg'); warn.style.display = 'none'; pyField.appendChild(warn);
    pyField._warn = warn; pyField._input = pyInput;
    row.appendChild(pyField);
    checkPy(obj, pyInput, pyField);

    // 英文
    const enField = el('div', 'field');
    enField.appendChild(el('label', null, '英文'));
    const enInput = el('input');
    enInput.type = 'text'; enInput.value = obj.en || '';
    enInput.addEventListener('input', () => { obj.en = enInput.value; schedulePreview(); });
    enField.appendChild(enInput);
    row.appendChild(enField);

    row._zhLine = zhLine;
    return row;
  }

  function checkPy(obj, input, field) {
    const units = parseZh(obj.zh);
    const han = units.filter((u) => isHan(u.ch)).length;
    const toks = (obj.py || '').trim() ? obj.py.trim().split(/\s+/).length : 0;
    const bad = toks !== han && toks !== 0;
    input.classList.toggle('warn', bad);
    if (field._warn) {
      field._warn.style.display = bad ? 'block' : 'none';
      field._warn.textContent = bad ? `拼音音節數 ${toks} 與漢字數 ${han} 不符（標點不算）` : '';
    }
  }

  // 把 obj.zh 畫成一排可點的字
  function renderZhLine(container, obj) {
    container.innerHTML = '';
    const units = parseZh(obj.zh);
    units.forEach((u, i) => {
      if (!isHan(u.ch)) { container.appendChild(el('span', 'zh-nonchar', u.ch)); return; }
      const span = el('span', 'zh-char editable');
      const hasAlt = !!state.readings[u.ch];
      if (u.manual) {
        span.classList.add('is-manual');
        span.textContent = u.ch + String.fromCodePoint(window.BpmfParse.SEL_BASE); // 純字
        const badge = el('span', 'manual-badge', u.manual);
        span.appendChild(badge);
      } else {
        if (hasAlt) span.classList.add('has-alt');
        span.textContent = u.ch + (u.feat != null ? String.fromCodePoint(window.BpmfParse.SEL_BASE + u.feat) : '');
      }
      span.addEventListener('click', (ev) => openPopover(ev, obj, i, container));
      container.appendChild(span);
    });
  }

  // ---------- 破音字讀音選單 ----------
  function openPopover(ev, obj, unitIndex, container) {
    ev.stopPropagation();
    const pop = $('#popover');
    pop.innerHTML = '';
    const units = parseZh(obj.zh);
    const u = units[unitIndex];
    const ch = u.ch;

    pop.appendChild(el('h4', null, `「${ch}」讀音`));
    const opts = el('div', 'reading-opts');

    const mkOpt = (label, feat, isDefault) => {
      const o = el('div', 'reading-opt');
      o.textContent = ch + (feat != null ? String.fromCodePoint(window.BpmfParse.SEL_BASE + feat) : '');
      o.appendChild(el('span', 'opt-label', label));
      const active = !u.manual && ((isDefault && u.feat == null) || (feat != null && u.feat === feat));
      if (active) o.classList.add('active');
      o.addEventListener('click', () => { applyReading(obj, unitIndex, { feat: isDefault ? null : feat, manual: null }, container); closePopover(); });
      return o;
    };
    opts.appendChild(mkOpt('預設', null, true));
    (state.readings[ch] || []).forEach((idx) => opts.appendChild(mkOpt('讀音' + (idx + 1), idx, false)));
    pop.appendChild(opts);

    // 自訂注音
    const mrow = el('div', 'manual-row');
    mrow.appendChild(el('label', null, '自訂注音（字型未收錄的讀音，如 ㄉㄠˇ）'));
    const mi = el('div', 'manual-input');
    const inp = el('input'); inp.type = 'text'; inp.placeholder = 'ㄉㄠˇ'; inp.value = u.manual || '';
    const mini = el('span', 'mini'); mini.textContent = u.manual || '';
    inp.addEventListener('input', () => { mini.textContent = inp.value; });
    const setBtn = el('button', null, '套用'); setBtn.style.cssText = 'padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:var(--red);color:#fff;cursor:pointer;';
    setBtn.addEventListener('click', () => { if (inp.value.trim()) { applyReading(obj, unitIndex, { feat: null, manual: inp.value.trim() }, container); closePopover(); } });
    mi.appendChild(inp); mi.appendChild(setBtn); mi.appendChild(mini);
    mrow.appendChild(mi);
    pop.appendChild(mrow);

    const actions = el('div', 'pop-actions');
    const clr = el('button', 'clear', '清除（回預設）');
    clr.addEventListener('click', () => { applyReading(obj, unitIndex, { feat: null, manual: null }, container); closePopover(); });
    const cls = el('button', null, '關閉'); cls.addEventListener('click', closePopover);
    actions.appendChild(clr); actions.appendChild(cls);
    pop.appendChild(actions);

    // 定位
    pop.classList.remove('hidden');
    const rect = ev.target.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 6;
    if (left + pw > window.scrollX + document.documentElement.clientWidth - 10) left = window.scrollX + document.documentElement.clientWidth - pw - 10;
    if (top + ph > window.scrollY + document.documentElement.clientHeight - 10) top = rect.top + window.scrollY - ph - 6;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function applyReading(obj, unitIndex, change, container) {
    const units = parseZh(obj.zh);
    units[unitIndex].feat = change.feat;
    units[unitIndex].manual = change.manual;
    obj.zh = serialize(units);
    renderZhLine(container, obj);
    schedulePreview();
  }

  function closePopover() { $('#popover').classList.add('hidden'); }
  document.addEventListener('click', (e) => { const p = $('#popover'); if (!p.classList.contains('hidden') && !p.contains(e.target) && !e.target.classList.contains('zh-char')) closePopover(); });

  // title/end 頁：簡易文字欄位
  function simpleRow(slide) {
    const row = el('div', 'line-row');
    const fields = slide.type === 'title'
      ? [['zh_main', '主標中文'], ['py_main', '主標拼音'], ['zh_sub', '副標中文'], ['py_sub', '副標拼音'], ['en', '英文'], ['note', '註記']]
      : [['zh', '中文'], ['py', '拼音'], ['en', '英文']];
    fields.forEach(([k, lbl]) => {
      const f = el('div', 'field');
      f.appendChild(el('label', null, lbl));
      const inp = el('input'); inp.type = 'text'; inp.value = slide[k] || '';
      inp.addEventListener('input', () => { slide[k] = inp.value; schedulePreview(); });
      f.appendChild(inp); row.appendChild(f);
    });
    return row;
  }

  // ---------- 預覽 ----------
  function schedulePreview(immediate) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, immediate ? 0 : 180);
  }

  function renderPreview() {
    const pane = $('#preview');
    pane.innerHTML = '';
    const label = state.chapter.footer || '論語 · 學而篇 | The Analects · Book One';
    const slides = state.chapter.slides || [];
    slides.forEach((cfg, i) => {
      const canvas = el('canvas');
      const meta = { label, idx: i + 1, total: slides.length };
      try {
        const ops = window.AnalectsLayout.buildSlideOps(cfg, renderer, meta);
        window.AnalectsPreview.drawOps(ops, canvas, 96);
      } catch (e) { console.error('slide', i, e); }
      pane.appendChild(canvas);
    });
  }

  // ---------- 下載 ----------
  async function download() {
    const btn = $('#downloadBtn');
    btn.disabled = true; const orig = btn.textContent; btn.textContent = '產生中…';
    try {
      await window.AnalectsPptx.buildAndDownload(state.chapter, renderer, `${state.id}.pptx`);
      toast('已下載 ' + state.id + '.pptx');
    } catch (e) { console.error(e); toast('產生失敗：' + e.message); }
    finally { btn.disabled = false; btn.textContent = orig; }
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  // ---------- 啟動 ----------
  async function init() {
    try {
      await loadAll();
    } catch (e) { $('#editor').innerHTML = '<div class="loading">載入資料失敗：' + e.message + '</div>'; return; }
    const sel = $('#chapterSelect');
    state.order.forEach((id) => { const o = el('option', null, id.replace('學而', '學而 ')); o.value = id; sel.appendChild(o); });
    sel.addEventListener('change', () => selectChapter(sel.value));
    $('#downloadBtn').addEventListener('click', download);
    $('#resetBtn').addEventListener('click', () => selectChapter(state.id));
    const first = state.order.indexOf('學而1.5') >= 0 ? '學而1.5' : state.order[0];
    sel.value = first;
    selectChapter(first);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
