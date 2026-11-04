/* data.js — 載入資料、篇章查詢、瀏覽器草稿
 *
 * 資料由 tools/build_assets.py 從 examples/v2/*.yaml 產生：
 *   data/index.json     篇名表 books、章節順序 chapters、每章 meta（篇號、章號、狀態、第一句）
 *   data/chapters.json  各章完整內容
 *   data/readings.json  破音字可選的讀音
 *   data/pptx.json      （CI 才有）事先產生好的 PPT 檔案清單；沒有時改在瀏覽器裡即時產生
 */
(function (global) {
  'use strict';

  const clone = (o) => JSON.parse(JSON.stringify(o));

  async function load(build) {
    const get = async (p) => {
      const r = await fetch(`${p}?v=${build}`);
      if (!r.ok) throw new Error(`${p}（HTTP ${r.status}）`);
      return r.json();
    };
    const [index, chapters, readings] = await Promise.all([
      get('data/index.json'), get('data/chapters.json'), get('data/readings.json'),
    ]);
    let prebuilt = {};
    try {
      const r = await fetch(`data/pptx.json?v=${build}`);
      if (r.ok) prebuilt = await r.json();
    } catch (e) { /* 本機開發時沒有，改即時產生 */ }
    return new Store(index, chapters, readings, prebuilt);
  }

  class Store {
    constructor(index, chapters, readings, prebuilt) {
      this.books = index.books || [];
      this.chapters = chapters;
      this.readings = readings;
      this.prebuilt = prebuilt || {};
      this.meta = index.meta || {};
      this.order = (index.chapters || []).filter((id) => chapters[id] && this.meta[id]);
      this.byBook = new Map();
      for (const id of this.order) {
        const b = this.meta[id].book;
        if (!this.byBook.has(b)) this.byBook.set(b, []);
        this.byBook.get(b).push(id);
      }
    }

    book(num) { return this.books.find((b) => b.num === num) || null; }
    bookOf(id) { return this.meta[id] ? this.book(this.meta[id].book) : null; }
    chaptersOf(num) { return this.byBook.get(num) || []; }
    has(id) { return !!this.meta[id]; }
    idOf(bookNum, chNum) {
      return this.chaptersOf(bookNum).find((id) => this.meta[id].ch === chNum) || null;
    }
    /** 顯示用的章號：1.6 */
    label(id) { const m = this.meta[id]; return m ? `${m.book}.${m.ch}` : id; }
    status(id) { return (this.meta[id] && this.meta[id].status) || 'draft'; }
    neighbors(id) {
      const i = this.order.indexOf(id);
      return { prev: i > 0 ? this.order[i - 1] : null, next: i >= 0 && i < this.order.length - 1 ? this.order[i + 1] : null };
    }
    footerOf(id, data) {
      if (data && data.footer) return data.footer;
      const b = this.bookOf(id);
      return b ? `論語 · ${b.zh}篇 | The Analects · ${b.en}` : '論語 | The Analects';
    }
    official(id) { return this.chapters[id]; }
    /** 這一章「現在的版本」：有草稿用草稿，沒有用官方版本 */
    current(id) {
      const d = Drafts.get(id);
      return d && Drafts.differs(id, this) ? clone(d.data) : clone(this.chapters[id]);
    }
  }

  // ---------- 草稿（自動存在這台電腦的瀏覽器裡） ----------
  const PREFIX = 'analects-draft:';
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 瀏覽器封鎖 storage 時略過 */ } },
  };

  const Drafts = {
    get(id) { return store.get(PREFIX + id); },
    /** data：目前內容；base：當時的官方版本（JSON 字串），用來偵測官方版本之後有沒有更新 */
    set(id, data, base) { return store.set(PREFIX + id, { data, base, savedAt: Date.now() }); },
    del(id) { store.del(PREFIX + id); },
    /** 有草稿、而且跟官方版本不同 */
    differs(id, s) {
      const d = this.get(id);
      return !!(d && d.data && JSON.stringify(d.data) !== JSON.stringify(s.chapters[id]));
    },
  };

  const LAST_KEY = 'analects-last-chapter';
  const Last = {
    get() { return store.get(LAST_KEY); },
    set(id) { store.set(LAST_KEY, id); },
  };

  global.AnalectsData = { load, Drafts, Last, clone };
})(window);
