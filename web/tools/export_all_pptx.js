#!/usr/bin/env node
/*
 * export_all_pptx.js — 部署前預先產生每章與整篇的 PPT（CI 用）
 * ==========================================================
 * 用無頭 Chromium 打開網站，呼叫網頁本身的排版程式（與老師在瀏覽器裡按「下載 PPT」完全相同），
 * 把結果存成檔案。老師下載沒修改過的章節時直接拿這些檔案，不必在瀏覽器裡等產生。
 *
 * 產生：
 *   web/pptx/學而1.1.pptx …     每章一份
 *   web/pptx/學而篇.pptx …      每篇一份（全部章節合成一份，頁碼連續）
 *   web/data/pptx.json          上面檔案的清單，網頁靠它判斷有沒有現成的檔
 *
 * 用法（先用任何 http server 把 web/ 開起來）：
 *   python3 -m http.server 8765 --directory web &
 *   node web/tools/export_all_pptx.js http://127.0.0.1:8765/ web
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [base, webDir] = process.argv.slice(2);
if (!base || !webDir) {
  console.error('用法：node export_all_pptx.js <網站網址> <web 資料夾>');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 等 http server 起來
  let loaded = false;
  for (let i = 0; i < 60 && !loaded; i++) {
    try { await page.goto(base + 'index.html', { waitUntil: 'load' }); loaded = true; }
    catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!loaded) throw new Error(`連不到 ${base}`);
  await page.waitForFunction(() => window.AnalectsApp && window.AnalectsApp.ready, null, { timeout: 30000 });
  const targets = await page.evaluate(async () => { await AnalectsApp.ready; return AnalectsApp.exportTargets(); });

  const outDir = path.join(webDir, 'pptx');
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = {};
  let bytes = 0;
  for (const tg of targets) {
    const b64 = await page.evaluate((ids) => AnalectsApp.buildBase64(ids), tg.ids);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 1000 || buf.slice(0, 2).toString() !== 'PK') throw new Error(`${tg.file} 產生的不是有效的 PPTX`);
    fs.writeFileSync(path.join(outDir, tg.file), buf);
    manifest[tg.key] = `pptx/${tg.file}`;
    bytes += buf.length;
  }
  fs.writeFileSync(path.join(webDir, 'data', 'pptx.json'), JSON.stringify(manifest, null, 1) + '\n');
  await browser.close();

  if (errors.length) {
    console.error('❌ 產生過程中網頁出錯：\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  const books = targets.filter((x) => x.key.startsWith('book:')).length;
  console.log(`✅ pptx：${targets.length - books} 章、${books} 篇合輯，共 ${(bytes / 1024 / 1024).toFixed(1)} MB → ${outDir}`);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
