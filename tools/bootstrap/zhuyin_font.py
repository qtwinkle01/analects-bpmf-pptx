"""
zhuyin_font.py — 從 BPMFVs 字型「讀出」每個讀音字形上畫的注音，並轉成拼音
==========================================================================
字型只用 uni597D.ss01 這類名字區分讀音字形，沒有存讀音文字，所以用影像比對：
  1. 有注音的字形 − 純字字形（ss00）→ 只剩注音
  2. 連通區塊切割：最右邊、起點在直行中線右側的是聲調 ˊˇˋ（ˇ 常是兩筆，會合併試）；
     很小的圓點是輕聲 ˙；其餘上下重疊的筆劃歸同一個符號
  3. 每個符號與字型自己的注音符號比形狀；聲調模板取自已知讀音的字形
     （這套字型的 ˇ 畫成打勾狀，跟單獨的 ˇ 符號不同）
驗證：README 的 12 個破音字全對；學而篇 548 字與校對過的拼音逐字一致（只差資料錯的「辱」）。

    from zhuyin_font import FontZhuyin
    fz = FontZhuyin("fonts/BpmfZihiKaiStd-Regular.ttf")
    fz.zhuyin("好", 1)   # 'ㄏㄠˋ'（None = 預設字形）
    fz.pinyin("好", 1)   # 'hào'
    fz.variants("好")    # [1]

需要：pip install fonttools freetype-py numpy pillow pypinyin
"""
from collections import Counter, defaultdict, deque

import freetype
import numpy as np
from fontTools.ttLib import TTFont
from PIL import Image

S = 240                                           # 渲染大小（px）
SYMS = [chr(c) for c in range(0x3105, 0x312A)]    # ㄅ … ㄩ


def _zy2py():
    from pypinyin import Style
    from pypinyin.pinyin_dict import pinyin_dict
    from pypinyin.style import convert
    m = defaultdict(Counter)
    for v in pinyin_dict.values():
        for py in v.split(","):
            m[convert(py, Style.BOPOMOFO, True)][py] += 1
    return {zy: c.most_common(1)[0][0] for zy, c in m.items()}


def _norm(mask, n=28):
    ys, xs = np.nonzero(mask > 0.35)
    if len(ys) == 0:
        return None, 1.0
    m = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = m.shape
    side = max(h, w)
    sq = np.zeros((side, side), dtype=np.float32)
    sq[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = m
    img = Image.fromarray((sq * 255).astype(np.uint8)).resize((n, n), Image.BILINEAR)
    return np.asarray(img, dtype=np.float32) / 255.0, w / h


def _components(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        q, pts = deque([(y, x)]), []
        seen[y, x] = True
        while q:
            cy, cx = q.popleft()
            pts.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        ys, xs = zip(*pts)
        out.append({"y0": min(ys), "y1": max(ys) + 1, "x0": min(xs), "x1": max(xs) + 1, "n": len(pts), "pts": pts})
    return out


def _crop(res, group):
    y0 = min(c["y0"] for c in group); y1 = max(c["y1"] for c in group)
    x0 = min(c["x0"] for c in group); x1 = max(c["x1"] for c in group)
    m = np.zeros((y1 - y0, x1 - x0), dtype=np.float32)
    for c in group:
        for py, px in c["pts"]:
            m[py - y0, px - x0] = res[py, px]
    return m


class FontZhuyin:
    def __init__(self, font_path):
        self.tt = TTFont(font_path, lazy=True)
        self.cmap = self.tt.getBestCmap()
        self.face = freetype.Face(str(font_path))
        self.face.set_pixel_sizes(0, S)
        self.asc = self.face.size.ascender >> 6
        self.h = (self.face.size.ascender - self.face.size.descender) >> 6
        uvs = [t for t in self.tt["cmap"].tables if t.format == 14]
        self._variants = defaultdict(list)
        for sel, lst in (uvs[0].uvsDict.items() if uvs else []):
            if sel - 0xE01E0 >= 1:
                for u, _ in lst:
                    self._variants[chr(u)].append(sel - 0xE01E0)
        self._cache = {}
        self._zy2py = _zy2py()
        self.tpl = {}
        for ch in SYMS + ["˙"]:
            self.face.load_char(ch, freetype.FT_LOAD_RENDER)
            v = _norm(self._render(self.face.get_char_index(ch)))
            if v[0] is not None:
                self.tpl[ch] = v
        for t, ch in {"ˊ": "學", "ˇ": "好", "ˋ": "樂"}.items():   # 這三字預設讀音已知
            self.tpl[t] = _norm(self._rightmost(ch))

    def has(self, ch):
        return ord(ch) in self.cmap

    def variants(self, ch):
        return sorted(self._variants.get(ch, []))

    def _render(self, gid):
        self.face.load_glyph(gid, freetype.FT_LOAD_RENDER)
        g = self.face.glyph
        canvas = np.zeros((self.h + 4, max(int(g.advance.x / 64) + 4, 4)), dtype=np.float32)
        b = g.bitmap
        if b.width and b.rows:
            a = np.array(b.buffer, dtype=np.uint8).reshape(b.rows, b.pitch)[:, :b.width] / 255.0
            y0, x0 = self.asc - g.bitmap_top, g.bitmap_left
            ys, xs = max(y0, 0), max(x0, 0)
            ye, xe = min(y0 + b.rows, canvas.shape[0]), min(x0 + b.width, canvas.shape[1])
            canvas[ys:ye, xs:xe] = a[ys - y0:ye - y0, xs - x0:xe - x0]
        return canvas

    def _residual(self, ch, variant):
        base = f"uni{ord(ch):04X}"
        name = base if variant is None else f"{base}.ss{variant:02d}"
        full = self._render(self.tt.getGlyphID(name))
        plain = self._render(self.tt.getGlyphID(base + ".ss00"))
        w = min(full.shape[1], plain.shape[1])
        res = np.clip(full[:, :w] - plain[:, :w], 0, 1)
        res[:, : int(S * 0.95)] = 0
        return res

    def _rightmost(self, ch):
        res = self._residual(ch, None)
        comps = [c for c in _components(res > 0.5) if c["n"] >= 6]
        return _crop(res, [max(comps, key=lambda c: (c["x0"] + c["x1"]) / 2)])

    def _best(self, seg, pool):
        v, ar = _norm(seg)
        if v is None:
            return None, 0.0
        best = (0.0, None)
        for ch in pool:
            tv, tar = self.tpl[ch]
            corr = float((v * tv).sum() / (np.sqrt((v * v).sum() * (tv * tv).sum()) + 1e-6))
            best = max(best, (corr * (0.6 + 0.4 * min(ar, tar) / max(ar, tar)), ch))
        return best[1], best[0]

    def zhuyin(self, ch, variant=None):
        """字型上畫的注音；字型沒有這個字或字形時回傳 None"""
        key = (ch, variant)
        if key in self._cache:
            return self._cache[key]
        try:
            res = self._residual(ch, variant)
        except KeyError:
            self._cache[key] = None
            return None
        comps = [c for c in _components(res > 0.5) if c["n"] >= 6]
        tone = ""
        if len(comps) >= 2:
            cand = max(comps, key=lambda c: (c["x0"] + c["x1"]) / 2)
            rest = [c for c in comps if c is not cand]
            mid = np.median([(c["x0"] + c["x1"]) / 2 for c in rest])
            trials = [[cand]] + [[cand, c] for c in rest
                                 if c["x1"] >= cand["x0"] - S * 0.03 and c["x0"] > mid - S * 0.02
                                 and min(c["y1"], cand["y1"]) - max(c["y0"], cand["y0"]) > 0]
            best_t = None
            for grp in trials:
                t, ts = self._best(_crop(res, grp), ["ˊ", "ˇ", "ˋ"])
                _, ss = self._best(_crop(res, grp), SYMS)
                if cand["x0"] > mid and ts >= ss * 0.95 and (best_t is None or ts > best_t[1]):
                    best_t = (t, ts, grp)
            if best_t:
                tone = best_t[0]
                comps = [c for c in comps if all(c is not g for g in best_t[2])]
        comps.sort(key=lambda c: c["y0"])
        groups = []
        for c in comps:
            if groups:
                g = groups[-1]
                gy0, gy1 = min(x["y0"] for x in g), max(x["y1"] for x in g)
                if min(gy1, c["y1"]) - max(gy0, c["y0"]) > 0.3 * min(gy1 - gy0, c["y1"] - c["y0"]):
                    g.append(c)
                    continue
            groups.append([c])
        syms = []
        for g in groups:
            m = _crop(res, g)
            if m.shape[0] < S * 0.06 and m.shape[1] < S * 0.06:
                tone = tone or "˙"
                continue
            syms.append(self._best(m, SYMS)[0])
        zy = "".join(syms) + tone
        self._cache[key] = zy
        return zy

    def to_pinyin(self, zy):
        return self._zy2py.get(zy) if zy else None

    def pinyin(self, ch, variant=None):
        return self.to_pinyin(self.zhuyin(ch, variant))

    def valid(self, zy):
        """讀出來的注音是不是合法音節（讀錯時通常不合法）"""
        return zy in self._zy2py
