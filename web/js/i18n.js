/* i18n.js — 介面文字（中文／English）
 * 老師版可切換語言（記在瀏覽器裡，第一次依瀏覽器語言決定）；開發者版固定中文。
 * 用法：I18N.t('key', { n: 3 }) → 依目前語言取字串，{n} 會換成參數。
 */
(function (global) {
  'use strict';

  const STR = {
    zh: {
      brand: '論語投影片', brandSub: '注音・拼音・英文 教學簡報', devBrand: '論語投影片・校對後台',
      loading: '載入中…', loadFail: '載入資料失敗：{e}',
      tocTitle: '論語二十篇', tocSub: '每一章都可以預覽、下載 PowerPoint，也可以先在網頁上改成你要的樣子再下載。',
      devTocSub: '校對進度、草稿與狀態都在這裡。改完記得「下載 YAML」覆蓋 examples/v2 再 push。',
      search: '搜尋原文或英文，例如：巧言令色', searchNone: '找不到「{q}」', searchCount: '找到 {n} 章',
      bookNum: '第 {n} 篇', chapters: '{n} 章', reviewedOf: '已校對 {r}／{n}', comingSoon: '尚未建立',
      reviewed: '已校對', draftT: '未校對', draftD: '待校對', localDraft: '有修改（存在這台電腦）', localDraftD: '有草稿未寫回',
      preview: '預覽', downloadPpt: '下載 PPT', downloadBook: '下載整篇 PPT', editOnWeb: '在網頁上修改', edit: '編輯',
      prev: '上一章', next: '下一章', toc: '目錄', backToBook: '回到{b}篇', notFound: '找不到這一章', emptyBook: '這一篇還沒有資料', continueLast: '繼續上次：{c}',
      chapterTitle: '{b} {c}', chapterEdited: '這一章你修改過（修改存在這台電腦的瀏覽器裡），下載的 PPT 會是你的版本。',
      restore: '還原成官方版本', restoreConfirm: '確定要捨棄「{id}」的修改、還原成官方版本？\n（建議先按「下載我的版本」備份）',
      restoreConfirmD: '確定要捨棄「{id}」的所有修改、還原成預設值？\n（建議先按「下載 YAML」備份）',
      reset: '重設本章', importMine: '匯入我的版本', importYaml: '匯入 YAML', exportMine: '下載我的版本', exportYaml: '下載 YAML',
      markReviewed: '標記為已校對', markDraft: '改回待校對',
      savedT: '你的修改已存在這台電腦的瀏覽器（{time}）', sameT: '與官方版本相同',
      savedD: '草稿已自動儲存 {time}・尚未寫回 YAML', sameD: '與預設資料相同', saving: '儲存中…', saveFail: '⚠️ 無法自動儲存，請記得下載備份',
      draftLoaded: '已載入你在這台電腦的修改（{time}）', draftStale: '已載入你的修改；注意：官方版本在你修改之後有更新過，請確認',
      more: '⋯ 更多', tabEdit: '編輯', tabPreview: '預覽', previewHead: '即時預覽', previewHint: '下載的 PPT 會與此一致',
      generating: '產生中…', downloaded: '已下載 {f}', genFail: '產生失敗：{e}',
      exportedT: '已下載 {f}：之後可以用「匯入我的版本」載回來', exportedD: '已下載 {f}：覆蓋 examples/v2/{f} 後 push 即更新預設',
      imported: '已匯入 {f}', importBad: '這個檔案無法匯入：{e}', importSwitched: '這是「{a}」的檔案，已切換到「{a}」並匯入',
      notChapter: '不是論語章節檔（找不到 slides）',
      hint: '點<b>漢字</b>可以改讀音（破音字）：<span class="legend"><span class="swatch sw-alt"></span>有其他讀音可選</span>、<span class="legend"><span class="swatch sw-manual"></span>已自訂注音</span>。拼音、英文直接在輸入框修改；按「改原文」可以改字。',
      slideN: '投影片 {n}', tContent: '課文', tVocab: '生詞卡', tTitle: '標題頁', tEnd: '結尾頁',
      speaker: '說話者', lineN: '第 {n} 句', wordN: '生詞 {n}', fPinyin: '拼音', fEnglish: '英文', fWord: '詞語',
      fZhMain: '主標中文', fPyMain: '主標拼音', fZhSub: '副標中文', fPySub: '副標拼音', fNote: '註記', fZh: '中文',
      editText: '改原文', apply: '套用', cancel: '取消', textPh: '輸入這一句的中文（含標點）',
      moveUp: '上移', moveDown: '下移', splitHere: '從這句開始換頁', delLine: '刪除', addLine: '＋ 新增一句',
      mergeNext: '與下一頁合併', delSlide: '刪除這頁', delLineConfirm: '刪除這一句？', delSlideConfirm: '刪除第 {n} 頁？',
      pyMismatch: '拼音音節數 {a} 與漢字數 {b} 不符（標點不算）', pyQ: '有字找不到拼音（以 ? 標示），請手動補上',
      wordPh: '輸入中文詞，自動帶出讀音與拼音', enPh: '英文解釋',
      readingOf: '「{ch}」讀音', rDefault: '預設', rN: '讀音{n}', rManual: '自訂注音（字型沒有的讀音，例如 ㄉㄠˇ）',
      rClear: '清除（回預設）', close: '關閉',
      vFromVocab: '已從「{from}」生詞卡帶入讀音、拼音與英文', vFromText: '已從「{from}」課文帶入讀音與拼音，英文請自行輸入',
      vFromChars: '已逐字從課文帶入讀音與拼音，請確認破音字；英文請自行輸入', vNone: '論語資料裡還沒有這些字的讀音，請手動輸入拼音與英文',
      vMissing: '「{c}」找不到拼音，請手動補上', vNotInFont: '「{c}」不在網頁字型裡，預覽與 PPT 不會有注音',
      footerNote: '論語原文與 Legge 英譯為公有領域；注音字型：ButTaiwan BPMFVs。', devLink: '校對者入口', teacherLink: '老師版',
      langZh: '中文', langEn: 'English',
    },
    en: {
      brand: 'Analects Slides', brandSub: 'Zhuyin · Pinyin · English teaching slides', devBrand: 'Analects Slides · Editor',
      loading: 'Loading…', loadFail: 'Failed to load data: {e}',
      tocTitle: 'The Analects of Confucius — 20 Books', tocSub: 'Preview and download any chapter as PowerPoint — or adjust it here on the web first, then download.',
      search: 'Search Chinese or English, e.g. 巧言令色 or “gentleman”', searchNone: 'No results for “{q}”', searchCount: '{n} chapters found',
      bookNum: 'Book {n}', chapters: '{n} chapters', reviewedOf: '{r} of {n} reviewed', comingSoon: 'Coming soon',
      reviewed: 'Reviewed', draftT: 'Not yet reviewed', localDraft: 'Edited (saved in this browser)',
      preview: 'Preview', downloadPpt: 'Download PPT', downloadBook: 'Download whole book', editOnWeb: 'Edit on the web', edit: 'Edit',
      prev: 'Previous', next: 'Next', toc: 'Contents', backToBook: 'Back to {b}', notFound: 'Chapter not found', emptyBook: 'This book is not available yet', continueLast: 'Continue: {c}',
      chapterTitle: '{b} {c}', chapterEdited: 'You have edited this chapter (saved in this browser). Downloads will use your version.',
      restore: 'Restore official version', restoreConfirm: 'Discard your changes to “{id}” and restore the official version?\n(Tip: “Download my version” first to keep a backup.)',
      importMine: 'Import my version', exportMine: 'Download my version',
      savedT: 'Your changes are saved in this browser ({time})', sameT: 'Same as the official version', saving: 'Saving…', saveFail: '⚠️ Could not save automatically — please download a backup',
      draftLoaded: 'Loaded your changes saved in this browser ({time})', draftStale: 'Loaded your changes. Note: the official version was updated after you edited it — please check.',
      more: '⋯ More', tabEdit: 'Edit', tabPreview: 'Preview', previewHead: 'Live preview', previewHint: 'The PPT will look like this',
      generating: 'Generating…', downloaded: 'Downloaded {f}', genFail: 'Could not generate: {e}',
      exportedT: 'Downloaded {f} — use “Import my version” to load it again later',
      imported: 'Imported {f}', importBad: 'Could not import this file: {e}', importSwitched: 'This file is for “{a}” — switched to “{a}” and imported it',
      notChapter: 'not an Analects chapter file (no “slides” found)',
      hint: 'Tap a <b>character</b> to change its reading: <span class="legend"><span class="swatch sw-alt"></span>other readings available</span>, <span class="legend"><span class="swatch sw-manual"></span>custom zhuyin</span>. Edit pinyin and English in the boxes; use “Edit text” to change the characters.',
      slideN: 'Slide {n}', tContent: 'Text', tVocab: 'Vocabulary', tTitle: 'Title', tEnd: 'End',
      speaker: 'Speaker', lineN: 'Line {n}', wordN: 'Word {n}', fPinyin: 'Pinyin', fEnglish: 'English', fWord: 'Word',
      fZhMain: 'Title (zh)', fPyMain: 'Title pinyin', fZhSub: 'Subtitle (zh)', fPySub: 'Subtitle pinyin', fNote: 'Note', fZh: 'Chinese',
      editText: 'Edit text', apply: 'Apply', cancel: 'Cancel', textPh: 'Chinese text of this line (with punctuation)',
      moveUp: 'Move up', moveDown: 'Move down', splitHere: 'New slide from here', delLine: 'Delete', addLine: '+ Add a line',
      mergeNext: 'Merge with next slide', delSlide: 'Delete slide', delLineConfirm: 'Delete this line?', delSlideConfirm: 'Delete slide {n}?',
      pyMismatch: 'Pinyin has {a} syllables but there are {b} characters (punctuation excluded)', pyQ: 'Some characters have no known pinyin (shown as ?). Please fill them in.',
      wordPh: 'Type a Chinese word — reading and pinyin fill in automatically', enPh: 'English meaning',
      readingOf: 'Reading of 「{ch}」', rDefault: 'Default', rN: 'Reading {n}', rManual: 'Custom zhuyin (a reading the font does not have, e.g. ㄉㄠˇ)',
      rClear: 'Reset to default', close: 'Close',
      vFromVocab: 'Filled in reading, pinyin and English from the vocabulary of {from}', vFromText: 'Filled in reading and pinyin from the text of {from}; please add the English',
      vFromChars: 'Filled in reading and pinyin character by character — please check polyphonic characters and add the English', vNone: 'No reading data for these characters yet — please type the pinyin and English',
      vMissing: 'No pinyin found for 「{c}」 — please type it', vNotInFont: '「{c}」 is not in the web font, so it will appear without zhuyin',
      footerNote: 'The Analects text and James Legge’s translation are in the public domain. Zhuyin font: ButTaiwan BPMFVs.', devLink: 'Maintainer editor',
      langZh: '中文', langEn: 'English',
    },
  };

  const KEY = 'analects-lang';
  let lang = 'zh';

  function detect() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) { /* 瀏覽器封鎖 storage 時略過 */ }
    return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
  }

  function apply(l) {
    lang = l;
    document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en';
  }

  function t(key, vars) {
    let s = (STR[lang] && STR[lang][key]) ?? STR.zh[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  }

  global.I18N = {
    t,
    get lang() { return lang; },
    /** fixed：開發者版傳 'zh' 固定中文，不讀也不寫語言設定 */
    init(fixed) { apply(fixed || detect()); },
    set(l) { apply(l); try { localStorage.setItem(KEY, l); } catch (e) { /* 略過 */ } },
  };
})(window);
