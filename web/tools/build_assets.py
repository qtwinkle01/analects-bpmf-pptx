#!/usr/bin/env python3
"""
build_assets.py — 從論語原始素材重新產生網頁的資料與字型
============================================================
新增章節、或修改了 examples/v2/*.yaml 之後，執行本工具重新產生：

  web/data/chapters.json      各章內容（由 YAML 轉成 JSON）
  web/data/index.json         篇名表、章節順序、每章的狀態與第一句（目錄頁用）
  web/data/readings.json      每個字可用的破音字讀音（給讀音選單用）
  web/data/pptx.json          事先產生好的 PPT 清單（本機為空；CI 產生 PPT 後覆蓋，不進 git）
  web/assets/bpmf-subset.woff2  只含用到的字的精簡字型（原字型 17MB → 約 100KB）

同一份輸入每次產生的檔案都完全相同（不含時間戳、不依賴執行順序），
所以 git diff 只會出現真正的內容變化。

用法（在 repo 根目錄）：

    pip install pyyaml fonttools brotli
    python web/tools/build_assets.py

預設讀 examples/v2/（含 books.yaml 篇名表）與 fonts/BpmfZihiKaiStd-Regular.ttf，
路徑不同時用 --yaml-dir / --font / --out 指定。
"""
import argparse
import glob
import json
import os
import re
import sys

RE_MARK = re.compile(r"\[(.)(?::(\d)|\|([^\]]+))\]")
RE_ID = re.compile(r"^(\D+)(\d+)\.(\d+)$")       # 學而1.6 → 篇名、篇號、章號
STATUSES = ("draft", "reviewed")                  # draft＝待校對、reviewed＝已校對

# layout.js / make_analects_deck.py 版面上寫死的中文字（不會出現在 YAML 裡），
# 沒收進精簡字型的話網頁上會改用一般字型顯示、沒有注音。
UI_CHARS = "生詞謝"


def chapter_sort_key(path):
    return [int(x) for x in re.findall(r"\d+", os.path.basename(path))]


def plain(zh):
    """去掉破音字標記：不亦[說|ㄩㄝˋ]乎？ → 不亦說乎？"""
    return RE_MARK.sub(lambda m: m.group(1), zh or "")


def collect_chars(cfg, chars):
    def walk(zh):
        pos = 0
        for m in RE_MARK.finditer(zh):
            for ch in zh[pos:m.start()]:
                chars.add(ch)
            chars.add(m.group(1))
            pos = m.end()
        for ch in zh[pos:]:
            chars.add(ch)

    for sl in cfg.get("slides", []):
        if sl.get("speaker"):
            walk(sl["speaker"]["zh"])
        for ln in sl.get("lines", []):
            walk(ln["zh"])
        for w in sl.get("words", []):
            walk(w["zh"])
        for k in ("zh_main", "zh_sub", "zh"):
            if sl.get(k):
                walk(sl[k])


def first_sentence(cfg):
    """目錄頁顯示的第一句：第一張課文投影片的說話者＋第一行（中、英）"""
    for sl in cfg.get("slides", []):
        if sl.get("type", "content") != "content":
            continue
        sp, lines = sl.get("speaker") or {}, sl.get("lines") or []
        first = lines[0] if lines else {}
        zh = plain(sp.get("zh", "")) + plain(first.get("zh", ""))
        en = " ".join(x for x in (sp.get("en", ""), first.get("en", "")) if x)
        return zh, en
    return "", ""


def load_books(yaml_dir):
    import yaml
    path = os.path.join(yaml_dir, "books.yaml")
    if not os.path.exists(path):
        sys.exit(f"找不到篇名表 {path}")
    with open(path, encoding="utf-8") as fh:
        books = yaml.safe_load(fh)["books"]
    nos = [b["num"] for b in books]
    if nos != list(range(1, len(books) + 1)):
        sys.exit(f"books.yaml 的篇號必須是 1、2、3… 依序排列，現在是 {nos}")
    return books


def build_data(yaml_dir, out_dir):
    import yaml
    books = load_books(yaml_dir)
    by_zh = {b["zh"]: b for b in books}
    files = sorted(glob.glob(os.path.join(yaml_dir, "*.yaml")), key=chapter_sort_key)
    chapters, meta, chars = {}, {}, set()
    for f in files:
        with open(f, encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh)
        if not cfg or "slides" not in cfg:
            continue                                  # books.yaml 等非章節檔
        cid = os.path.splitext(os.path.basename(f))[0]
        m = RE_ID.match(cid)
        if not m or m.group(1) not in by_zh or by_zh[m.group(1)]["num"] != int(m.group(2)):
            sys.exit(f"{os.path.basename(f)}：檔名要是「篇名＋篇號.章號」且與 books.yaml 一致，例如 學而1.6.yaml")
        status = cfg.get("status", "draft")
        if status not in STATUSES:
            sys.exit(f"{cid}：status 只能是 {' / '.join(STATUSES)}，現在是 {status!r}")
        chapters[cid] = cfg
        zh, en = first_sentence(cfg)
        meta[cid] = {"book": int(m.group(2)), "ch": int(m.group(3)), "status": status,
                     "first_zh": zh, "first_en": en}
        collect_chars(cfg, chars)

    data_dir = os.path.join(out_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    write_json(os.path.join(data_dir, "chapters.json"), chapters, indent=1)
    write_json(os.path.join(data_dir, "index.json"),
               {"books": books, "chapters": list(chapters), "meta": meta}, indent=1)
    # 事先產生好的 PPT 清單：CI 的 export_all_pptx.js 會覆蓋；本機先放空清單（網頁改在瀏覽器即時產生）
    write_json(os.path.join(data_dir, "pptx.json"), {})
    reviewed = sum(1 for v in meta.values() if v["status"] == "reviewed")
    print(f"✅ data：{len(chapters)} 章（已校對 {reviewed}）、{len(chars)} 個字、{len(books)} 篇")
    return chapters, chars


def write_json(path, obj, indent=None):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=indent)
        fh.write("\n")


def build_readings(font_path, chars, out_dir):
    from fontTools.ttLib import TTFont
    f = TTFont(font_path, lazy=True)
    uvs = [t for t in f["cmap"].tables if t.format == 14]
    readings = {}
    if uvs:
        wanted = {ord(c) for c in chars}
        found = {}
        for sel, entries in uvs[0].uvsDict.items():
            idx = sel - 0xE01E0
            if idx < 1:
                continue
            for uni, _ in entries:
                if uni in wanted:
                    found.setdefault(uni, set()).add(idx)
        readings = {chr(u): sorted(v) for u, v in sorted(found.items())}
    write_json(os.path.join(out_dir, "data", "readings.json"), readings)
    print(f"✅ readings：{len(readings)} 個多音字")


def build_font(font_path, chars, out_dir):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    unicodes = set(ord(c) for c in chars)
    unicodes.update(ord(c) for c in UI_CHARS)   # 版面寫死的字（生詞、謝謝）
    for v in range(0xE01E0, 0xE01E4):
        unicodes.add(v)                       # 變體選擇子 ss00..ss03
    for cp in range(0x3105, 0x3130):
        unicodes.add(cp)                      # 注音符號
    for cp in range(0x31A0, 0x31C0):
        unicodes.add(cp)                      # 注音符號擴充
    for cp in (0x02CA, 0x02C7, 0x02CB, 0x02D9, 0x02C9):
        unicodes.add(cp)                      # 聲調符號
    for c in "、。，？！：；「」『』（）·　":
        unicodes.add(ord(c))

    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.glyph_names = True
    opts.recalc_bounds = True
    font = TTFont(font_path, recalcTimestamp=False)   # 不寫入當下時間，結果才會每次相同
    ss = subset.Subsetter(options=opts)
    ss.populate(unicodes=sorted(unicodes))
    ss.subset(font)
    font.flavor = "woff2"
    assets = os.path.join(out_dir, "assets")
    os.makedirs(assets, exist_ok=True)
    out = os.path.join(assets, "bpmf-subset.woff2")
    font.save(out)
    print(f"✅ font：{os.path.getsize(out) / 1024:.0f} KB → {out}")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="重新產生網頁資料與精簡字型")
    ap.add_argument("--yaml-dir", default=os.path.join(here, "..", "..", "examples", "v2"))
    ap.add_argument("--font", default=os.path.join(here, "..", "..", "fonts", "BpmfZihiKaiStd-Regular.ttf"))
    ap.add_argument("--out", default=os.path.join(here, ".."))
    args = ap.parse_args()

    chapters, chars = build_data(args.yaml_dir, args.out)
    build_readings(args.font, chars, args.out)
    build_font(args.font, chars, args.out)
    print("完成。")


if __name__ == "__main__":
    main()
