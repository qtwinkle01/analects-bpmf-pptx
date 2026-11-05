#!/usr/bin/env python3
"""
convert_source.py — 把 chinese-poetry 的論語（簡體）轉成台灣繁體
================================================================
    pip install opencc
    python tools/bootstrap/convert_source.py            # 輸出 tools/bootstrap/source/lunyu.tw.json

處理順序（順序很重要）：
  1. 拿掉書名號《》：否則「《詩》云」的「云」會被 OpenCC 誤轉成「雲」
  2. OpenCC s2tw（台灣標準字形，例如 为→為，不是 爲）
  3. 引號 “”‘’ → 「」『』
  4. VARIANTS 異體字對照（台灣教科書慣用字形）

驗證：與已校對的學而篇比對，字一致率約 98%，其餘差異幾乎都是各版本的標點習慣。
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
QUOTES = str.maketrans({"“": "「", "”": "」", "‘": "『", "’": "』"})
# 以「詞」為單位替換，避免誤傷其他用法；發現新的再補
VARIANTS = {"泛愛眾": "汎愛眾"}


def make_converter():
    import opencc
    conv = opencc.OpenCC("s2tw")

    def to_tw(s):
        s = s.replace("《", "").replace("》", "")
        s = conv.convert(s).translate(QUOTES)
        for a, b in VARIANTS.items():
            s = s.replace(a, b)
        return s
    return to_tw


def main():
    ap = argparse.ArgumentParser(description="論語原文簡轉繁")
    ap.add_argument("--src", default=os.path.join(HERE, "source", "lunyu.chinese-poetry.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "source", "lunyu.tw.json"))
    args = ap.parse_args()
    to_tw = make_converter()
    books = json.load(open(args.src, encoding="utf-8"))
    out = [{"num": i, "zh": to_tw(b["chapter"]).removesuffix("篇"),
            "chapters": [to_tw(p) for p in b["paragraphs"]]}
           for i, b in enumerate(books, 1)]
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"✅ {len(out)} 篇、{sum(len(b['chapters']) for b in out)} 章 → {args.out}")


if __name__ == "__main__":
    main()
