/* vocab.js — 生詞卡：輸入中文詞，自動帶出讀音（破音標記）、拼音與英文
 * 從全部章節資料建索引，依序查找，前一步找到就停：
 *   1. 任一章生詞卡已有同一個詞 → 讀音、拼音、英文全部帶入
 *   2. 課文中有連續相同的字     → 帶入該處的讀音與拼音（變調也跟著課文）
 *   3. 逐字到課文找讀音         → 取最常見的讀音；找不到的字留白
 * 目前章節的結果優先於其他章節。使用者在輸入時寫的 [字:N]／[字|注音] 會保留。
 */
(function (global) {
  'use strict';

  const UI_CHARS = '生詞謝';   // 與 build_assets.py 的 UI_CHARS 一致

  function create(chapters, order, parse) {
    const { parseZh, isHan } = parse;
    const ids = order.filter((id) => chapters[id]);
    const dict = [];            // {id, plain, zh, py, en}
    const segs = [];            // 連續漢字片段 {id, units, toks}
    const chars = new Map();    // 字 → [{id, unit, tok}]
    const fontChars = new Set(UI_CHARS);

    const hanUnits = (zh) => parseZh(zh || '').filter((u) => isHan(u.ch));
    const plainOf = (units) => units.map((u) => u.ch).join('');
    const cleanTok = (t) => t.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, '');
    const hasOverride = (u) => u.feat != null || !!u.manual;
    const sameReading = (a, b) => (a.feat ?? null) === (b.feat ?? null) && (a.manual || null) === (b.manual || null);

    function addLine(id, zh, py) {
      if (!zh || !py) return;
      const units = parseZh(zh);
      const toks = py.trim().split(/\s+/).map(cleanTok);
      if (units.filter((u) => isHan(u.ch)).length !== toks.length) return;
      let seg = null, k = 0;
      for (const u of units) {
        if (!isHan(u.ch)) { seg = null; continue; }
        if (!seg) { seg = { id, units: [], toks: [] }; segs.push(seg); }
        seg.units.push(u);
        seg.toks.push(toks[k]);
        if (!chars.has(u.ch)) chars.set(u.ch, []);
        chars.get(u.ch).push({ id, unit: u, tok: toks[k] });
        k++;
      }
    }

    // 精簡字型收錄的字 = 所有章節 zh 開頭欄位用到的字（與 build_assets.py 的 collect_chars 相同來源）
    function collectFont(node, key) {
      if (typeof node === 'string') {
        if (/^zh/.test(key || '')) hanUnits(node).forEach((u) => fontChars.add(u.ch));
      } else if (Array.isArray(node)) {
        node.forEach((v) => collectFont(v, key));
      } else if (node && typeof node === 'object') {
        Object.keys(node).forEach((k) => collectFont(node[k], k));
      }
    }

    for (const id of ids) {
      collectFont(chapters[id]);
      for (const sl of chapters[id].slides || []) {
        if (sl.speaker) addLine(id, sl.speaker.zh, sl.speaker.py);
        for (const ln of sl.lines || []) addLine(id, ln.zh, ln.py);
        for (const w of sl.words || []) {
          addLine(id, w.zh, w.py);
          dict.push({ id, plain: plainOf(hanUnits(w.zh)), zh: w.zh, py: w.py || '', en: w.en || '' });
        }
      }
    }

    function suggest(input, currentId, opts) {
      const useDict = !(opts && opts.dict === false);
      const typed = hanUnits(String(input || ''));
      const plain = plainOf(typed);
      if (!plain) return null;
      const pick = (list) => list.find((x) => x.id === currentId) || list[0];
      const keepTyped = (units) => units.map((u, i) => ({ ...(hasOverride(typed[i]) ? typed[i] : u) }));
      const notInFont = [...new Set(typed.map((u) => u.ch).filter((c) => !fontChars.has(c)))];
      const result = (r) => Object.assign({ en: '', from: null, missing: [], notInFont }, r);
      // 使用者指定了讀音的字，只採用讀音相同的來源（否則拼音會對不上）
      const compatible = (units) => typed.every((t, i) => !hasOverride(t) || sameReading(units[i], t));

      const d = useDict && pick(dict.filter((x) => x.plain === plain && compatible(hanUnits(x.zh))));
      if (d) return result({ units: keepTyped(hanUnits(d.zh)), py: d.py, en: d.en, source: 'vocab', from: d.id });

      const hits = [];
      for (const s of segs) {
        const at = plainOf(s.units).indexOf(plain);
        if (at < 0) continue;
        const us = s.units.slice(at, at + plain.length);
        if (compatible(us)) hits.push({ id: s.id, units: us, toks: s.toks.slice(at, at + plain.length) });
      }
      const h = pick(hits);
      if (h) return result({ units: keepTyped(h.units), py: h.toks.join(' '), source: 'text', from: h.id });

      const units = [], toks = [], missing = [];
      for (const t of typed) {
        let occ = chars.get(t.ch) || [];
        if (hasOverride(t)) occ = occ.filter((o) => sameReading(o.unit, t));
        if (!occ.length) { missing.push(t.ch); units.push({ ...t }); continue; }
        const cur = occ.find((o) => o.id === currentId);
        let best = cur;
        if (!best) {
          const count = new Map();
          for (const o of occ) {
            const key = `${o.unit.feat}|${o.unit.manual}|${o.tok}`;
            count.set(key, (count.get(key) || 0) + 1);
          }
          best = occ.reduce((a, b) => (count.get(`${b.unit.feat}|${b.unit.manual}|${b.tok}`) >
            count.get(`${a.unit.feat}|${a.unit.manual}|${a.tok}`) ? b : a));
        }
        units.push({ ...(hasOverride(t) ? t : best.unit) });
        toks.push(best.tok);
      }
      return result({ units, py: toks.join(' '), missing, source: missing.length === typed.length ? 'none' : 'chars' });
    }

    return { suggest, inFont: (ch) => fontChars.has(ch) };
  }

  global.AnalectsVocab = { create };
})(window);
