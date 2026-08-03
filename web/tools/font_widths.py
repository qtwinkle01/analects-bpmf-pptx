#!/usr/bin/env python3
"""
font_widths.py — 匯出字型的字寬表，給 check_layout.js 用
=======================================================
Node 沒有 canvas，無法量測文字寬度。本工具用 fontTools 讀出精簡字型裡
每個字（含 IVS 破音字變體）的 advance width，輸出成 JSON 讓測試腳本
用純運算模擬 canvas 的 measureText()。

    python3 web/tools/font_widths.py \
        --font web/assets/bpmf-subset.ttf \
        --out  /tmp/widths.json
"""
import argparse
import json
import os

from fontTools.ttLib import TTFont


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="匯出字寬表供版面測試使用")
    ap.add_argument("--font", default=os.path.join(here, "..", "assets", "bpmf-subset.ttf"))
    ap.add_argument("--out", default=os.path.join(here, ".widths.json"))
    args = ap.parse_args()

    f = TTFont(args.font)
    hmtx = f["hmtx"].metrics
    cmap = f.getBestCmap()
    out = {"upm": f["head"].unitsPerEm, "default": {}, "ivs": {}}

    for cp, gname in cmap.items():
        if gname in hmtx:
            out["default"][str(cp)] = hmtx[gname][0]

    uvs_tables = [t for t in f["cmap"].tables if t.format == 14]
    if uvs_tables:
        for sel, entries in uvs_tables[0].uvsDict.items():
            for uni, g in entries:
                gname = g if g else cmap.get(uni)
                if gname and gname in hmtx:
                    out["ivs"][f"{uni}:{sel}"] = hmtx[gname][0]

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    print(f"✅ widths：{len(out['default'])} 字、{len(out['ivs'])} 個破音變體 → {args.out}")


if __name__ == "__main__":
    main()
