#!/usr/bin/env python3
"""
make_drafts.py — 由公開原文產生各章初版 YAML（status: draft）
=============================================================
    pip install pyyaml opencc fonttools freetype-py numpy pillow pypinyin
    python tools/bootstrap/make_drafts.py --books 2            # 只產生為政篇
    python tools/bootstrap/make_drafts.py --books 2-20         # 其他 19 篇

預設輸出到 tools/bootstrap/drafts/（不會影響網站）；確認後用 --out examples/v2 放進正式資料。
已存在的檔案一律不覆蓋（除非加 --force），避免蓋掉人工校對過的內容。

每章做了什麼：
  1. 原文：source/lunyu.chinese-poetry.json → 台灣繁體（convert_source.py 的規則）
  2. 切說話者與句子：句首或「。？！」』，；」後面的「X曰：」開新的說話者；句子依 ，。；？！： 切開
  3. 分頁：說話者開新頁、句子結束（。？！；）且已有 2 個區塊就換頁、每頁最多 3 個區塊
     （用學而篇驗證：12/16 章與人工分頁相同）
  4. 讀音：字型預設讀音（台灣標準音）＋ 已校對章節的上下文讀音（「記憶」）
     （用學而 1.1–1.7 驗證：拼音正確率約 93%）；字型有多個讀音、又沒有記憶可依據的字，
     列在檔案的 check: 清單請人確認
  5. 拼音：一律由選定的注音轉出，所以注音與拼音一定一致
  6. 英文：只有「子曰：」先填 Confucius said,，其餘留空（英譯方式尚未決定）
  7. 生詞卡：不產生（尚未決定）
"""
import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from convert_source import make_converter  # noqa: E402
from zhuyin_font import FontZhuyin  # noqa: E402

RE_MARK = re.compile(r"\[(.)(?::(\d)|\|([^\]]+))\]")
RE_SPEAKER = re.compile(r"[^「」『』，。？！：；、]{1,12}?曰：")
RE_LINE = re.compile(r"[^，。；？！：]+[，。；？！：]?[」』]*")
SENT_END = re.compile(r"[。？！；][」』]*$")
SPEAKER_EN = {"子曰：": "Confucius said,"}            # 與已校對的學而篇一致
han = lambda c: "㐀" <= c <= "鿿" or "豈" <= c <= "﫿"


def parse_units(zh):
    out, pos = [], 0
    for m in RE_MARK.finditer(zh):
        out += [(c, None) for c in zh[pos:m.start()]]
        out.append((m.group(1), ("v", int(m.group(2))) if m.group(2) else ("m", m.group(3))))
        pos = m.end()
    return out + [(c, None) for c in zh[pos:]]


def contexts(text, i):
    l = text[i - 1] if i else "^"
    r = text[i + 1] if i + 1 < len(text) else "$"
    return (("LR", l, text[i], r), ("R", text[i], r), ("L", l, text[i]))


def learn(yaml_dir, reviewed_only=True):
    """已校對章節裡每個字在什麼上下文用了什麼讀音"""
    mem = defaultdict(Counter)
    for f in glob.glob(os.path.join(yaml_dir, "*.yaml")):
        cfg = yaml.safe_load(open(f, encoding="utf-8")) or {}
        if "slides" not in cfg or (reviewed_only and cfg.get("status") != "reviewed"):
            continue
        for sl in cfg["slides"]:
            for it in ([sl["speaker"]] if sl.get("speaker") else []) + sl.get("lines", []):
                units = parse_units(it["zh"])
                text = "".join(c for c, _ in units)
                for i, (c, spec) in enumerate(units):
                    if han(c):
                        for k in contexts(text, i):
                            mem[k][spec or ("v", None)] += 1
    return mem


def split_paragraph(p):
    """→ [(speaker or None, [lines…]), …]"""
    segs, pos, cur_sp = [], 0, None
    for m in RE_SPEAKER.finditer(p):
        if m.start() != 0 and p[m.start() - 1] not in "。？！」』，；":
            continue
        if m.start() > pos or cur_sp is not None:
            segs.append((cur_sp, p[pos:m.start()]))
        cur_sp, pos = m.group(0), m.end()
    segs.append((cur_sp, p[pos:]))
    return [(sp, [x for x in RE_LINE.findall(body) if x.strip()]) for sp, body in segs if sp or body.strip()]


def paginate(segs):
    pages, cur = [], []
    for sp, lines in segs:
        if sp:
            if cur:
                pages.append(cur)
            cur = [("S", sp)]
        for ln in lines:
            if len(cur) >= 3:
                pages.append(cur)
                cur = []
            cur.append(("L", ln))
            if SENT_END.search(ln) and len(cur) >= 2:
                pages.append(cur)
                cur = []
    if cur:
        pages.append(cur)
    return pages


class Reader:
    def __init__(self, fz, mem):
        self.fz, self.mem = fz, mem

    def line(self, text, where, checks):
        """回傳 (帶破音字標記的 zh, 拼音)"""
        zh, toks = [], []
        for i, c in enumerate(text):
            if not han(c):
                zh.append(c)
                continue
            if not self.fz.has(c):
                checks.append(f"{where}「{c}」：字型沒有這個字，投影片不會有注音")
                zh.append(c); toks.append("?")
                continue
            spec = next((self.mem[k].most_common(1)[0][0] for k in contexts(text, i) if self.mem[k]), None)
            learned = spec is not None
            spec = spec or ("v", None)
            if spec[0] == "m":
                zh.append(f"[{c}|{spec[1]}]")
                zy = spec[1]
            else:
                zh.append(f"[{c}:{spec[1]}]" if spec[1] else c)
                zy = self.fz.zhuyin(c, spec[1])
            py = self.fz.to_pinyin(zy) or "?"
            toks.append(py)
            vs = self.fz.variants(c)
            if vs and not learned:
                # 讀不出合法音節時顯示 ?（影像比對偶爾會錯，不要列出錯的注音）
                opts = "、".join(z if z and self.fz.valid(z) else "?" for z in (self.fz.zhuyin(c, v) for v in vs))
                checks.append(f"{where}「{c}」：用預設 {zy}；字型另有 {opts}")
        return "".join(zh), " ".join(toks)


def chapter_yaml(book, ch_no, para, reader):
    cid = f"{book['zh']}{book['num']}.{ch_no}"
    tag = f"{book['zh']} {book['num']}.{ch_no} · Analects {book['num']}.{ch_no}"
    checks, slides = [], []
    for pi, page in enumerate(paginate(split_paragraph(para)), 1):
        sl = {"type": "content", "tag": tag}
        lines, li = [], 0
        for kind, text in page:
            where = f"第{pi}頁{'說話者' if kind == 'S' else f'第{li + 1}句'}"
            zh, py = reader.line(text, where, checks)
            if kind == "S":
                if py and py[0].isalpha():
                    py = py[0].upper() + py[1:]
                sl["speaker"] = {"zh": zh, "py": py, "en": SPEAKER_EN.get(text, "")}
            else:
                lines.append({"zh": zh, "py": py, "en": ""})
                li += 1
        sl["lines"] = lines
        slides.append(sl)
    out = [f"# 論語．{book['zh']} {book['num']}.{ch_no}（教學簡報 v2 格式）",
           "# 破音字語法：[字:1]=第2讀音、[字:2]=第3讀音、[字|ㄩㄝˋ]=手動合成注音",
           "# 初版：由 tools/bootstrap/make_drafts.py 自動產生，校對完請刪除 check 清單並把 status 改成 reviewed",
           "",
           f'footer: {json.dumps(f"論語 · {book["zh"]}篇 | The Analects · {book["en"]}", ensure_ascii=False)}',
           "status: draft"]
    if checks:
        out.append("check:")
        out += [f"  - {json.dumps(c, ensure_ascii=False)}" for c in checks]
    out += ["", "slides:"]
    for si, sl in enumerate(slides):
        if si:
            out.append("")
        out.append("  - type: content")
        out.append(f"    tag: {json.dumps(sl['tag'], ensure_ascii=False)}")
        if "speaker" in sl:
            sp = sl["speaker"]
            out.append("    speaker: { " + ", ".join(f"{k}: {json.dumps(sp[k], ensure_ascii=False)}" for k in ("zh", "py", "en")) + " }")
        out.append("    lines:" if sl["lines"] else "    lines: []")
        for ln in sl["lines"]:
            out.append(f"      - zh: {json.dumps(ln['zh'], ensure_ascii=False)}")
            out.append(f"        py: {json.dumps(ln['py'], ensure_ascii=False)}")
            out.append(f"        en: {json.dumps(ln['en'], ensure_ascii=False)}")
    return cid, "\n".join(out) + "\n", len(checks)


def parse_books(spec):
    nums = set()
    for part in spec.split(","):
        a, _, b = part.partition("-")
        nums.update(range(int(a), int(b or a) + 1))
    return sorted(nums)


def main():
    ap = argparse.ArgumentParser(description="由公開原文產生各章初版 YAML")
    ap.add_argument("--books", default="2-20", help="篇號，例如 2 或 2-20 或 2,4,6")
    ap.add_argument("--src", default=os.path.join(HERE, "source", "lunyu.chinese-poetry.json"))
    ap.add_argument("--yaml-dir", default=os.path.join(ROOT, "examples", "v2"), help="books.yaml 與已校對章節所在")
    ap.add_argument("--font", default=os.path.join(ROOT, "fonts", "BpmfZihiKaiStd-Regular.ttf"))
    ap.add_argument("--out", default=os.path.join(HERE, "drafts"))
    ap.add_argument("--force", action="store_true", help="覆蓋已存在的檔案（小心：會蓋掉人工校對）")
    args = ap.parse_args()

    books = {b["num"]: b for b in yaml.safe_load(open(os.path.join(args.yaml_dir, "books.yaml"), encoding="utf-8"))["books"]}
    src = json.load(open(args.src, encoding="utf-8"))
    to_tw = make_converter()
    reader = Reader(FontZhuyin(args.font), learn(args.yaml_dir))
    os.makedirs(args.out, exist_ok=True)
    made = skipped = flags = 0
    for num in parse_books(args.books):
        book = books[num]
        for ch_no, para in enumerate(src[num - 1]["paragraphs"], 1):
            path = os.path.join(args.out, f"{book['zh']}{num}.{ch_no}.yaml")
            if os.path.exists(path) and not args.force:
                skipped += 1
                continue
            cid, text, n = chapter_yaml(book, ch_no, to_tw(para), reader)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
            made += 1
            flags += n
        print(f"  {book['zh']}篇：{len(src[num - 1]['paragraphs'])} 章")
    print(f"✅ 產生 {made} 章（略過已存在 {skipped} 章），請確認的字共 {flags} 處 → {args.out}")


if __name__ == "__main__":
    main()
