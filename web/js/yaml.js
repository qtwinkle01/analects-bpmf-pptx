/* yaml.js — 把章節資料輸出成與 examples/v2/*.yaml 相同格式的 YAML
 * 下載後直接覆蓋 examples/v2/<章節>.yaml 並 push，CI 會重建網站預設值。
 * 字串一律用雙引號（JSON 字串即合法的 YAML 雙引號字串）。
 */
(function (global) {
  'use strict';

  const FLOW_ITEM_KEYS = new Set(['words']);   // 這些清單的每一項寫成一行 { ... }

  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const isFlat = (o) => Object.values(o).every((v) => v == null || typeof v !== 'object');

  function scalar(key, v) {
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (key === 'type' && /^[a-z]+$/.test(v)) return v;
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

  global.AnalectsYaml = { chapterToYaml };
})(window);
