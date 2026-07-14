# 論語投影片生成工具

自動將論語章句製作成帶有**中文注音、漢語拼音、英文翻譯**的 PowerPoint 教學投影片，
供外國人學習中文使用。

本專案包含兩代產生器：

| 版本 | 程式 | 說明 |
|---|---|---|
| **v2（推薦）** | `make_analects_deck.py` | 設計版：紙色背景、章節標籤、生詞卡片、拼音逐字對齊、精簡破音字語法 |
| v1（舊版） | `make_analects_pptx.py` | 原始版面（白底、拼音帶底線），保留供參考 |

---

## v2 產生器（make_analects_deck.py）

### 特色

- **視覺設計**：米色紙質背景、朱紅章節標籤與分隔線、頁尾頁碼、生詞圓角卡片、標題／結尾頁置中排版
- **拼音逐字對齊**：每個拼音音節置中對齊在對應漢字正下方，無底線
- **破音字精簡語法**：直接寫在句子字串裡，不需逐字展開
- **渲染管線**：uharfbuzz shaping + FreeType 逐字渲染（不依賴 Pillow raqm，任何平台結果一致）
- **自動修補 `[Content_Types].xml`**：範本只宣告 5 張投影片，超過的頁數會自動補宣告
  （否則 PowerPoint 從第 6 頁起顯示空白；LibreOffice 較寬鬆看不出此問題）

### 安裝需求

```bash
pip install pillow pyyaml uharfbuzz freetype-py
```

Python 3.10 以上。字型 `fonts/BpmfZihiKaiStd-Regular.ttf` 需存在（見下方字型說明）。

### 快速開始

```bash
# 產生單一章節（輸出為同名 pptx）
python make_analects_deck.py --config examples/v2/學而1.1.yaml

# 指定輸出路徑
python make_analects_deck.py --config examples/v2/學而1.4.yaml --output 學而1.4.pptx
```

`examples/v2/` 內含**學而篇全部 16 章**（學而1.1.yaml ～ 學而1.16.yaml），
每章一檔：課文投影片（注音＋對齊拼音＋Legge 英譯）＋一頁重點生詞卡。
另有 `examples/學而1.1-1.3_v2.yaml` 為含標題頁／介紹頁／結尾頁的合輯範例。

### 破音字語法

| 寫法 | 意義 | 例子 |
|---|---|---|
| `字` | 字型預設讀音 | `樂` → ㄌㄜˋ |
| `[字:1]` | 第 2 讀音（OpenType ss01） | `[好:1]` → ㄏㄠˋ、`[鮮:1]` → ㄒㄧㄢˇ |
| `[字:2]` | 第 3 讀音（ss02） | `[弟:2]` → ㄊㄧˋ、`[與:2]` → ㄩˊ |
| `[字\|注音]` | 字型未收錄的讀音，手動合成注音 | `[說\|ㄩㄝˋ]` → 說ㄩㄝˋ |

學而篇已驗證的破音字對照：

| 字 | 讀音 | 寫法 |
|---|---|---|
| 說（喜悅） | ㄩㄝˋ yuè | `[說\|ㄩㄝˋ]`（字型沒收此讀音） |
| 樂（快樂） | ㄌㄜˋ lè | `樂`（預設） |
| 弟（悌） | ㄊㄧˋ tì | `[弟:2]` |
| 好（喜好） | ㄏㄠˋ hào | `[好:1]` |
| 鮮（少） | ㄒㄧㄢˇ xiǎn | `[鮮:1]` |
| 與（語助詞） | ㄩˊ yú | `[與:2]` |
| 曾（姓） | ㄗㄥ zēng | `[曾:1]` |
| 省（反省） | ㄒㄧㄥˇ xǐng | `[省:1]` |
| 為（為了） | ㄨㄟˋ wèi | `[為:1]` |
| 乘（兵車） | ㄕㄥˋ shèng | `[乘:1]` |
| 沒（歿） | ㄇㄛˋ mò | `[沒:1]` |
| 遠（遠離，動詞） | ㄩㄢˋ yuàn | `[遠:1]` |
| 論（論語） | ㄌㄨㄣˊ lún | `[論:1]` |

> 注意：讀音順序依字型版本而定，新增破音字時建議先渲染確認。
> 另「賜」台灣標準注音為ㄙˋ，拼音對應寫 `sì`。

### YAML 格式（v2）

```yaml
footer: "論語 · 學而篇 | The Analects · Book One"   # 頁尾文字（選填）

slides:
  # ── 課文投影片 ──
  - type: content
    tag: "學而 1.1 · Analects 1.1"        # 右上角章節標籤
    speaker: { zh: "子曰：", py: "Zǐ yuē", en: "The Master said," }   # 選填
    lines:
      - zh: "「學而時習之，"               # 中文（可含破音字語法）
        py: "xué ér shí xí zhī"           # 拼音：空格分隔，音節數＝漢字數（標點不算）
        en: "“To learn and constantly practice what is learned —"
      - zh: "不亦[說|ㄩㄝˋ]乎？"
        py: "bù yì yuè hū"
        en: "is it not a pleasure?"

  # ── 生詞卡片 ──
  - type: vocab
    tag: "學而 1.1 · Analects 1.1"
    words:                                 # 最多 3 個
      - { zh: "學", py: "xué", en: "to learn, to study" }
      - { zh: "朋", py: "péng", en: "a friend" }
      - { zh: "君子", py: "jūn zǐ", en: "a gentleman; person of virtue" }

  # ── 標題頁 / 結尾頁（用於合輯，見 examples/學而1.1-1.3_v2.yaml）──
  - type: title
    zh_main: "[論:1]語"
    py_main: "Lún yǔ"
    zh_sub: "學而篇"
    py_sub: "Xué ér piān"
    en: "The Analects of Confucius — Book One"
    note: "for learners of Chinese"
  - type: end
    zh: "謝謝！"
    py: "Xiè xie!"
    en: "Thank you!"
```

排版建議：每行漢字（含標點）不超過 9 個字，超過會自動等比縮小；
每張投影片最多 3 個區塊（說話者算 1 個），第 3 個區塊會自動改用緊湊間距。

---

## v1 產生器（make_analects_pptx.py，舊版）

原始「學而篇」白底版面：注音漢字圖片＋帶底線拼音＋藍色英文。

```bash
pip install pillow pyyaml uharfbuzz freetype-py fonttools
python make_analects_pptx.py --demo 1.4                      # 內建示範
python make_analects_pptx.py --config examples/學而1.4.yaml   # YAML 設定檔
```

- 一般格式範例：`examples/學而1.4.yaml`、`examples/學而1.5.yaml`
- 逐字控制格式（characters + ss_feature）：`examples/學而1.4_characters.yaml`
- 破音字可用 IVS 選擇子（如 `鮮\U000E01E1`）或 `ss_feature: ss01`；
  IVS 對照可查官方工具 https://buttaiwan.github.io/bpmfvs/
- **已知限制**：產出超過 5 張投影片時未修補 `[Content_Types].xml`，
  PowerPoint 會顯示空白頁（v2 已修正）

---

## 資料夾結構

```
analects_pptx/
├── make_analects_deck.py        # v2 產生器（推薦）
├── make_analects_pptx.py        # v1 產生器（舊版）
├── template.pptx                # 版面範本（必須保留）
├── fonts/
│   └── BpmfZihiKaiStd-Regular.ttf   # BPMFVs 注音字型
├── examples/
│   ├── v2/                      # ★ 學而篇全 16 章（v2 格式，每章一檔）
│   │   ├── 學而1.1.yaml … 學而1.16.yaml
│   ├── 學而1.1-1.3_v2.yaml      # v2 合輯範例（含標題／介紹／結尾頁）
│   ├── 學而1.4.yaml             # v1 格式範例
│   ├── 學而1.4_characters.yaml  # v1 逐字格式範例
│   └── …
└── README.md
```

---

## 字型說明

使用 **BPMFVs 注音 IVS 字型**（ButTaiwan 開源）：

- 下載：https://github.com/ButTaiwan/bpmfvs/releases
- 建議：`BpmfZihiKaiStd-Regular.ttf`（字嗨注音標楷，教科書風格）
- 放入 `fonts/` 資料夾即自動偵測，或用 `--font` 指定路徑

注音已渲染為圖片嵌入投影片，**觀看者不需安裝字型**。

---

## 常見問題

1. **PowerPoint 第 6 頁之後空白？** 用 v1 產生超過 5 頁會發生（範本 Content Types 未宣告），請改用 v2。
2. **破音字顯示「NO GLYPH」豆腐字？** 舊做法依賴 Pillow raqm 處理 IVS，部分平台不支援；v2 改用 harfbuzz 逐字 shaping，不受影響。
3. **拼音對不齊？** v2 的拼音是逐字定位的，音節數必須等於該行漢字數（標點不算），數量不符會直接報錯提示。
