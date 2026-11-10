#!/usr/bin/env python3
"""
check_readings.py — 檢查每個字「投影片上的注音」與 YAML 裡寫的拼音是不是同一個讀音
======================================================================================
投影片上的注音來自字型（破音字用 [字:1] 選讀音），拼音則是 YAML 裡另外打的字；
兩邊各改各的，很容易只改一邊（例如把「不」標成 [不:1] ㄅㄨˊ，拼音卻還是 bù）。

逐字檢查：
  - 一般字、[字:N]：用 zhuyin_font.py 從字型讀出注音 → 轉拼音，與 YAML 的拼音比對
  - [字|ㄩㄝˋ]（手動注音）：把手寫的注音轉拼音後比對
  - 漢字數 ≠ 拼音音節數的句子：列為錯誤（無法逐字比對）
讀不出來的字（字型沒有這個字、認不出注音）只列為提醒，不算錯誤。

用法：
    pip install pyyaml fonttools freetype-py numpy pillow pypinyin
    python web/tools/check_readings.py                       # 檢查 examples/v2 全部
    python web/tools/check_readings.py examples/v2/學而1.8.yaml  # 只檢查指定的檔

有錯誤時結束碼為 1（CI 會擋下部署）。
"""
import argparse
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "bootstrap"))

RE_TOKEN = re.compile(r"\[(.)(?::(\d)|\|([^\]]+))\]|(.)")


def is_han(ch):
    o = ord(ch)
    return 0x3400 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x2FA1F


def tokens(zh):
    """原文 → [(字, 讀音編號 或 None, 手動注音 或 None)]，只留漢字"""
    out = []
    for m in RE_TOKEN.finditer(zh or ""):
        if m.group(4):
            if is_han(m.group(4)):
                out.append((m.group(4), None, None))
        elif m.group(2):
            out.append((m.group(1), int(m.group(2)), None))
        else:
            out.append((m.group(1), None, m.group(3)))
    return out


def norm(py):
    """拼音比對用：去掉頭尾標點、不分大小寫"""
    return re.sub(r"^[^\w]+|[^\w]+$", "", py, flags=re.UNICODE).lower()


def entries(cfg):
    """走過一章裡所有「原文＋拼音」的地方，回傳 (位置說明, zh, py)"""
    for i, sl in enumerate(cfg.get("slides") or [], 1):
        where = f"第 {i} 頁"
        sp = sl.get("speaker")
        if sp and sp.get("zh") and sp.get("py"):
            yield f"{where}（說話者）", sp["zh"], sp["py"]
        for ln in sl.get("lines") or []:
            if ln.get("zh") and ln.get("py"):
                yield where, ln["zh"], ln["py"]
        for w in sl.get("words") or []:
            if w.get("zh") and w.get("py"):
                yield f"{where}（生詞卡）", w["zh"], w["py"]


def check_file(path, fz):
    import yaml
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    name = os.path.splitext(os.path.basename(path))[0]
    errors, notes, n = [], [], 0
    for where, zh, py in entries(cfg):
        toks, syls = tokens(zh), py.split()
        if len(toks) != len(syls):
            errors.append(f"{name} {where}：漢字 {len(toks)} 個 vs 拼音 {len(syls)} 音節 → {zh} / {py}")
            continue
        for (ch, var, manual), syl in zip(toks, syls):
            n += 1
            zy = manual if manual else fz.zhuyin(ch, var)
            want = fz.to_pinyin(zy)
            mark = f"[{ch}|{manual}]" if manual else (f"[{ch}:{var}]" if var else ch)
            if not want:
                notes.append(f"{name} {where}：{mark} 讀不出注音（{zy or '字型沒有這個字形'}），沒有比對 → {zh}")
                continue
            if norm(want) != norm(syl):
                others = []
                if not manual:
                    for v in [None] + fz.variants(ch):
                        if v != var and norm(fz.pinyin(ch, v) or "") == norm(syl):
                            others.append(ch if v is None else f"[{ch}:{v}]")
                hint = f"；拼音 {syl} 對應的寫法是 {others[0]}" if others else ""
                errors.append(f"{name} {where}：{mark} 注音是 {zy}（{want}），拼音卻寫 {syl}{hint} → {zh} / {py}")
    return errors, notes, n


def main():
    ap = argparse.ArgumentParser(description="檢查注音（字型）與拼音（YAML）是否一致")
    ap.add_argument("files", nargs="*", help="要檢查的 YAML；不給就檢查 --yaml-dir 底下全部")
    ap.add_argument("--yaml-dir", default=os.path.join(ROOT, "examples", "v2"))
    ap.add_argument("--font", default=os.path.join(ROOT, "fonts", "BpmfZihiKaiStd-Regular.ttf"))
    args = ap.parse_args()

    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8")

    from zhuyin_font import FontZhuyin
    fz = FontZhuyin(args.font)

    files = args.files or sorted(
        p for p in glob.glob(os.path.join(args.yaml_dir, "*.yaml"))
        if os.path.basename(p) != "books.yaml")
    if not files:
        sys.exit(f"找不到 YAML：{args.yaml_dir}")

    errors, notes, total = [], [], 0
    for p in files:
        e, w, n = check_file(p, fz)
        errors += e
        notes += w
        total += n

    for w in notes:
        print(f"   ⚠ {w}")
    if errors:
        print(f"\n❌ 注音與拼音不一致：{len(errors)} 處")
        for e in errors:
            print(f"   {e}")
        print("\n修法：兩邊改成同一個讀音——改拼音，或用 [字:N]／[字|注音] 改注音。")
        sys.exit(1)
    print(f"✅ 注音與拼音一致：{len(files)} 章、{total} 個字")


if __name__ == "__main__":
    main()
