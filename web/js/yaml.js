/* yaml.js — 章節資料 ⇄ YAML（與 examples/v2/*.yaml 相同格式）
 * 匯出：字串一律用雙引號（JSON 字串即合法的 YAML 雙引號字串），下載後可直接覆蓋 examples/v2/<章節>.yaml。
 * 匯入：用 js-yaml（js/vendor/js-yaml.min.js，第一次匯入時才載入）。
 */
(function (global) {
  'use strict';

  const FLOW_ITEM_KEYS = new Set(['words']);        // 這些清單的每一項寫成一行 { ... }
  const BARE_KEYS = new Set(['type', 'status']);     // 這些欄位的值不加引號

  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const isFlat = (o) => Object.values(o).every((v) => v == null || typeof v !== 'object');

  function scalar(key, v) {
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (BARE_KEYS.has(key) && /^[a-z]+$/.test(v)) return v;
    return JSON.stringify(String(v));
  }

  function flow(o) {
    const parts = Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${scalar(k, v)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }

  function mapping(obj, indent) {
    const pad = ' '.repeat(indent);
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        if (!v.length) { out.push(`${pad}${k}: []`); continue; }
        out.push(`${pad}${k}:`);
        for (const it of v) out.push(...listItem(k, it, indent + 2));
      } else if (isObj(v)) {
        if (isFlat(v)) out.push(`${pad}${k}: ${flow(v)}`);
        else { out.push(`${pad}${k}:`); out.push(...mapping(v, indent + 2)); }
      } else {
        out.push(`${pad}${k}: ${scalar(k, v)}`);
      }
    }
    return out;
  }

  function listItem(key, it, indent) {
    const pad = ' '.repeat(indent);
    if (!isObj(it)) return [`${pad}- ${scalar(key, it)}`];
    if (FLOW_ITEM_KEYS.has(key) && isFlat(it)) return [`${pad}- ${flow(it)}`];
    const sub = mapping(it, indent + 2);
    if (!sub.length) return [`${pad}- {}`];
    sub[0] = `${pad}- ${sub[0].trimStart()}`;
    return sub;
  }

  function chapterToYaml(chapter, id) {
    const title = String(id || '').replace(/^(\D+)(\d)/, '$1 $2');
    const out = [
      `# 論語．${title}（教學簡報 v2 格式）`,
      '# 破音字語法：[字:1]=第2讀音、[字:2]=第3讀音、[字|ㄩㄝˋ]=手動合成注音',
      '',
    ];
    const { slides, ...rest } = chapter;
    const head = mapping(rest, 0);
    if (head.length) out.push(...head, '');
    out.push('slides:');
    (slides || []).forEach((sl, i) => {
      if (i > 0) out.push('');
      out.push(...listItem('slides', sl, 2));
    });
    return out.join('\n') + '\n';
  }

  function loadLib() {
    if (global.jsyaml) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const v = (document.querySelector('meta[name="build-version"]') || {}).content || 'dev';
      s.src = `js/vendor/js-yaml.min.js?v=${v}`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('js-yaml 載入失敗'));
      document.head.appendChild(s);
    });
  }

  /** 解析 YAML 文字 → 章節物件；格式不對就丟出錯誤 */
  async function parse(text) {
    await loadLib();
    const data = global.jsyaml.load(text);
    if (!isObj(data) || !Array.isArray(data.slides)) throw new Error(global.I18N ? I18N.t('notChapter') : 'no slides');
    for (const sl of data.slides) {
      if (!isObj(sl)) throw new Error('slides 裡有不是物件的項目');
      for (const k of ['lines', 'words']) if (sl[k] != null && !Array.isArray(sl[k])) throw new Error(`${k} 必須是清單`);
    }
    return data;
  }

  /** 從檔名或檔頭註解猜出章節 ID（學而1.6.yaml、學而1.6 (1).yaml、# 論語．學而 1.6…） */
  function guessId(filename, text) {
    const ids = [];
    const base = String(filename || '').replace(/\.(ya?ml|txt)$/i, '').replace(/\s*\(\d+\)$/, '').trim();
    if (base) ids.push(base);
    const m = /^#\s*論語．(\D+?)\s*(\d+\.\d+)/m.exec(text || '');
    if (m) ids.push(m[1] + m[2]);
    return ids;
  }

  global.AnalectsYaml = { chapterToYaml, parse, guessId };
})(window);
