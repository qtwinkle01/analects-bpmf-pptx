/* site.js — 網站主程式：路由與各頁面（老師版 index.html／開發者版 edit.html 共用）
 *
 * 網址（hash，重新整理、上一頁、加書籤都不會跑掉）：
 *   #/           目錄（20 篇）
 *   #/1          學而篇的章節列表
 *   #/1/6        老師版：學而 1.6 預覽與下載；開發者版：直接編輯
 *   #/1/6/edit   老師版：在網頁上修改學而 1.6
 * 修改都自動存在這台電腦的瀏覽器（草稿），不會動到正式資料。
 */
(function (global) {
  'use strict';

  const DEV = document.body.dataset.mode === 'dev';
  const BUILD = (document.querySelector('meta[name="build-version"]') || {}).content || 'dev';
  const { Drafts, Last, clone } = global.AnalectsData;
  const t = (k, v) => global.I18N.t(k, v);
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const link = (label, href, cls) => { const a = el('a', cls, label); a.href = href; return a; };
  const button = (label, cls, onClick) => {
    const b = el('button', 'btn ' + (cls || 'btn-ghost'), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  global.I18N.init(DEV ? 'zh' : undefined);

  let store = null, vocab = null, renderer = null, rendererReady = null;
  const ed = { id: null, data: null, editor: null, draftTimer: null, previewTimer: null };
  let routeSeq = 0;                 // 每次切換頁面 +1；非同步載入完成時用來判斷使用者是否已經離開

  const ready = (async () => {
    store = await global.AnalectsData.load(BUILD);
    vocab = global.AnalectsVocab.create(store.chapters, store.order, global.BpmfParse);
  })();

  function ensureRenderer() {
    if (!rendererReady) {
      rendererReady = (async () => {
        await document.fonts.load('40px BPMF', '學');
        await document.fonts.ready;
        renderer = new global.BpmfRenderer('BPMF');
        return renderer;
      })();
    }
    return rendererReady;
  }

  // ---------- 外框：頂列、頁尾 ----------
  function renderShell() {
    const brand = $('#brand');
    brand.innerHTML = '';
    brand.appendChild(el('span', 'brand-zh', DEV ? t('devBrand') : t('brand')));
    if (!DEV) brand.appendChild(el('span', 'brand-sub', t('brandSub')));
    const right = $('#topRight');
    right.innerHTML = '';
    if (DEV) {
      right.appendChild(link(t('teacherLink') + ' ↗', 'index.html', 'top-link'));
    } else {
      const sw = el('div', 'lang-switch');
      for (const [code, key] of [['zh', 'langZh'], ['en', 'langEn']]) {
        const b = el('button', global.I18N.lang === code ? 'active' : '', t(key));
        b.type = 'button';
        b.addEventListener('click', () => { if (global.I18N.lang !== code) { global.I18N.set(code); renderShell(); route(); } });
        sw.appendChild(b);
      }
      right.appendChild(sw);
    }
    const foot = $('#footer');
    foot.innerHTML = '';
    foot.appendChild(el('span', null, DEV ? '' : t('footerNote')));
    foot.appendChild(DEV ? link(t('teacherLink'), 'index.html') : link(t('devLink'), 'edit.html'));
    document.title = DEV ? t('devBrand') : `${t('brand')} · Analects Slides`;
  }

  function setView(name, crumbs) {
    document.body.className = 'view-' + name;
    const nav = $('#crumbs');
    nav.innerHTML = '';
    (crumbs || []).forEach((c, i) => {
      if (i) nav.appendChild(el('span', 'sep', '›'));
      nav.appendChild(c.href ? link(c.label, c.href) : el('span', 'here', c.label));
    });
    window.scrollTo(0, 0);
    return $('#main');
  }

  // ---------- 小工具 ----------
  const bookName = (b) => (global.I18N.lang === 'zh' ? `${b.zh}篇` : `${b.zh} · ${b.en}`);
  const hrefOf = (id, edit) => { const m = store.meta[id]; return `#/${m.book}/${m.ch}${edit ? '/edit' : ''}`; };
  const fmtTime = (ts) => new Date(ts).toLocaleString(global.I18N.lang === 'zh' ? 'zh-TW' : 'en-US',
    { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function statusBadge(id) {
    const s = store.status(id);
    return el('span', 'badge ' + (s === 'reviewed' ? 'ok' : 'dr'), s === 'reviewed' ? t('reviewed') : t(DEV ? 'draftD' : 'draftT'));
  }
  function draftBadge(id) {
    return Drafts.differs(id, store) ? el('span', 'badge lc', t(DEV ? 'localDraftD' : 'localDraft')) : null;
  }

  function toast(msg) {
    const box = $('#toast');
    box.textContent = msg;
    box.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => box.classList.add('hidden'), 3200);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 下載一章或整篇：沒有修改過、而且 CI 已經做好檔案 → 直接下載；否則在瀏覽器裡產生 */
  async function downloadChapters(ids, filename, prebuiltKey, btnEl) {
    const anyDraft = ids.some((id) => Drafts.differs(id, store));
    if (!anyDraft && store.prebuilt[prebuiltKey]) {
      const a = el('a');
      a.href = `${store.prebuilt[prebuiltKey]}?v=${BUILD}`;
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    const orig = btnEl ? btnEl.textContent : '';
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = t('generating'); }
    try {
      await ensureRenderer();
      const parts = ids.map((id) => { const data = store.current(id); return { data, label: store.footerOf(id, data) }; });
      await global.AnalectsPptx.download(parts, renderer, filename);
      toast(t('downloaded', { f: filename }));
    } catch (e) {
      console.error(e);
      toast(t('genFail', { e: e.message }));
    } finally {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = orig; }
    }
  }

  function drawSlides(container, id, data) {
    container.innerHTML = '';
    const label = store.footerOf(id, data);
    const slides = data.slides || [];
    slides.forEach((cfg, i) => {
      const canvas = el('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${t('slideN', { n: i + 1 })} / ${slides.length}`);
      try {
        const ops = global.AnalectsLayout.buildSlideOps(cfg, renderer, { label, idx: i + 1, total: slides.length });
        global.AnalectsPreview.drawOps(ops, canvas, 96);
      } catch (e) { console.error('slide', i, e); }
      container.appendChild(canvas);
    });
  }

  // ---------- 目錄 ----------
  function viewToc() {
    const main = setView('toc', []);
    main.innerHTML = '';
    const hero = el('section', 'hero');
    hero.appendChild(el('h1', null, t('tocTitle')));
    hero.appendChild(el('p', null, t(DEV ? 'devTocSub' : 'tocSub')));
    const last = Last.get();
    if (last && store.has(last)) {
      const b = store.bookOf(last);
      hero.appendChild(link(t('continueLast', { c: `${b.zh} ${store.label(last)}` }) + ' ▶', hrefOf(last, false), 'continue'));
    }
    main.appendChild(hero);

    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = t('search');
    search.setAttribute('aria-label', t('search'));
    main.appendChild(search);
    const results = el('section', 'results hidden');
    main.appendChild(results);

    const grid = el('section', 'book-grid');
    for (const b of store.books) {
      const ids = store.chaptersOf(b.num);
      const card = ids.length ? link('', `#/${b.num}`, 'book-card') : el('div', 'book-card off');
      card.appendChild(el('span', 'bk-num', t('bookNum', { n: b.num })));
      card.appendChild(el('span', 'bk-zh', b.zh));
      card.appendChild(el('span', 'bk-en', `${b.py} · ${b.en}`));
      if (ids.length) {
        const r = ids.filter((id) => store.status(id) === 'reviewed').length;
        card.appendChild(el('span', 'bk-count', `${t('chapters', { n: ids.length })} · ${t('reviewedOf', { r, n: ids.length })}`));
        const bar = el('span', 'progress');
        const fill = el('i');
        fill.style.width = `${Math.round((r / ids.length) * 100)}%`;
        bar.appendChild(fill);
        card.appendChild(bar);
        const nDraft = ids.filter((id) => Drafts.differs(id, store)).length;
        if (nDraft) card.appendChild(el('span', 'badge lc', `${t(DEV ? 'localDraftD' : 'localDraft')} ×${nDraft}`));
      } else {
        card.appendChild(el('span', 'bk-count', t('comingSoon')));
      }
      grid.appendChild(card);
    }
    main.appendChild(grid);

    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = search.value.trim().toLowerCase();
        grid.classList.toggle('hidden', !!q);
        results.classList.toggle('hidden', !q);
        results.innerHTML = '';
        if (!q) return;
        const hits = store.order.filter((id) => searchText(id).includes(q));
        results.appendChild(el('p', 'muted', hits.length ? t('searchCount', { n: hits.length }) : t('searchNone', { q: search.value.trim() })));
        hits.slice(0, 80).forEach((id) => results.appendChild(chapterRow(id, true)));
      }, 150);
    });
  }

  const searchCache = new Map();
  function searchText(id) {
    if (!searchCache.has(id)) {
      const parts = [];
      const strip = (zh) => global.BpmfParse.parseZh(zh || '').map((u) => u.ch).join('');
      for (const sl of store.official(id).slides || []) {
        for (const it of [sl.speaker, ...(sl.lines || []), ...(sl.words || [])]) {
          if (it) parts.push(strip(it.zh), it.en || '', it.py || '');
        }
      }
      searchCache.set(id, parts.join('\n').toLowerCase());
    }
    return searchCache.get(id);
  }

  // ---------- 一篇的章節列表 ----------
  function chapterRow(id, showBook) {
    const m = store.meta[id];
    const b = store.bookOf(id);
    const row = el('div', 'ch-row');
    const main = link('', hrefOf(id, false), 'ch-main');
    main.appendChild(el('span', 'ch-id', showBook ? `${b.zh} ${store.label(id)}` : store.label(id)));
    const txt = el('span', 'ch-text');
    txt.appendChild(el('span', 'ch-zh', m.first_zh));
    if (m.first_en) txt.appendChild(el('span', 'ch-en', m.first_en));
    main.appendChild(txt);
    row.appendChild(main);
    const side = el('div', 'ch-side');
    const badges = el('div', 'ch-badges');
    badges.appendChild(statusBadge(id));
    const d = draftBadge(id);
    if (d) badges.appendChild(d);
    side.appendChild(badges);
    const acts = el('div', 'ch-acts');
    if (DEV) {
      acts.appendChild(link(t('edit'), hrefOf(id, false), 'btn btn-primary btn-sm'));
    } else {
      acts.appendChild(link(t('preview'), hrefOf(id, false), 'btn btn-ghost btn-sm'));
      const dl = button(t('downloadPpt'), 'btn-primary btn-sm', () => downloadChapters([id], `${id}.pptx`, id, dl));
      acts.appendChild(dl);
    }
    side.appendChild(acts);
    row.appendChild(side);
    return row;
  }

  function viewBook(num) {
    const b = store.book(num);
    if (!b) return viewNotFound();
    const main = setView('book', [{ label: t('toc'), href: '#/' }, { label: bookName(b) }]);
    main.innerHTML = '';
    const ids = store.chaptersOf(num);
    const head = el('section', 'page-head');
    const h = el('div');
    h.appendChild(el('h1', null, `${b.zh}篇`));
    h.appendChild(el('p', 'muted', `${b.py} · ${b.en}${ids.length ? ' · ' + t('chapters', { n: ids.length }) : ''}`));
    head.appendChild(h);
    if (ids.length) {
      const r = ids.filter((id) => store.status(id) === 'reviewed').length;
      const acts = el('div', 'head-acts');
      acts.appendChild(el('span', 'muted', t('reviewedOf', { r, n: ids.length })));
      const dl = button(t('downloadBook'), 'btn-primary', () => downloadChapters(ids, `${b.zh}篇.pptx`, `book:${num}`, dl));
      acts.appendChild(dl);
      head.appendChild(acts);
    }
    main.appendChild(head);
    if (!ids.length) { main.appendChild(el('p', 'empty', t('emptyBook'))); return; }
    const list = el('section', 'ch-list');
    ids.forEach((id) => list.appendChild(chapterRow(id, false)));
    main.appendChild(list);
  }

  function navPair(id, edit) {
    const { prev, next } = store.neighbors(id);
    const box = el('div', 'nav-pair');
    const p = prev ? link(`◀ ${store.label(prev)}`, hrefOf(prev, edit), 'btn btn-ghost btn-sm') : el('span', 'btn btn-ghost btn-sm disabled', '◀');
    const n = next ? link(`${store.label(next)} ▶`, hrefOf(next, edit), 'btn btn-ghost btn-sm') : el('span', 'btn btn-ghost btn-sm disabled', '▶');
    p.title = t('prev'); n.title = t('next');
    box.appendChild(p); box.appendChild(n);
    return box;
  }

  // ---------- 老師版：一章的預覽與下載 ----------
  async function viewChapter(id) {
    const b = store.bookOf(id);
    const m = store.meta[id];
    const main = setView('chapter', [{ label: t('toc'), href: '#/' }, { label: bookName(b), href: `#/${b.num}` }, { label: store.label(id) }]);
    main.innerHTML = '';
    Last.set(id);
    const head = el('section', 'page-head');
    const h = el('div');
    const title = el('h1', null, `${b.zh} ${store.label(id)} `);
    title.appendChild(statusBadge(id));
    h.appendChild(title);
    h.appendChild(el('p', 'ch-zh', m.first_zh));
    if (m.first_en) h.appendChild(el('p', 'muted', m.first_en));
    head.appendChild(h);
    const acts = el('div', 'head-acts');
    const dl = button(t('downloadPpt'), 'btn-primary', () => downloadChapters([id], `${id}.pptx`, id, dl));
    acts.appendChild(dl);
    acts.appendChild(link(t('editOnWeb'), hrefOf(id, true), 'btn btn-ghost'));
    acts.appendChild(navPair(id, false));
    head.appendChild(acts);
    main.appendChild(head);
    if (Drafts.differs(id, store)) {
      const note = el('div', 'notice');
      note.appendChild(el('span', null, t('chapterEdited')));
      note.appendChild(button(t('restore'), 'btn-ghost btn-sm', () => {
        if (!confirm(t('restoreConfirm', { id }))) return;
        Drafts.del(id);
        route();
      }));
      main.appendChild(note);
    }
    const pv = el('section', 'slides');
    pv.appendChild(el('p', 'loading', t('loading')));
    main.appendChild(pv);
    const seq = routeSeq;
    await ensureRenderer();
    if (seq !== routeSeq) return;                        // 使用者已經離開這一頁
    drawSlides(pv, id, store.current(id));
  }

  // ---------- 編輯頁（開發者版 #/1/6、老師版 #/1/6/edit） ----------
  async function viewEditor(id) {
    const b = store.bookOf(id);
    const crumbs = [{ label: t('toc'), href: '#/' }, { label: bookName(b), href: `#/${b.num}` }];
    if (DEV) crumbs.push({ label: store.label(id) });
    else crumbs.push({ label: store.label(id), href: hrefOf(id, false) }, { label: t('edit') });
    const main = setView('edit', crumbs);
    main.innerHTML = '';
    Last.set(id);

    const bar = el('section', 'edit-bar');
    const titleBox = el('div', 'edit-title');
    titleBox.appendChild(el('h1', null, `${b.zh} ${store.label(id)}`));
    if (DEV) titleBox.appendChild(el('span', 'badge', ''));
    titleBox.appendChild(el('span', 'save-status', ''));
    bar.appendChild(titleBox);
    const acts = el('div', 'edit-actions');
    acts.appendChild(navPair(id, !DEV));
    const group = el('div', 'act-group');
    // 比較少用的動作：桌機直接排出來；手機收進「⋯ 更多」
    const more = el('div', 'act-more');
    if (DEV) {
      more.appendChild(button(t('markReviewed'), 'btn-ghost status-toggle', () => {
        ed.data.status = ed.data.status === 'reviewed' ? 'draft' : 'reviewed';
        changed();
      }));
    }
    more.appendChild(button(DEV ? t('reset') : t('restore'), 'btn-ghost', resetChapter));
    const file = el('input');
    file.type = 'file'; file.accept = '.yaml,.yml,.txt,text/yaml'; file.hidden = true;
    file.addEventListener('change', () => { if (file.files[0]) importFile(file.files[0]); file.value = ''; });
    more.appendChild(file);
    more.appendChild(button(DEV ? t('importYaml') : t('importMine'), 'btn-ghost', () => file.click()));
    more.appendChild(button(DEV ? t('exportYaml') : t('exportMine'), 'btn-ghost', exportYaml));
    const moreBtn = button(t('more'), 'btn-ghost more-btn', () => {
      more.classList.toggle('open');
      moreBtn.setAttribute('aria-expanded', more.classList.contains('open'));
    });
    moreBtn.setAttribute('aria-expanded', 'false');
    group.appendChild(moreBtn);
    group.appendChild(more);
    const dl = button(t('downloadPpt'), 'btn-primary', () => downloadCurrent(dl));
    group.appendChild(dl);
    acts.appendChild(group);
    bar.appendChild(acts);
    main.appendChild(bar);

    const tabs = el('div', 'ws-tabs');
    const ws = el('div', 'workspace');
    ws.dataset.pane = 'edit';
    for (const [pane, key] of [['edit', 'tabEdit'], ['preview', 'tabPreview']]) {
      const tb = el('button', pane === 'edit' ? 'active' : '', t(key));
      tb.type = 'button';
      tb.addEventListener('click', () => {
        ws.dataset.pane = pane;
        tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === tb));
        if (pane === 'preview') renderPreview();
        window.scrollTo(0, 0);
      });
      tabs.appendChild(tb);
    }
    main.appendChild(tabs);
    const edPane = el('section', 'editor-pane');
    edPane.appendChild(el('p', 'loading', t('loading')));
    const pvPane = el('section', 'preview-pane');
    const pvHead = el('div', 'preview-head');
    pvHead.appendChild(el('span', null, t('previewHead')));
    pvHead.appendChild(el('span', 'hint', t('previewHint')));
    pvPane.appendChild(pvHead);
    const pv = el('div', 'preview-scroll');
    pv.id = 'preview';
    pvPane.appendChild(pv);
    ws.appendChild(edPane);
    ws.appendChild(pvPane);
    main.appendChild(ws);

    const seq = routeSeq;
    await ensureRenderer();
    if (seq !== routeSeq) return;                        // 使用者已經離開這一頁
    ed.id = id;
    const base = store.official(id);
    const d = Drafts.get(id);
    if (d && d.data && JSON.stringify(d.data) !== JSON.stringify(base)) {
      ed.data = clone(d.data);
      toast(d.base !== JSON.stringify(base) ? t('draftStale') : t('draftLoaded', { time: fmtTime(d.savedAt) }));
    } else {
      if (d) Drafts.del(id);                     // 草稿已和官方版本相同（例如 YAML 已更新上線）
      ed.data = clone(base);
    }
    ed.editor = global.AnalectsEditor.create({ root: edPane, store, vocab, onChange: changed });
    ed.editor.open(id, ed.data);
    edPane.addEventListener('scroll', () => ed.editor && ed.editor.close(), { passive: true });
    updateStatus();
    schedulePreview(true);
  }

  function changed() {
    setStatus(t('saving'), 'dirty');
    clearTimeout(ed.draftTimer);
    ed.draftTimer = setTimeout(saveDraft, 400);
    schedulePreview();
    updateToggle();
  }

  function saveDraft() {
    clearTimeout(ed.draftTimer);
    ed.draftTimer = null;
    if (!ed.id) return;
    const base = JSON.stringify(store.official(ed.id));
    if (JSON.stringify(ed.data) === base) Drafts.del(ed.id);
    else if (!Drafts.set(ed.id, ed.data, base)) { setStatus(t('saveFail'), 'dirty'); return; }
    updateStatus();
  }

  function flushDraft() { if (ed.draftTimer) saveDraft(); }

  function setStatus(text, cls) {
    const s = $('.save-status');
    if (!s) return;
    s.textContent = text;
    s.className = 'save-status' + (cls ? ' ' + cls : '');
  }

  function updateStatus() {
    const d = Drafts.get(ed.id);
    if (d) setStatus(t(DEV ? 'savedD' : 'savedT', { time: fmtTime(d.savedAt) }), 'dirty');
    else setStatus(t(DEV ? 'sameD' : 'sameT'), '');
    updateToggle();
  }

  function updateToggle() {
    if (!DEV || !ed.data) return;
    const reviewed = ed.data.status === 'reviewed';
    const badge = $('.edit-title .badge');
    if (badge) { badge.textContent = reviewed ? t('reviewed') : t('draftD'); badge.className = 'badge ' + (reviewed ? 'ok' : 'dr'); }
    const tg = $('.status-toggle');
    if (tg) tg.textContent = reviewed ? t('markDraft') : t('markReviewed');
  }

  function schedulePreview(now) {
    clearTimeout(ed.previewTimer);
    ed.previewTimer = setTimeout(renderPreview, now ? 0 : 180);
  }

  function renderPreview() {
    const pv = $('#preview');
    if (!pv || !ed.data || !renderer) return;
    const ws = $('.workspace');
    // 手機上預覽分頁沒打開時先不畫，切過去再畫
    if (ws && getComputedStyle($('.preview-pane')).display === 'none') return;
    drawSlides(pv, ed.id, ed.data);
  }

  function resetChapter() {
    flushDraft();
    if (Drafts.differs(ed.id, store) && !confirm(t(DEV ? 'restoreConfirmD' : 'restoreConfirm', { id: ed.id }))) return;
    Drafts.del(ed.id);
    route();
  }

  async function downloadCurrent(btnEl) {
    flushDraft();
    const orig = btnEl.textContent;
    btnEl.disabled = true; btnEl.textContent = t('generating');
    try {
      await global.AnalectsPptx.download([{ data: ed.data, label: store.footerOf(ed.id, ed.data) }], renderer, `${ed.id}.pptx`);
      toast(t('downloaded', { f: `${ed.id}.pptx` }));
    } catch (e) {
      console.error(e);
      toast(t('genFail', { e: e.message }));
    } finally { btnEl.disabled = false; btnEl.textContent = orig; }
  }

  function exportYaml() {
    flushDraft();
    const text = global.AnalectsYaml.chapterToYaml(ed.data, ed.id);
    saveBlob(new Blob([text], { type: 'text/yaml;charset=utf-8' }), `${ed.id}.yaml`);
    toast(t(DEV ? 'exportedD' : 'exportedT', { f: `${ed.id}.yaml` }));
  }

  async function importFile(f) {
    const text = await f.text();
    let data;
    try {
      data = await global.AnalectsYaml.parse(text);
      const label = store.footerOf(ed.id, data);
      data.slides.forEach((cfg, i) => global.AnalectsLayout.buildSlideOps(cfg, renderer, { label, idx: i + 1, total: data.slides.length }));
    } catch (e) {
      toast(t('importBad', { e: e.message }));
      return;
    }
    const guess = global.AnalectsYaml.guessId(f.name, text).find((x) => store.has(x));
    const target = guess || ed.id;
    if (target !== ed.id) {
      flushDraft();
      Drafts.set(target, data, JSON.stringify(store.official(target)));
      toast(t('importSwitched', { a: target }));
      location.hash = hrefOf(target, !DEV);
      return;
    }
    ed.data = data;
    ed.editor.open(ed.id, ed.data);
    changed();
    toast(t('imported', { f: f.name }));
  }

  function viewNotFound() {
    const main = setView('toc', [{ label: t('toc'), href: '#/' }]);
    main.innerHTML = '';
    main.appendChild(el('p', 'empty', t('notFound')));
    main.appendChild(link(t('toc'), '#/', 'btn btn-ghost'));
  }

  // ---------- 路由 ----------
  async function route() {
    routeSeq++;
    flushDraft();
    if (ed.editor) ed.editor.close();
    ed.id = null; ed.data = null; ed.editor = null;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const bookNum = parts[0] ? parseInt(parts[0], 10) : null;
    const chNum = parts[1] ? parseInt(parts[1], 10) : null;
    try {
      if (bookNum && chNum) {
        const id = store.idOf(bookNum, chNum);
        if (!id) return viewNotFound();
        if (DEV || parts[2] === 'edit') return await viewEditor(id);
        return await viewChapter(id);
      }
      if (bookNum) return viewBook(bookNum);
      return viewToc();
    } catch (e) {
      console.error(e);
      $('#main').innerHTML = '';
      $('#main').appendChild(el('p', 'empty', t('loadFail', { e: e.message })));
    }
  }

  async function init() {
    renderShell();
    try {
      await ready;
    } catch (e) {
      $('#main').innerHTML = '';
      $('#main').appendChild(el('p', 'empty', t('loadFail', { e: e.message })));
      return;
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('pagehide', flushDraft);
    // 手機的「⋯ 更多」選單：點外面、或點了裡面的按鈕之後就收起來
    document.addEventListener('click', (e) => {
      const m = document.querySelector('.act-more.open');
      if (m && (!e.target.closest('.act-group') || (m.contains(e.target) && e.target.closest('button')))) m.classList.remove('open');
    });
    route();
  }

  // ---------- 給 CI 批次產生 PPT 用（只用官方版本，不讀草稿） ----------
  global.AnalectsApp = {
    ready,
    get store() { return store; },
    ensureRenderer,
    exportTargets() {
      const list = store.order.map((id) => ({ key: id, file: `${id}.pptx`, ids: [id] }));
      for (const b of store.books) {
        const ids = store.chaptersOf(b.num);
        if (ids.length) list.push({ key: `book:${b.num}`, file: `${b.zh}篇.pptx`, ids });
      }
      return list;
    },
    async buildBase64(ids) {
      await ensureRenderer();
      const parts = ids.map((id) => { const data = clone(store.official(id)); return { data, label: store.footerOf(id, data) }; });
      return global.AnalectsPptx.toBase64(parts, renderer);
    },
  };

  window.addEventListener('DOMContentLoaded', init);
})(window);
