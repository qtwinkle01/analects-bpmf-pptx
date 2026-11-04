/* editor.js — 章節編輯器（老師版與開發者版共用）
 *
 * 可以改：讀音（點字選破音字或自訂注音）、拼音、英文、原文（改字）、生詞卡詞語，
 * 以及分頁結構：新增／刪除句子、上下移（可跨頁）、從某一句開始換頁、與下一頁合併、刪除整頁。
 * 每次修改都呼叫 onChange()，由呼叫端負責存草稿與更新預覽。
 */
(function (global) {
  'use strict';

  const t = (k, v) => global.I18N.t(k, v);
  const { parseZh, isHan, SEL_BASE } = global.BpmfParse;
  const TONES = 'ˊˇˋ˙';

  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const btn = (label, cls, onClick, title) => {
    const b = el('button', 'mini-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', onClick);
    return b;
  };

  function serialize(units) {
    return units.map((u) => {
      if (u.manual != null && u.manual !== '') return `[${u.ch}|${u.manual}]`;
      if (u.feat != null) return `[${u.ch}:${u.feat}]`;
      return u.ch;
    }).join('');
  }
  const plainText = (zh) => parseZh(zh || '').map((u) => u.ch).join('');
  const plainHan = (zh) => parseZh(zh || '').filter((u) => isHan(u.ch)).map((u) => u.ch).join('');
  const tokens = (py) => ((py || '').trim() ? py.trim().split(/\s+/) : []);

  /** 逐字比對新舊原文（最長共同子序列），回傳 keep / del / ins 操作 */
  function diffChars(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ op: 'keep', ai: i++, bi: j++ }); }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ op: 'del', ai: i++ });
      else ops.push({ op: 'ins', bi: j++ });
    }
    while (i < n) ops.push({ op: 'del', ai: i++ });
    while (j < m) ops.push({ op: 'ins', bi: j++ });
    return ops;
  }

  function create(opts) {
    const { root, store, onChange } = opts;
    const vocab = opts.vocab;
    let id = null;
    let data = null;
    const pop = document.getElementById('popover') || (() => {
      const p = el('div', 'popover hidden');
      p.id = 'popover';
      document.body.appendChild(p);
      return p;
    })();

    const changed = () => { if (onChange) onChange(); };
    const isContent = (sl) => sl && (sl.type || 'content') === 'content';

    // ---------- 整個編輯器 ----------
    function render() {
      closePopover();
      const scroll = root.scrollTop;
      root.innerHTML = '';
      const hint = el('div', 'editor-hint');
      hint.innerHTML = t('hint');
      root.appendChild(hint);
      (data.slides || []).forEach((slide, si) => root.appendChild(slideCard(slide, si)));
      root.scrollTop = scroll;
    }

    function slideCard(slide, si) {
      const slides = data.slides;
      const card = el('div', 'slide-card');
      const h = el('div', 'slide-head');
      const title = el('h3');
      title.appendChild(el('span', null, t('slideN', { n: si + 1 })));
      title.appendChild(el('span', 'type-badge', typeLabel(slide.type)));
      h.appendChild(title);
      const acts = el('div', 'slide-acts');
      const next = slides[si + 1];
      if (isContent(slide) && isContent(next) && !next.speaker) {
        acts.appendChild(btn(t('mergeNext'), '', () => {
          slide.lines = (slide.lines || []).concat(next.lines || []);
          slides.splice(si + 1, 1);
          render(); changed();
        }));
      }
      if (slides.length > 1) {
        acts.appendChild(btn(t('delSlide'), 'danger', () => {
          if (!confirm(t('delSlideConfirm', { n: si + 1 }))) return;
          slides.splice(si, 1);
          render(); changed();
        }));
      }
      h.appendChild(acts);
      card.appendChild(h);

      const tp = slide.type || 'content';
      if (tp === 'content') {
        if (slide.speaker) card.appendChild(zhRow(slide.speaker, t('speaker'), { si, li: -1 }));
        (slide.lines || []).forEach((ln, li) => card.appendChild(zhRow(ln, t('lineN', { n: li + 1 }), { si, li })));
        const add = el('div', 'add-row');
        add.appendChild(btn(t('addLine'), 'ghost', () => {
          slide.lines = slide.lines || [];
          slide.lines.push({ zh: '', py: '', en: '' });
          render(); changed();
          const rows = root.querySelectorAll('.slide-card')[si].querySelectorAll('.line-row');
          const last = rows[rows.length - 1];
          if (last && last._openText) last._openText();
        }));
        card.appendChild(add);
      } else if (tp === 'vocab') {
        (slide.words || []).forEach((wd, wi) => card.appendChild(zhRow(wd, t('wordN', { n: wi + 1 }), { vocab: true })));
      } else {
        card.appendChild(simpleRow(slide));
      }
      return card;
    }

    function typeLabel(tp) {
      return { content: t('tContent'), vocab: t('tVocab'), title: t('tTitle'), end: t('tEnd') }[tp || 'content'] || t('tContent');
    }

    // ---------- 一句（說話者／課文／生詞） ----------
    function zhRow(obj, roleLabel, where) {
      const row = el('div', 'line-row');
      const top = el('div', 'row-top');
      top.appendChild(el('div', 'role-tag', roleLabel));
      const tools = el('div', 'row-tools');
      top.appendChild(tools);
      row.appendChild(top);

      let wordInput = null, wordField = null;
      if (where.vocab) {
        wordField = el('div', 'field');
        wordField.appendChild(el('label', null, t('fWord')));
        wordInput = el('input');
        wordInput.type = 'text';
        wordInput.value = plainHan(obj.zh);
        wordInput.placeholder = t('wordPh');
        wordField.appendChild(wordInput);
        const hintMsg = el('div', 'hintmsg'); hintMsg.style.display = 'none';
        wordField.appendChild(hintMsg);
        wordField._hint = hintMsg;
        row.appendChild(wordField);
      }

      const zhLine = el('div', 'zh-line');
      renderZhLine(zhLine, obj);
      row.appendChild(zhLine);

      // 改原文
      const textBox = el('div', 'text-edit hidden');
      const textInput = el('input');
      textInput.type = 'text';
      textInput.placeholder = t('textPh');
      textBox.appendChild(textInput);
      let composing = false;
      textInput.addEventListener('compositionstart', () => { composing = true; });
      textInput.addEventListener('compositionend', () => { composing = false; });
      const applyText = () => {
        const before = obj.zh || '';
        applyZhEdit(obj, textInput.value);
        textBox.classList.add('hidden');
        if (obj.zh !== before) {
          renderZhLine(zhLine, obj);
          pyInput.value = obj.py || '';
          checkPy(obj, pyInput, pyField);
          changed();
        }
      };
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !composing && !e.isComposing) { e.preventDefault(); applyText(); }
        if (e.key === 'Escape') textBox.classList.add('hidden');
      });
      textBox.appendChild(btn(t('apply'), 'primary', applyText));
      textBox.appendChild(btn(t('cancel'), '', () => textBox.classList.add('hidden')));
      const openText = () => {
        textInput.value = plainText(obj.zh);
        textBox.classList.remove('hidden');
        textInput.focus();
      };
      row._openText = openText;
      if (!where.vocab) {
        row.appendChild(textBox);
        tools.appendChild(btn(t('editText'), '', openText));
      }

      // 句子的搬移、換頁、刪除（說話者與生詞不用）
      if (where.li != null && where.li >= 0) addLineTools(tools, where.si, where.li);

      // 拼音
      const pyField = el('div', 'field');
      pyField.appendChild(el('label', null, t('fPinyin')));
      const pyInput = el('input');
      pyInput.type = 'text'; pyInput.value = obj.py || '';
      pyInput.autocapitalize = 'off'; pyInput.spellcheck = false;
      pyInput.addEventListener('input', () => { obj.py = pyInput.value; checkPy(obj, pyInput, pyField); changed(); });
      pyField.appendChild(pyInput);
      const warn = el('div', 'warnmsg'); warn.style.display = 'none'; pyField.appendChild(warn);
      pyField._warn = warn;
      row.appendChild(pyField);
      checkPy(obj, pyInput, pyField);

      // 英文
      const enField = el('div', 'field');
      enField.appendChild(el('label', null, t('fEnglish')));
      const enInput = el('input');
      enInput.type = 'text'; enInput.value = obj.en || '';
      enInput.addEventListener('input', () => { obj.en = enInput.value; changed(); });
      enField.appendChild(enInput);
      row.appendChild(enField);

      if (where.vocab) {
        enInput.placeholder = t('enPh');
        let timer = null, comp = false;
        const apply = () => {
          const val = wordInput.value.trim();
          if (!plainHan(val) || plainHan(val) === plainHan(obj.zh)) return;
          const s = vocab.suggest(val, id);
          obj.zh = serialize(s.units);
          obj.py = s.py;
          obj.en = s.en;
          pyInput.value = obj.py;
          enInput.value = obj.en;
          renderZhLine(zhLine, obj);
          checkPy(obj, pyInput, pyField);
          showVocabHint(wordField._hint, s);
          changed();
        };
        const later = () => { clearTimeout(timer); timer = setTimeout(apply, 350); };
        // 注音／倉頡等輸入法選字過程中不要觸發
        wordInput.addEventListener('compositionstart', () => { comp = true; });
        wordInput.addEventListener('compositionend', () => { comp = false; later(); });
        wordInput.addEventListener('input', () => { if (!comp) later(); });
      }
      return row;
    }

    function addLineTools(tools, si, li) {
      const slides = data.slides;
      const slide = slides[si];
      const lines = slide.lines;
      const prevS = slides[si - 1], nextS = slides[si + 1];
      // 上移：同頁內交換；第一句移到上一頁最後（這頁有說話者時不行，否則句子會跑到說話者前面）
      const canUp = li > 0 || (isContent(prevS) && !slide.speaker);
      // 下移：同頁內交換；最後一句移到下一頁最前（下一頁有說話者時不行）
      const canDown = li < lines.length - 1 || (isContent(nextS) && !nextS.speaker);
      const up = btn('↑', '', () => {
        if (li > 0) { [lines[li - 1], lines[li]] = [lines[li], lines[li - 1]]; }
        else { prevS.lines = (prevS.lines || []).concat(lines.splice(0, 1)); dropEmpty(si); }
        render(); changed();
      }, t('moveUp'));
      up.disabled = !canUp;
      const down = btn('↓', '', () => {
        if (li < lines.length - 1) { [lines[li + 1], lines[li]] = [lines[li], lines[li + 1]]; }
        else { nextS.lines = lines.splice(li, 1).concat(nextS.lines || []); dropEmpty(si); }
        render(); changed();
      }, t('moveDown'));
      down.disabled = !canDown;
      tools.appendChild(up);
      tools.appendChild(down);
      if (li > 0) {
        tools.appendChild(btn(t('splitHere'), '', () => {
          const moved = lines.splice(li);
          slides.splice(si + 1, 0, { type: 'content', tag: slide.tag, lines: moved });
          render(); changed();
        }));
      }
      tools.appendChild(btn(t('delLine'), 'danger', () => {
        if (!confirm(t('delLineConfirm'))) return;
        lines.splice(li, 1);
        dropEmpty(si);
        render(); changed();
      }));
    }

    /** 一頁的句子都搬走、又沒有說話者 → 刪掉這頁 */
    function dropEmpty(si) {
      const sl = data.slides[si];
      if (isContent(sl) && !sl.speaker && !(sl.lines || []).length && data.slides.length > 1) data.slides.splice(si, 1);
    }

    /** 改原文：沒動到的字保留原本的讀音與拼音；新加的字從論語資料找讀音與拼音 */
    function applyZhEdit(obj, newText) {
      const oldUnits = parseZh(obj.zh || '');
      const newChars = Array.from(newText.replace(/\s+/g, ''));
      const ops = diffChars(oldUnits.map((u) => u.ch), newChars);
      const oldHan = [];
      oldUnits.forEach((u, i) => { if (isHan(u.ch)) oldHan.push(i); });
      const toks = tokens(obj.py);
      const aligned = toks.length === oldHan.length;
      const tokOf = new Map();
      if (aligned) oldHan.forEach((ui, k) => tokOf.set(ui, toks[k]));

      // 先找出新加的連續漢字，整段查讀音（有上下文比較準），查不到再逐字查
      const inserted = new Map();      // bi → { unit, tok }
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const text = run.map((bi) => newChars[bi]).join('');
        const s = vocab.suggest(text, id);
        const st = s ? tokens(s.py) : [];
        if (s && s.source !== 'none' && s.units.length === run.length && st.length === run.length) {
          run.forEach((bi, k) => inserted.set(bi, { unit: { ...s.units[k], ch: newChars[bi] }, tok: st[k] }));
        } else {
          run.forEach((bi) => {
            const one = vocab.suggest(newChars[bi], id);
            const ot = one ? tokens(one.py) : [];
            inserted.set(bi, {
              unit: one && one.units[0] ? { ...one.units[0], ch: newChars[bi] } : { ch: newChars[bi], feat: null, manual: null },
              tok: ot.length === 1 ? ot[0] : '?',
            });
          });
        }
        run = [];
      };
      for (const op of ops) {
        if (op.op === 'ins' && isHan(newChars[op.bi])) run.push(op.bi);
        else if (op.op !== 'del') flush();
      }
      flush();

      const units = [], newToks = [];
      for (const op of ops) {
        if (op.op === 'keep') {
          const u = oldUnits[op.ai];
          units.push({ ...u });
          if (isHan(u.ch) && aligned) newToks.push(tokOf.get(op.ai));
        } else if (op.op === 'ins') {
          const ch = newChars[op.bi];
          if (isHan(ch)) {
            const s = inserted.get(op.bi);
            units.push(s.unit);
            if (aligned) newToks.push(s.tok);
          } else {
            units.push({ ch, feat: null, manual: null });
          }
        }
      }
      obj.zh = serialize(units);
      if (aligned) obj.py = newToks.join(' ');
    }

    function showVocabHint(hintEl, s) {
      const msgs = [];
      let isWarn = false;
      if (s.source === 'vocab') msgs.push(t('vFromVocab', { from: s.from }));
      else if (s.source === 'text') msgs.push(t('vFromText', { from: s.from }));
      else if (s.source === 'chars') msgs.push(t('vFromChars'));
      else { msgs.push(t('vNone')); isWarn = true; }
      if (s.missing.length && s.source !== 'none') { msgs.push(t('vMissing', { c: s.missing.join('') })); isWarn = true; }
      if (s.notInFont.length) { msgs.push(t('vNotInFont', { c: s.notInFont.join('') })); isWarn = true; }
      hintEl.textContent = msgs.join(global.I18N.lang === 'zh' ? '。' : '. ');
      hintEl.classList.toggle('warn', isWarn);
      hintEl.style.display = 'block';
    }

    function checkPy(obj, input, field) {
      const han = parseZh(obj.zh || '').filter((u) => isHan(u.ch)).length;
      const toks = tokens(obj.py);
      const bad = toks.length !== han && toks.length !== 0;
      const q = toks.includes('?');
      input.classList.toggle('warn', bad || q);
      if (field._warn) {
        field._warn.style.display = bad || q ? 'block' : 'none';
        field._warn.textContent = bad ? t('pyMismatch', { a: toks.length, b: han }) : q ? t('pyQ') : '';
      }
    }

    // ---------- 一排可以點的字 ----------
    function renderZhLine(container, obj) {
      container.innerHTML = '';
      const units = parseZh(obj.zh || '');
      units.forEach((u, i) => {
        if (!isHan(u.ch)) { container.appendChild(el('span', 'zh-nonchar', u.ch)); return; }
        const span = el('span', 'zh-char editable');
        if (u.manual) {
          span.classList.add('is-manual');
          span.textContent = u.ch + String.fromCodePoint(SEL_BASE);    // 純字（右邊留著注音的位置）
          span.appendChild(manualZhuyin(u.manual));
          span.title = u.manual;
        } else {
          if ((store.readings || {})[u.ch]) span.classList.add('has-alt');
          span.textContent = u.ch + (u.feat != null ? String.fromCodePoint(SEL_BASE + u.feat) : '');
        }
        span.addEventListener('click', (ev) => openPopover(ev, obj, i, container));
        container.appendChild(span);
      });
    }

    /** 手動合成注音：直行排在字右邊預留的注音位置（跟投影片一樣），背景透明，字完整露出 */
    function manualZhuyin(ann) {
      const last = ann[ann.length - 1];
      const tone = TONES.includes(last) ? last : '';
      const syms = Array.from(tone ? ann.slice(0, -1) : ann);
      const wrap = el('span', 'mz');
      wrap.setAttribute('aria-hidden', 'true');
      const col = el('span', 'mz-col');
      if (tone === '˙') col.appendChild(el('span', 'mz-light', '˙'));
      syms.forEach((s) => col.appendChild(el('span', null, s)));
      wrap.appendChild(col);
      if (tone && tone !== '˙') wrap.appendChild(el('span', 'mz-tone', tone));
      return wrap;
    }

    // ---------- 破音字讀音選單 ----------
    function openPopover(ev, obj, unitIndex, container) {
      ev.stopPropagation();
      pop.innerHTML = '';
      const units = parseZh(obj.zh);
      const u = units[unitIndex];
      const ch = u.ch;
      pop.appendChild(el('h4', null, t('readingOf', { ch })));
      const optsBox = el('div', 'reading-opts');
      const mkOpt = (label, feat, isDefault) => {
        const o = el('button', 'reading-opt');
        o.type = 'button';
        o.textContent = ch + (feat != null ? String.fromCodePoint(SEL_BASE + feat) : '');
        o.appendChild(el('span', 'opt-label', label));
        const active = !u.manual && ((isDefault && u.feat == null) || (feat != null && u.feat === feat));
        if (active) o.classList.add('active');
        o.addEventListener('click', () => { applyReading(obj, unitIndex, { feat: isDefault ? null : feat, manual: null }, container); closePopover(); });
        return o;
      };
      optsBox.appendChild(mkOpt(t('rDefault'), null, true));
      ((store.readings || {})[ch] || []).forEach((idx) => optsBox.appendChild(mkOpt(t('rN', { n: idx + 1 }), idx, false)));
      pop.appendChild(optsBox);

      const mrow = el('div', 'manual-row');
      mrow.appendChild(el('label', null, t('rManual')));
      const mi = el('div', 'manual-input');
      const inp = el('input'); inp.type = 'text'; inp.placeholder = 'ㄉㄠˇ'; inp.value = u.manual || '';
      const set = btn(t('apply'), 'primary', () => {
        if (inp.value.trim()) { applyReading(obj, unitIndex, { feat: null, manual: inp.value.trim() }, container); closePopover(); }
      });
      mi.appendChild(inp); mi.appendChild(set);
      mrow.appendChild(mi);
      pop.appendChild(mrow);

      const actions = el('div', 'pop-actions');
      actions.appendChild(btn(t('rClear'), 'danger', () => { applyReading(obj, unitIndex, { feat: null, manual: null }, container); closePopover(); }));
      actions.appendChild(btn(t('close'), '', closePopover));
      pop.appendChild(actions);

      // 定位（手機上不超出畫面）
      pop.classList.remove('hidden');
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      pop.style.width = Math.min(300, vw - 16) + 'px';
      const rect = ev.currentTarget.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = rect.left + window.scrollX;
      let top = rect.bottom + window.scrollY + 6;
      if (left + pw > window.scrollX + vw - 8) left = window.scrollX + vw - pw - 8;
      if (top + ph > window.scrollY + vh - 8) top = rect.top + window.scrollY - ph - 6;
      pop.style.left = Math.max(8 + window.scrollX, left) + 'px';
      pop.style.top = Math.max(8 + window.scrollY, top) + 'px';
    }

    function applyReading(obj, unitIndex, change, container) {
      const units = parseZh(obj.zh);
      units[unitIndex].feat = change.feat;
      units[unitIndex].manual = change.manual;
      obj.zh = serialize(units);
      renderZhLine(container, obj);
      changed();
    }

    function closePopover() { pop.classList.add('hidden'); }
    document.addEventListener('click', (e) => {
      if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !e.target.closest('.zh-char')) closePopover();
    });

    // ---------- 標題頁／結尾頁：簡易文字欄位 ----------
    function simpleRow(slide) {
      const row = el('div', 'line-row');
      const fields = slide.type === 'title'
        ? [['zh_main', t('fZhMain')], ['py_main', t('fPyMain')], ['zh_sub', t('fZhSub')], ['py_sub', t('fPySub')], ['en', t('fEnglish')], ['note', t('fNote')]]
        : [['zh', t('fZh')], ['py', t('fPinyin')], ['en', t('fEnglish')]];
      fields.forEach(([k, lbl]) => {
        const f = el('div', 'field');
        f.appendChild(el('label', null, lbl));
        const inp = el('input'); inp.type = 'text'; inp.value = slide[k] || '';
        inp.addEventListener('input', () => { slide[k] = inp.value; changed(); });
        f.appendChild(inp);
        row.appendChild(f);
      });
      return row;
    }

    return {
      open(chapterId, chapterData) { id = chapterId; data = chapterData; render(); },
      render,
      get data() { return data; },
      close: closePopover,
      _applyZhEdit: (obj, text) => applyZhEdit(obj, text),   // 給自動測試用
    };
  }

  global.AnalectsEditor = { create, serialize, diffChars };
})(window);
