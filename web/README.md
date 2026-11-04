# 論語投影片網站（Analects Slides）

一個純前端網站：《論語》每一章都有**注音、拼音、英文翻譯**的教學投影片，可以在網頁上預覽、修改，再下載成 PowerPoint（.pptx）。

完全在瀏覽器內運作，不需要伺服器；透過 GitHub Actions 自動部署到 GitHub Pages。

網站有兩個入口，共用同一份資料與同一套排版程式：

| 入口 | 給誰 | 可以做什麼 |
|---|---|---|
| `index.html` 老師版 | 只想下載 PPT 的老師 | 目錄 → 篇 → 章；預覽、下載單章或整篇；在網頁上改成自己要的樣子再下載。介面可切換中文／English |
| `edit.html` 開發者版 | 校對、維護資料的人 | 看每章的校對狀態；完整編輯器；標記已校對；下載 YAML 寫回 `examples/v2/` |

> 本網站與 repo 根目錄的命令列產生器 `make_analects_deck.py` 讀同一份 YAML（`examples/v2/*.yaml`），版面設計相同（米色紙質背景、朱紅章節標籤、逐字對齊拼音、生詞卡），破音字語法也相同。

---

## 網址

網址用 `#`，重新整理、上一頁、加書籤都不會跑掉：

| 網址 | 老師版 `index.html` | 開發者版 `edit.html` |
|---|---|---|
| `#/` | 目錄（20 篇） | 目錄＋校對進度 |
| `#/1` | 學而篇的章節列表 | 學而篇的章節列表（含狀態） |
| `#/1/6` | 學而 1.6 預覽與下載 | 編輯學而 1.6 |
| `#/1/6/edit` | 在網頁上修改學而 1.6 | — |

---

## 功能

### 老師版

- **目錄**：20 篇都列出來，還沒有資料的篇顯示「尚未建立」；可以搜尋原文或英文（例如「巧言令色」、「gentleman」）。
- **已校對／未校對**：每章依 YAML 的 `status` 標示；兩種都可以預覽、下載。
- **下載 PPT**：沒有修改過的章與整篇，直接下載部署時預先產生好的檔案；有修改過的，在瀏覽器裡即時產生（內容是老師自己的版本）。
- **在網頁上修改**：用與開發者版相同的編輯器改讀音、拼音、英文、原文與分頁，改完按「下載 PPT」。
  修改自動存在**這台電腦的瀏覽器**裡，不會動到正式資料；官方版本之後更新時會提醒。
  「⋯ 更多」裡有「還原成官方版本」「下載我的版本」（備份成 YAML）「匯入我的版本」（換電腦或清除瀏覽資料後載回來）。
- **中文／English 介面**：第一次依瀏覽器語言自動選，之後記住選擇。
- **手機、平板**：版面自動調整；編輯頁用「編輯／預覽」分頁切換。

下載的 PPT 在 PowerPoint 裡：英文、拼音、頁尾是文字方塊，可以直接改；**漢字＋注音是圖片**（任何電腦打開都一樣、不用安裝字型），要改字或破音字讀音請在網頁上改完再下載。

### 編輯器（兩個入口共用）

- 點任一漢字 → 選單改讀音（破音字），或自訂字型沒有的注音（如 道 → ㄉㄠˇ）。
- 拼音、英文直接在輸入框修改；自動檢查「拼音音節數是否等於漢字數」。
- **改原文**：改字、加字、刪字後，沒動到的字保留原本的讀音與拼音；新加的字從論語資料找讀音與拼音（找不到的以 `?` 標示）。
- **分頁**：新增／刪除句子、上移／下移（第一句與最後一句可以移到前後頁）、「從這句開始換頁」、「與下一頁合併」、刪除整頁。
  有說話者的頁不能把句子移到說話者前面，避免順序跑掉。
- **生詞卡**：直接改「詞語」，自動帶出讀音（破音字）、拼音，找得到時連英文一起帶入。
  查找順序是「任一章生詞卡已有的詞 → 課文中相同的連續字 → 逐字從課文找讀音」，目前這章優先。
- **即時預覽**：右側（手機是「預覽」分頁）逐頁預覽，所見即所得。

### 開發者版另外有

- 每章的校對狀態、瀏覽器裡還沒寫回 YAML 的草稿。
- 「標記為已校對／改回待校對」：寫進 YAML 的 `status`。
- 「下載 YAML」：與 `examples/v2/*.yaml` 相同格式，用來永久更新預設值（見下方）。

### 校對後更新預設值

草稿只存在**目前這個瀏覽器**（換電腦、清除瀏覽資料就不見了），確定校對完成後請寫回 YAML：

1. 按 **下載 YAML**，得到例如 `學而1.8.yaml`。
2. 用它覆蓋 repo 裡的 `examples/v2/學而1.8.yaml`，用 `git diff` 確認只改了你校對的地方。
3. commit 並 push → GitHub Actions 自動重建網站，新內容就成為所有人看到的預設值。
4. 網站更新後再開這一章，草稿與新預設相同會自動清掉。

---

## 資料

| 檔案 | 說明 |
|---|---|
| `../examples/v2/學而1.1.yaml` … | 每章一個檔，檔名是「篇名＋篇號.章號」。`status: reviewed`＝已校對、`status: draft`＝待校對 |
| `../examples/v2/books.yaml` | 二十篇的篇號、篇名、拼音、英文；目錄與頁尾文字都從這裡產生 |
| `data/chapters.json` | 各章內容（由 YAML 轉成 JSON） |
| `data/index.json` | 篇名表、章節順序、每章的篇號、章號、狀態與第一句（中、英） |
| `data/readings.json` | 每個字字型裡可選的破音字讀音 |
| `assets/bpmf-subset.woff2` | 只含用到的字的精簡注音字型 |
| `data/pptx.json`、`pptx/` | 部署時預先產生的 PPT 與清單（不進 git） |

`data/` 與 `assets/` 由 `tools/build_assets.py` 產生，同一份輸入每次產生的檔案都完全相同。改完 YAML 後重跑：

```bash
pip install pyyaml fonttools brotli
python web/tools/build_assets.py
```

預設讀 `examples/v2/` 與 `fonts/BpmfZihiKaiStd-Regular.ttf`；路徑不同時用 `--yaml-dir / --font / --out` 指定。

---

## 怎麼運作（架構）

注音之所以能正確顯示，靠的是 **BPMFVs 注音字型**（字形內含注音），三個關鍵：

1. **精簡字型**：用 `fonttools` 把 17MB 的原字型瘦身成只含論語用得到的字（WOFF2 約 100KB），瀏覽器用 `@font-face` 載入。
2. **破音字 = IVS 異體字選擇子**：字型用 Unicode 變體選擇子切換讀音。`[乘:1]` 就是在「乘」後面接 `U+E01E1`，canvas 直接畫就能顯示 ㄕㄥˋ。字型沒收的讀音（如 ㄉㄠˇ）則手動合成注音。
3. **PPTX 由 [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) 在瀏覽器組出**：注音渲染成圖片嵌入（匯出時固定 3 倍解析度），拼音／英文則是真正的文字方塊。

`js/layout.js` 是版面計算，預覽（`preview.js`）、下載（`pptx.js`）與部署時預先產生 PPT 都用同一份繪圖指令，確保結果一致。

---

## 部署到 GitHub Pages

CI/CD 設定在 `.github/workflows/deploy-web.yml`。

1. 把整個 repo push 到 GitHub。
2. 到 repo 的 **Settings → Pages → Build and deployment**，把 **Source** 設為 **GitHub Actions**。
3. 之後每次 push 到 main（`web/`、`examples/v2/`、`fonts/` 有變動）就會自動部署；網址會顯示在 Actions 的部署步驟裡，通常是
   `https://<你的帳號>.github.io/<repo 名>/`（老師版），開發者版在同一網址加上 `edit.html`。

也可手動觸發：Actions 頁面 → 「Deploy Analects website to GitHub Pages」→ Run workflow。

### workflow 做了什麼

| 步驟 | 說明 |
|---|---|
| 重建資產 | 跑 `build_assets.py`，從 `examples/v2/*.yaml` 與完整字型重新產生 `data/*.json` 與精簡字型 |
| 版面檢查 | 跑 `check_layout.js`，有錯就擋下部署（見下） |
| 預先產生 PPT | 安裝 Playwright 與 Carlito 字型（字寬與 Calibri 相同），用無頭 Chromium 跑 `export_all_pptx.js`：呼叫網頁本身的排版程式，產生每章與整篇的 PPT 到 `pptx/` |
| 檔案齊全檢查 | 確認 HTML／JS／字型／JSON／PPT 都在且非空 |
| 加上版本號 | 把 `index.html`、`edit.html`、`styles.css` 裡的 `__BUILD__` 換成 commit 編號，所有檔案網址變成 `?v=xxxxxxx`，瀏覽器每次部署都會抓新檔 |
| 部署 | 上傳 `web/`（不含 `tools/`）到 GitHub Pages |

Pull request 只會跑檢查、不會部署。

每章 PPT 約 1MB（主要是 3 倍解析度的注音圖），整篇合輯約為各章總和。GitHub Pages 單一網站的容量上限是 1GB，章節大量增加時要留意部署大小（workflow 的「檔案齊全檢查」會印出網站大小）。

### 自動檢查（check_layout.js）

沒有瀏覽器也能驗證版面：用 `font_widths.py` 從字型撈出真實字寬來模擬 canvas 的
`measureText()`，再實際載入 `render.js` + `layout.js` 把全部章節每一頁都算一次版面。

會**擋下部署**的錯誤：

- 版面計算丟例外、座標算出 NaN
- **拼音音節數 ≠ 漢字數**（投影片上拼音會對不準漢字）
- 課文文字壓到頁尾
- YAML 寫了 `[字:N]` 但字型根本沒有那個讀音
- `index.json` 列了 `chapters.json` 沒有的章節、篇名表不是 20 篇、`status` 不是 `draft`／`reviewed`
- 精簡字型缺字（網頁上該字會改用一般字型顯示，沒有注音）

本機執行：

```bash
python3 web/tools/font_widths.py --out web/tools/.widths.json
```

```bash
node web/tools/check_layout.js web/tools/.widths.json
```

> 框線超出邊界只列為警告不擋部署 — 文字框刻意留高（`valign: top`，多的高度不會畫東西），
> 拼音框則是固定寬度置中對齊在漢字下方，兩側溢出是正常的。

### 本機預覽

```bash
cd web
python -m http.server 8000
```

瀏覽器開 `http://localhost:8000`（老師版）或 `http://localhost:8000/edit.html`（開發者版）。
因為用到 `fetch` 載入 JSON 與字型，請用 http server 開，不要直接雙擊 index.html。
本機沒有預先產生的 PPT 時，下載一律在瀏覽器裡即時產生，結果相同。

---

## 目錄結構

```
web/
├── index.html          # 老師版入口
├── edit.html           # 開發者版入口
├── css/styles.css
├── js/
│   ├── i18n.js         # 介面文字（中文／English）
│   ├── data.js         # 載入資料、篇章查詢、瀏覽器草稿
│   ├── site.js         # 路由與各頁面（目錄、篇、章、編輯頁）
│   ├── editor.js       # 編輯器（兩個入口共用）
│   ├── render.js       # 注音 canvas 渲染（IVS + 手動合成）
│   ├── layout.js       # 版面計算（預覽、下載、預先產生共用）
│   ├── preview.js      # 畫到螢幕
│   ├── pptx.js         # PptxGenJS 匯出（單章或整篇）
│   ├── yaml.js         # 匯出／匯入與 examples/v2 相同格式的 YAML
│   ├── vocab.js        # 生詞卡：輸入詞語自動帶出讀音／拼音／英文
│   ├── pptxgen.bundle.js       # PptxGenJS 3.12.0（要下載時才載入）
│   └── vendor/js-yaml.min.js   # js-yaml 4.1.0（MIT，要匯入時才載入）
├── assets/bpmf-subset.woff2
├── data/{index,chapters,readings}.json
└── tools/
    ├── build_assets.py     # 從 YAML + 完整字型產生 data/ 與精簡字型
    ├── font_widths.py      # 匯出字寬表（給 check_layout.js）
    ├── check_layout.js     # 無瀏覽器版面／資料檢查（CI 用）
    └── export_all_pptx.js  # 用無頭 Chromium 預先產生每章與整篇 PPT（CI 用）
.github/workflows/deploy-web.yml
```

> `tools/` 只在建置時用得到，部署時不會上傳到網站。

## 授權

沿用上層專案授權；BPMFVs 注音字型為 [ButTaiwan](https://github.com/ButTaiwan/bpmfvs) 開源字型；js-yaml 為 MIT 授權。
