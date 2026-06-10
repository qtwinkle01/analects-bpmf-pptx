# 論語投影片生成工具

自動將論語章句製作成帶有**中文注音、漢語拼音、英文翻譯**的 PowerPoint 投影片，格式完全對應「學而篇」系列的版面風格。

---

## 資料夾結構

```
analects_pptx/
├── make_analects_pptx.py   # 主程式
├── template.pptx           # 版面範本（必須保留）
├── fonts/
│   └── BpmfZihiKaiStd-Regular.ttf   # BPMFVs 注音字型
├── examples/
│   ├── 學而1.4.yaml        # 學而篇 1.4 設定範例
│   ├── 學而1.5.yaml        # 學而篇 1.5 設定範例
│   ├── 學而1.4_characters.yaml   # 學而篇 1.4 characters 格式範例
│   └── 學而1.5_characters.yaml   # 學而篇 1.5 characters 格式範例
└── README.md               # 本說明文件
```

---

## 安裝需求

```bash
pip install pillow pyyaml uharfbuzz freetype-py fonttools
```

Python 版本需求：**3.10 以上**（使用了 `tuple[...]` 型別標註）。

---

## 快速開始

### 方法一：使用內建示範資料

```bash
# 生成學而 1.4（曾子曰：吾日三省吾身...）
python make_analects_pptx.py --demo 1.4

# 生成學而 1.5（子曰：道千乘之國...）
python make_analects_pptx.py --demo 1.5

# 指定輸出路徑
python make_analects_pptx.py --demo 1.4 --output 學而1.4.pptx
```

### 方法二：使用 YAML 設定檔

```bash
python make_analects_pptx.py --config examples/學而1.4.yaml
python make_analects_pptx.py --config examples/學而1.5.yaml --output 學而1.5.pptx
```

---

## YAML 設定檔格式

每個 YAML 檔案描述一章的所有投影片，結構如下：

```yaml
title: 學而 1.X          # 章節標題（目前僅作說明用）

slides:
  # ── 第一張投影片 ──────────────────────────────────
  - speaker: "子曰："              # 說話者（選填）
    speaker_pinyin:                # 說話者拼音
      - underline: "Zǐ   yuē"     # 帶底線的部分
      - plain: "   :"              # 不帶底線的部分
    speaker_english: "The Master said,"   # 說話者英文

    sentences:                     # 本張投影片的句子列表
      - chinese: "「學而時習之，"   # 中文原文（用於生成注音圖片）
        pinyin:
          - underline: "Xué  ér  shí  xí  zhī"
          - plain: "   ,"
        english: '"Is it not pleasant to learn with constant perseverance?'

  # ── 第二張投影片 ──────────────────────────────────
  - sentences:
      - chinese: "不亦說乎？」"
        pinyin:
          - underline: "Bú  yì  yuè  hū"
          - plain: "   ?\u201D"     # \u201D 是右引號 "
        english: '"Is it not pleasant..."'
```

### 拼音格式說明

`pinyin` 欄位支援兩種寫法：

**寫法一：列表（推薦）**，可分別控制哪些部分帶底線：

```yaml
pinyin:
  - underline: "Zǐ   yuē"   # 這段有底線
  - plain: "   :"            # 這段無底線
```

**寫法二：字串**，整行都帶底線：

```yaml
pinyin: "Zǐ   yuē   :"
```

### 破音字設定方式

#### 3-1. 查詢破音字讀音的方法

請先使用官方工具 https://buttaiwan.github.io/bpmfvs/：

1. 開啟網頁，貼上含破音字的文章。
2. 點擊頁面上紅色標記的多音字，選擇正確讀音。
3. 按「完成」後複製輸出文字。
4. 輸出文字中的漢字後方已內嵌 IVS 選擇子，可直接貼入 YAML。

#### 3-2. IVS vs GSUB 選擇建議

| 方式 | 適用情境 | 穩定性 |
|---|---|---|
| IVS（`\U000E01E1` 等） | 優先使用 | ✅ 高，跨軟體不遺失 |
| GSUB（`ss01` 等） | IVS 無效時備用 | ⚠️ 中，不同軟體間可能遺失 |

#### 3-3. 常見破音字範例表

以下為常見破音字的設定範例，實際 IVS 讀音請以官方工具輸出為準：

| 漢字 | IVS 範例 | GSUB 範例 |
|---|---|---|
| 會 | `會\U000E01E1` | `ss01` |
| 鮮 | `鮮\U000E01E1` | `ss01` |
| 行 | `行\U000E01E1` | `ss01` |
| 長 | `長\U000E01E1` | `ss01` |
| 重 | `重\U000E01E1` | `ss01` |

#### characters 範例

```yaml
sentences:
  - characters:
      - char: "會\U000E01E1"
      - char: "曾"
        ss_feature: ss01
      - char: "曾"
        ss_feature: ss10
    pinyin:
      - underline: "Huì   zī   shuō"
      - plain: "   :"
    english: "The character uses IVS for the preferred reading and ss for backup."
```

### 多音字（IVS 選擇子）

對於有多個讀音的漢字，需要在字後加上 Unicode IVS 選擇子。以「鮮」字為例：

| 讀音 | 意思 | 用法 |
|------|------|------|
| ㄒㄧㄢ（xiān） | 鮮豔 | 直接寫「鮮」（預設） |
| ㄒㄧㄢˇ（xiǎn） | 少 | 「鮮」+ `\U000E01E1` |

在 YAML 中使用 Python 字串跳脫：

```yaml
chinese: "巧言令色，鮮\U000E01E1矣仁！"
```

或在 Python 程式中：

```python
xian_xian = "鮮" + chr(0xE01E1)   # ㄒㄧㄢˇ
```

常用多音字 IVS 對照表請參考 [BPMFVs 網站](https://buttaiwan.github.io/bpmfvs/)。

---

## 字型說明

本工具使用 **BPMFVs 注音 IVS 字型**，由 ButTaiwan 開源釋出。

- 下載頁面：https://github.com/ButTaiwan/bpmfvs/releases
- 建議字型：`BpmfZihiKaiStd-Regular.ttf`（字嗨注音標楷，最接近教科書風格）
- 其他可選：`BpmfIansui-Regular.ttf`（注音芫荽）、`BpmfZihiSerif-Regular.ttf`（宋體）

下載後將 `.ttf` 檔案放到 `fonts/` 資料夾即可自動偵測。

也可以用 `--font` 參數指定字型路徑：

```bash
python make_analects_pptx.py --config 學而1.6.yaml --font /path/to/BpmfIansui-Regular.ttf
```

---

## 完整命令列選項

```
用法：python make_analects_pptx.py [選項]

選項：
  --config, -c  YAML 設定檔路徑
  --output, -o  輸出 PPTX 路徑（預設：與設定檔同名）
  --font, -f    指定 BPMFVs 字型檔案路徑
  --demo        使用內建示範資料（1.4 或 1.5）
  --list-fonts  列出 fonts/ 資料夾中可用的字型
```

---

## 製作新章節的流程

以學而篇 1.6 為例：

**第一步**：建立 YAML 設定檔 `學而1.6.yaml`

```yaml
title: 學而 1.6

slides:
  - speaker: "子曰："
    speaker_pinyin:
      - underline: "Zǐ   yuē"
      - plain: "   :"
    speaker_english: "The Master said,"
    sentences:
      - chinese: "「弟子入則孝，"
        pinyin:
          - underline: "Dì   zǐ   rù   zé   xiào"
          - plain: "   ,"
        english: '"A youth, when at home, should be filial,'
      - chinese: "出則弟，"
        pinyin:
          - underline: "Chū   zé   tì"
          - plain: "   ,"
        english: "and, abroad, respectful to his elders."

  - sentences:
      - chinese: "謹而信，"
        pinyin:
          - underline: "Jǐn   ér   xìn"
          - plain: "   ,"
        english: "He should be earnest and truthful."
      - chinese: "汎愛眾，而親仁。"
        pinyin:
          - underline: "Fàn   ài   zhòng   ér   qīn   rén"
          - plain: "   ."
        english: "He should overflow in love to all, and cultivate the friendship of the good."
      - chinese: "行有餘力，則以學文。」"
        pinyin:
          - underline: "Xíng   yǒu   yú   lì   zé   yǐ   xué   wén"
          - plain: "   .\u201D"
        english: 'When he has time and opportunity, after the performance of these things, he should employ them in polite studies."'
```

**第二步**：執行生成

```bash
python make_analects_pptx.py --config 學而1.6.yaml
```

**第三步**：開啟 `學而1.6.pptx` 確認效果，若需調整可直接修改 YAML 後重新執行。

---

## 注意事項

1. **字型需安裝或放在 `fonts/` 資料夾**：若 PowerPoint 開啟後注音消失，代表電腦未安裝 BPMFVs 字型。請從上方連結下載安裝，或直接使用本工具生成的圖片（注音已嵌入為圖片，不受字型影響）。

2. **拼音間距**：拼音行中每個音節之間建議加入 2-4 個空格，以便對齊注音圖片中的漢字位置（參考範例中的寫法）。

3. **引號字元**：建議使用 Unicode 引號（`\u201C` 為 `"` ，`\u201D` 為 `"`），而非 ASCII 的 `"`，以符合原始範本的排版風格。

4. **多張投影片**：每個 YAML 的 `slides` 列表中可包含任意數量的投影片，每張投影片最多建議放 2-3 個句子以避免版面過擠。
