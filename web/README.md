# 論語投影片編輯器（Analects Slide Editor）

一個純前端網頁工具：載入《論語》各章的**注音、拼音、英文翻譯**預設值，讓你在瀏覽器裡**直接修改讀音（含破音字）、拼音與英譯**，即時預覽，最後**下載成 PowerPoint（.pptx）**。

完全在瀏覽器內運作，不需要伺服器，透過 GitHub Actions 自動部署到 GitHub Pages。

> 本工具是 [analects_pptx](../) 命令列產生器的網頁版：沿用相同的版面設計（米色紙質背景、朱紅章節標籤、逐字對齊拼音、生詞卡）與相同的破音字語法。

---

## 功能

- **載入預設**：內建學而篇全 16 章，選章即帶入注音／拼音／Legge 英譯。
- **手動修改**：
  - 點任一漢字 → 下拉選單改讀音（破音字），或自訂字型未收錄的注音（如 道 → ㄉㄠˇ）。
  - 拼音、英文直接在輸入框編輯，並自動檢查「拼音音節數是否等於漢字數」。
- **即時預覽**：右側逐頁預覽，所見即所得。
- **下載 PPT**：一鍵產生 `.pptx`，版面與預覽一致。

---

## 怎麼運作（架構）

注音之所以能正確顯示，靠的是 **BPMFVs 注音字型**（字形內含注音），三個關鍵：

1. **精簡字型**：用 `fonttools` 把 17MB 的原字型瘦身成只含論語用得到的字（約 200KB），瀏覽器用 `@font-face` 載入。
2. **破音字 = IVS 異體字選擇子**：字型用 Unicode 變體選擇子切換讀音。`[乘:1]` 就是在「乘」後面接 `U+E01E1`，canvas 直接畫就能顯示 ㄕㄥˋ。字型沒收的讀音（如 ㄉㄠˇ）則手動合成注音。
3. **PPTX 由 [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) 在瀏覽器組出**：注音渲染成圖片嵌入，拼音／英文則是真正的文字方塊（可在 PowerPoint 內選取）。

`js/layout.js` 是版面計算（移植自 `make_analects_deck.py`），預覽（`preview.js`）與下載（`pptx.js`）共用同一份繪圖指令，確保兩者一致。

---

## 破音字語法（與 YAML 相同）

| 寫法 | 意義 | 例子 |
|---|---|---|
| `字` | 字型預設讀音 | `樂` → ㄌㄜˋ |
| `[字:1]` | 第 2 讀音（IVS ss01） | `[乘:1]` → ㄕㄥˋ、`[鮮:1]` → ㄒㄧㄢˇ |
| `[字:2]` | 第 3 讀音（IVS ss02） | `[弟:2]` → ㄊㄧˋ |
| `[字\|注音]` | 字型未收錄，手動合成 | `[道\|ㄉㄠˇ]` → ㄉㄠˇ、`[說\|ㄩㄝˋ]` → ㄩㄝˋ |

在網頁上不用手打語法：點漢字就能用選單完成，工具會自動維護這些標記。

---

## 部署到 GitHub Pages

本 repo 的網站內容放在 `web/`，CI/CD 設定在 `.github/workflows/deploy-web.yml`。

1. 把整個 repo push 到 GitHub。
2. 到 repo 的 **Settings → Pages → Build and deployment**，把 **Source** 設為 **GitHub Actions**。
3. 之後每次 push（`web/`、`examples/v2/`、`fonts/` 有變動）就會自動部署；網址會顯示在 Actions 的部署步驟裡，通常是
   `https://<你的帳號>.github.io/<repo 名>/`。

也可手動觸發：Actions 頁面 → 「Deploy Analects web editor to GitHub Pages」→ Run workflow。

### workflow 做了什麼

| 步驟 | 說明 |
|---|---|
| 重建資產 | 跑 `build_assets.py`，從 `examples/v2/*.yaml` 與完整字型重新產生 `data/*.json` 與精簡字型 — **改 YAML 就會自動上線，不用手動重建** |
| 版面檢查 | 跑 `check_layout.js`，有錯就擋下部署（見下）|
| 檔案齊全檢查 | 確認 index.html／JS／字型／JSON 都在且非空 |
| 部署 | 上傳 `web/`（不含 `tools/`）到 GitHub Pages |

Pull request 只會跑檢查、不會部署。

### 自動檢查（check_layout.js）

沒有瀏覽器也能驗證版面：用 `font_widths.py` 從字型撈出真實字寬來模擬 canvas 的
`measureText()`，再實際載入 `render.js` + `layout.js` 把全部章節每一頁都算一次版面。

會**擋下部署**的錯誤：

- 版面計算丟例外、座標算出 NaN
- **拼音音節數 ≠ 漢字數**（投影片上拼音會對不準漢字）
- YAML 寫了 `[字:N]` 但字型根本沒有那個讀音
- `index.json` 列了 `chapters.json` 沒有的章節
- 精簡字型缺字（網頁上會變成空白方框）

本機執行：

```bash
python3 web/tools/font_widths.py --out web/tools/.widths.json
node    web/tools/check_layout.js  web/tools/.widths.json
```

> 框線超出邊界只列為警告不擋部署 — 文字框刻意留高（`valign: top`，多的高度不會畫東西），
> 拼音框則是固定寬度置中對齊在漢字下方，兩側溢出是正常的。

### 本機預覽

```bash
cd web
python -m http.server 8000
# 瀏覽器開 http://localhost:8000
```
（因為用到 `fetch` 載入 JSON 與字型，請用 http server 開，不要直接雙擊 index.html。）

---

## 新增章節 / 更新資料

資料與精簡字型是從原始 `examples/v2/*.yaml` 與完整字型產生的。改完 YAML 後重跑：

```bash
cd web/tools
pip install pyyaml fonttools
python build_assets.py
```

會重新產生 `web/data/*.json` 與 `web/assets/bpmf-subset.ttf`。預設路徑指向上兩層的 `analects_pptx` repo；若路徑不同用 `--yaml-dir / --font / --out` 指定。

---

## 目錄結構

```
web/
├── index.html
├── css/styles.css
├── js/
│   ├── render.js      # 注音 canvas 渲染（IVS + 手動合成）
│   ├── layout.js      # 版面計算（預覽與 PPTX 共用）
│   ├── preview.js     # 畫到螢幕
│   ├── pptx.js        # PptxGenJS 匯出
│   ├── app.js         # 編輯器主邏輯
│   └── pptxgen.bundle.js
├── assets/bpmf-subset.ttf
├── data/{index,chapters,readings}.json
└── tools/
    ├── build_assets.py    # 從 YAML + 完整字型產生 data/ 與精簡字型
    ├── font_widths.py     # 匯出字寬表（給 check_layout.js）
    └── check_layout.js    # 無瀏覽器版面／資料檢查（CI 用）
.github/workflows/deploy-web.yml
```

> `tools/` 只在建置時用得到，部署時不會上傳到網站。

## 授權

沿用上層專案授權；BPMFVs 注音字型為 [ButTaiwan](https://github.com/ButTaiwan/bpmfvs) 開源字型。
