#!/usr/bin/env python3
"""
build_assets.py — 從論語原始素材重新產生網頁編輯器的資料與字型
================================================================
當你新增章節、或修改了 examples/v2/*.yaml 之後，執行本工具重新產生：

  web/data/chapters.json   各章內容（由 YAML 轉成 JSON）
  web/data/index.json      章節順序
  web/data/readings.json   每個字可用的破音字讀音（給下拉選單用）
  web/assets/bpmf-subset.ttf  只含用到的字的精簡字型（原字型 17MB → 數百 KB）

用法（在 web/tools/ 底下執行，預設路徑指向上兩層的原始 repo）：

    pip install pyyaml fonttools
    python build_assets.py \
        --yaml-dir ../../examples/v2 \
        --font ../../fonts/BpmfZihiKaiStd-Regular.ttf \
        --out ../

只要來源 YAML 與字型還在原本的 analects_pptx repo 裡，通常直接執行即可。
"""
import argparse
import glob
import json
import os
import re

RE_MARK = re.compile(r"\[(.)(?::(\d)|\|([^\]]+))\]")

# layout.js / make_analects_deck.py 版面上寫死的中文字（不會出現在 YAML 裡），
# 沒收進精簡字型的話網頁上會變成空白方框。
UI_CHARS = "生詞謝"


def chapter_sort_key(path):
    nums = re.findall(r"\d+", os.path.basename(path))
    return [int(x) for x in nums]


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


def build_data(yaml_dir, out_dir):
    import yaml
    files = sorted(glob.glob(os.path.join(yaml_dir, "*.yaml")), key=chapter_sort_key)
    chapters, chars = {}, set()
    for f in files:
        with open(f, encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh)
        if not cfg or "slides" not in cfg:
            continue
        cid = os.path.splitext(os.path.basename(f))[0]
        chapters[cid] = cfg
        collect_chars(cfg, chars)

    data_dir = os.path.join(out_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    json.dump(chapters, open(os.path.join(data_dir, "chapters.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump({"chapters": list(chapters.keys())},
              open(os.path.join(data_dir, "index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"✅ data：{len(chapters)} 章、{len(chars)} 個字")
    return chapters, chars


def build_readings(font_path, chars, out_dir):
    from fontTools.ttLib import TTFont
    f = TTFont(font_path)
    uvs = [t for t in f["cmap"].tables if t.format == 14]
    readings = {}
    if uvs:
        uvs = uvs[0]
        for ch in chars:
            feats = []
            for sel, entries in uvs.uvsDict.items():
                for uni, g in entries:
                    if uni == ord(ch):
                        idx = sel - 0xE01E0
                        if idx >= 1:
                            feats.append(idx)
            if feats:
                readings[ch] = sorted(set(feats))
    data_dir = os.path.join(out_dir, "data")
    json.dump(readings, open(os.path.join(data_dir, "readings.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
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
    font = TTFont(font_path)
    ss = subset.Subsetter(options=opts)
    ss.populate(unicodes=sorted(unicodes))
    ss.subset(font)
    assets = os.path.join(out_dir, "assets")
    os.makedirs(assets, exist_ok=True)
    out = os.path.join(assets, "bpmf-subset.ttf")
    font.save(out)
    print(f"✅ font：{os.path.getsize(out) / 1024:.0f} KB → {out}")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="重新產生網頁編輯器資料與精簡字型")
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
