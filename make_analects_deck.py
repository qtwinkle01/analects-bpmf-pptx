#!/usr/bin/env python3
"""
make_analects_deck.py — 論語教學簡報產生器 v2
================================================
基於 make_analects_pptx.py 的 harfbuzz+freetype 渲染管線，新增：

1. 破音字精簡語法（不需展開 characters 清單）：
     [字:1] → ss01（第 2 讀音）   例：[好:1] = ㄏㄠˋ
     [字:2] → ss02（第 3 讀音）   例：[弟:2] = ㄊㄧˋ
     [字|ㄩㄝˋ] → 字型沒收的讀音，手動合成注音
2. 拼音無底線、逐字置中對齊在漢字正下方
3. 版面設計：紙色背景、章節標籤、分隔線、頁尾頁碼、生詞卡片

YAML 格式（v2）：
    slides:
      - type: title | content | vocab | end
        （見 examples/學而1.1-1.3_v2.yaml）

用法：
    python make_analects_deck.py --config examples/學而1.1-1.3_v2.yaml
"""

import argparse
import io
import re
import sys
import tempfile
import zipfile
from pathlib import Path

import freetype
import uharfbuzz as hb
import yaml
from PIL import Image

SCRIPT_DIR = Path(__file__).parent
TEMPLATE_PPTX = SCRIPT_DIR / "template.pptx"
FONTS_DIR = SCRIPT_DIR / "fonts"

NS = (
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
)


def _esc(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))


def find_bpmf_font() -> Path:
    for name in ["BpmfZihiKaiStd-Regular.ttf", "BpmfIansui-Regular.ttf",
                 "BpmfZihiSerif-Regular.ttf", "BpmfZihiSans-Regular.ttf"]:
        p = FONTS_DIR / name
        if p.exists():
            return p
    raise FileNotFoundError(f"找不到 BPMFVs 注音字型，請放到 {FONTS_DIR}/")


def _patch_presentation(tmp: Path, n_slides: int) -> None:
    prs_path = tmp / "ppt" / "presentation.xml"
    content = prs_path.read_text(encoding="utf-8")
    sld_ids = "".join(f'<p:sldId id="{256+i}" r:id="rId{6+i}"/>'
                      for i in range(n_slides))
    content = re.sub(r"<p:sldIdLst>.*?</p:sldIdLst>",
                     f"<p:sldIdLst>{sld_ids}</p:sldIdLst>",
                     content, flags=re.DOTALL)
    prs_path.write_text(content, encoding="utf-8")
    rels_path = tmp / "ppt" / "_rels" / "presentation.xml.rels"
    slide_rels = "".join(
        f'<Relationship Id="rId{6+i}" '
        f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" '
        f'Target="slides/slide{i+1}.xml"/>'
        for i in range(n_slides))
    rels_path.write_text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme2.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>'
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
        '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>'
        f"{slide_rels}"
        "</Relationships>", encoding="utf-8")

# ── 版面常數 ─────────────────────────────────
SLIDE_CX, SLIDE_CY = 9144000, 6858000
X_MARGIN = 168165
AVAIL = SLIDE_CX - X_MARGIN * 2
IMG_DPI = 120
F_MAIN = 100          # 主要漢字 px 大小

# ── 色彩 ─────────────────────────────────────
C_PAPER   = "FBF6EE"
C_INK     = (38, 34, 32)
C_RED     = (156, 54, 38)
C_RED_HEX = "9C3626"
C_PINYIN  = "7A6A55"
C_ENGLISH = "2F5D7C"
C_LINE    = "D9C9AD"
C_FOOT    = "9C8F7C"
C_CARD    = "F4ECDD"

TONES = "ˊˇˋ˙"
RE_MARK = re.compile(r"\[(.)(?::(\d)|\|([^\]]+))\]")


def px_to_emu(px: float) -> int:
    return int(px / IMG_DPI * 914400)


def _is_han(ch: str) -> bool:
    return "一" <= ch <= "鿿"


# ─────────────────────────────────────────────
# 文字解析：把 "不亦[說|ㄩㄝˋ]乎？" 拆成 unit 清單
# ─────────────────────────────────────────────

def parse_zh(zh: str) -> list[dict]:
    units, pos = [], 0
    for m in RE_MARK.finditer(zh):
        for ch in zh[pos:m.start()]:
            units.append({"ch": ch, "feat": None, "manual": None})
        ch, idx, manual = m.group(1), m.group(2), m.group(3)
        units.append({
            "ch": ch,
            "feat": f"ss{int(idx):02d}" if idx else None,
            "manual": manual,
        })
        pos = m.end()
    for ch in zh[pos:]:
        units.append({"ch": ch, "feat": None, "manual": None})
    return units


# ─────────────────────────────────────────────
# harfbuzz + freetype 渲染
# ─────────────────────────────────────────────

class Renderer:
    def __init__(self, font_path: Path):
        self.font_path = Path(font_path)
        data = self.font_path.read_bytes()
        self.hb_face = hb.Face(hb.Blob(data))
        self.ft = freetype.Face(str(font_path))
        self._cache = {}

    def _metrics(self, size: int):
        self.ft.set_pixel_sizes(0, size)
        asc = self.ft.size.ascender >> 6
        desc = self.ft.size.descender >> 6   # 負值
        return asc, desc

    def shape(self, text: str, size: int, feature: str | None):
        f = hb.Font(self.hb_face)
        f.scale = (size * 64, size * 64)
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(f, buf, {feature: True} if feature else {})
        return list(zip(buf.glyph_infos, buf.glyph_positions))

    def draw_glyphs(self, canvas, pen_x, baseline, glyphs, size, fg):
        """把 shaped glyphs 畫到 RGBA canvas，回傳新 pen_x"""
        self.ft.set_pixel_sizes(0, size)
        for info, pos in glyphs:
            gid = info.codepoint
            self.ft.load_glyph(gid, freetype.FT_LOAD_RENDER)
            g = self.ft.glyph
            bmp = g.bitmap
            if bmp.width and bmp.rows:
                if bmp.pitch == bmp.width:
                    mask = Image.frombytes("L", (bmp.width, bmp.rows), bytes(bmp.buffer))
                else:
                    rows = [bytes(bmp.buffer[r*bmp.pitch:r*bmp.pitch+bmp.width])
                            for r in range(bmp.rows)]
                    mask = Image.frombytes("L", (bmp.width, bmp.rows), b"".join(rows))
                ink = Image.new("RGBA", mask.size, fg + (255,))
                x = int(pen_x + pos.x_offset / 64) + g.bitmap_left
                y = baseline - g.bitmap_top - int(pos.y_offset / 64)
                canvas.paste(ink, (x, y), mask)
            pen_x += pos.x_advance / 64
        return pen_x

    def draw_manual_zhuyin(self, canvas, x_col, baseline, F, ann, fg):
        """手動合成注音直行（位置實測校準自原生注音欄）"""
        tone = ann[-1] if ann[-1] in TONES else None
        syms = ann[:-1] if tone else ann
        s = int(F * 0.26)
        cells = []
        for c in syms + (tone or ""):
            glyphs = self.shape(c, s, None)
            tmp = Image.new("RGBA", (s * 2, s * 2), (0, 0, 0, 0))
            self.ft.set_pixel_sizes(0, s)
            self.draw_glyphs(tmp, 0, int(s * 1.0), glyphs, s, fg)
            bb = tmp.getbbox()
            cells.append(tmp.crop(bb) if bb else tmp)
        sym_imgs = cells[:len(syms)]
        tone_img = cells[len(syms)] if tone else None
        top = baseline - int(F * 0.64)
        bottom = baseline - int(F * 0.04)
        n = len(sym_imgs)
        gap = max(((bottom - top) - sum(im.height for im in sym_imgs)) // max(n, 1)
                  if n > 1 else 0, int(F * 0.03))
        total = sum(im.height for im in sym_imgs) + gap * (n - 1)
        y = top + (bottom - top - total) // 2
        max_w, centers = 0, []
        for im in sym_imgs:
            canvas.paste(im, (x_col, y), im)
            max_w = max(max_w, im.width)
            centers.append(y + im.height // 2)
            y += im.height + gap
        if tone_img:
            tx = x_col + max_w + int(F * 0.02)
            ty = centers[-1] - tone_img.height
            canvas.paste(tone_img, (tx, ty), tone_img)

    def render_line(self, units: list[dict], size: int = F_MAIN,
                    fg: tuple = C_INK):
        """渲染一行字，回傳 (RGBA img, han 字中心 x px 清單, baseline_in_img)"""
        asc, desc = self._metrics(size)
        H = asc - desc + 16
        # 先量寬度
        widths = []
        for u in units:
            text = u["ch"] + ("\U000E01E0" if u["manual"] else "")
            glyphs = self.shape(text, size, u["feat"])
            widths.append(sum(p.x_advance / 64 for _, p in glyphs))
        W = int(sum(widths)) + 16
        canvas = Image.new("RGBA", (max(W, 1), H), (0, 0, 0, 0))
        baseline = 8 + asc
        pen_x = 8.0
        centers = []
        for u, w in zip(units, widths):
            text = u["ch"] + ("\U000E01E0" if u["manual"] else "")
            glyphs = self.shape(text, size, u["feat"])
            self.draw_glyphs(canvas, pen_x, baseline, glyphs, size, fg)
            if u["manual"]:
                self.draw_manual_zhuyin(canvas, int(pen_x + size * 1.02),
                                        baseline, size, u["manual"], fg)
            if _is_han(u["ch"]):
                centers.append(pen_x + size * 0.5)
            pen_x += w
        bb = canvas.getbbox()
        if bb:
            top = max(bb[1] - 8, 0)
            bot = min(bb[3] + 8, canvas.height)
            canvas = canvas.crop((0, top, canvas.width, bot))
        return canvas, centers, canvas.width


# ─────────────────────────────────────────────
# XML 輔助
# ─────────────────────────────────────────────

def xml_rect(sid, x, y, cx, cy, fill=None, line=None, prst="rect"):
    fill_xml = (f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>'
                if fill else '<a:noFill/>')
    line_xml = (f'<a:ln w="9525"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>'
                if line else '<a:ln><a:noFill/></a:ln>')
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="rect{sid}"/>'
        f'<p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'<a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>'
        f'{fill_xml}{line_xml}</p:spPr>'
        f'<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>'
    )


def xml_run(text, sz, color, bold=False, italic=False, font="Calibri",
            ea_font="Microsoft JhengHei"):
    b = ' b="1"' if bold else ''
    i = ' i="1"' if italic else ''
    return (
        f'<a:r><a:rPr lang="en-US" sz="{sz}"{b}{i} u="none">'
        f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
        f'<a:latin typeface="{font}"/><a:ea typeface="{ea_font}"/>'
        f'<a:cs typeface="{font}"/></a:rPr>'
        f'<a:t>{_esc(text)}</a:t></a:r>'
    )


def xml_textbox(sid, x, y, cx, cy, runs, algn="l", wrap="square",
                anchor="t"):
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="txt{sid}"/>'
        f'<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f'<a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>'
        f'<p:txBody>'
        f'<a:bodyPr anchor="{anchor}" wrap="{wrap}" lIns="0" rIns="0" tIns="0" bIns="0"/>'
        f'<a:lstStyle/>'
        f'<a:p><a:pPr algn="{algn}"><a:buNone/></a:pPr>{runs}</a:p>'
        f'</p:txBody></p:sp>'
    )


def xml_pic(sid, rid, x, y, cx, cy):
    return (
        f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="img{sid}"/>'
        f'<p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr>'
        f'<p:blipFill rotWithShape="1"><a:blip r:embed="{rid}"><a:alphaModFix/></a:blip>'
        f'<a:srcRect b="0" l="0" r="0" t="0"/><a:stretch/></p:blipFill>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f'<a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:pic>'
    )


# ─────────────────────────────────────────────
# 投影片組裝
# ─────────────────────────────────────────────

class Slide:
    def __init__(self, renderer: Renderer):
        self.r = renderer
        self.shapes = []
        self.media = {}
        self.rels = []
        self._sid = 2
        self._rid = 3
        self._img_n = 0

    def sid(self):
        self._sid += 1
        return self._sid

    def add_image(self, img: Image.Image, x_emu, y_emu, max_w=AVAIL):
        buf = io.BytesIO()
        img.save(buf, format="PNG", dpi=(IMG_DPI, IMG_DPI))
        w_emu, h_emu = px_to_emu(img.width), px_to_emu(img.height)
        scale = 1.0
        if w_emu > max_w:
            scale = max_w / w_emu
            w_emu = max_w
            h_emu = int(h_emu * scale)
        self._img_n += 1
        fname = f"img_{self._img_n}.png"
        self.media[fname] = buf.getvalue()
        rid = f"rId{self._rid}"
        self._rid += 1
        self.rels.append((rid, fname))
        self.shapes.append(xml_pic(self.sid(), rid, x_emu, y_emu, w_emu, h_emu))
        return w_emu, h_emu, scale

    def bg(self):
        self.shapes.append(xml_rect(self.sid(), 0, 0, SLIDE_CX, SLIDE_CY,
                                    fill=C_PAPER))

    def tag(self, text):
        self.shapes.append(xml_textbox(
            self.sid(), SLIDE_CX - 4600000 - X_MARGIN, 170000, 4600000, 330000,
            xml_run(text, 1400, C_RED_HEX, bold=True), algn="r"))
        self.shapes.append(xml_rect(self.sid(), X_MARGIN, 560000, AVAIL, 15000,
                                    fill=C_LINE))

    def footer(self, label, idx, total):
        self.shapes.append(xml_textbox(
            self.sid(), X_MARGIN, SLIDE_CY - 300000, 5000000, 260000,
            xml_run(label, 1000, C_FOOT)))
        self.shapes.append(xml_textbox(
            self.sid(), SLIDE_CX - 2000000 - X_MARGIN, SLIDE_CY - 300000,
            2000000, 260000,
            xml_run(f"{idx} / {total}", 1000, C_FOOT), algn="r"))

    def pinyin_tokens(self, py: str, centers_px, x_img_emu, scale, y_emu,
                      sz=2200):
        toks = py.split()
        if len(toks) != len(centers_px):
            raise ValueError(
                f"拼音音節數 ({len(toks)}) 與漢字數 ({len(centers_px)}) 不符：{py}")
        for tok, cx_px in zip(toks, centers_px):
            c_emu = x_img_emu + int(px_to_emu(cx_px) * scale)
            self.shapes.append(xml_textbox(
                self.sid(), c_emu - 700000, y_emu, 1400000, 400000,
                xml_run(tok, sz, C_PINYIN), algn="ctr", wrap="none"))

    def text_line(self, text, x, y, w, sz, color, algn="l", bold=False,
                  h=430000, wrap="square"):
        self.shapes.append(xml_textbox(self.sid(), x, y, w, h,
                                       xml_run(text, sz, color, bold=bold),
                                       algn=algn, wrap=wrap))

    def block(self, zh, py, en, y, fg=C_INK, size=F_MAIN, compact=False):
        """課文區塊：漢字圖 + 對齊拼音 + 英文，回傳下一個 y"""
        img, centers, _ = self.r.render_line(parse_zh(zh), size, fg)
        w_emu, h_emu, scale = self.add_image(img, X_MARGIN, y)
        y_py = y + h_emu + 40000
        if py:
            self.pinyin_tokens(py, centers, X_MARGIN, scale, y_py)
            y_en = y_py + 430000
        else:
            y_en = y_py
        if en:
            self.text_line(en, X_MARGIN + 20000, y_en, AVAIL - 40000,
                           2300, C_ENGLISH, h=700000)
            y_next = y_en + (430000 if compact else 500000)
        else:
            y_next = y_en
        return y_next + (60000 if compact else 130000)

    def centered_block(self, zh, py, en, y, fg=C_INK, size=F_MAIN,
                       py_sz=2600, en_sz=2400):
        img, _, _ = self.r.render_line(parse_zh(zh), size, fg)
        w_emu, h_emu, _ = self.add_image(
            img, (SLIDE_CX - min(px_to_emu(img.width), AVAIL)) // 2, y)
        yy = y + h_emu + 60000
        if py:
            self.text_line(py, 0, yy, SLIDE_CX, py_sz, C_PINYIN, algn="ctr")
            yy += 480000
        if en:
            self.text_line(en, 400000, yy, SLIDE_CX - 800000, en_sz,
                           C_ENGLISH, algn="ctr", h=600000)
            yy += 520000
        return yy

    def build_xml(self):
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<p:sld {NS}>'
            '<p:cSld><p:spTree>'
            '<p:nvGrpSpPr><p:cNvPr id="1" name="Shape 1"/>'
            '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
            '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            + "".join(self.shapes) +
            '</p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
        )

    def build_rels_xml(self, slide_index):
        rels = (
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" '
            'Target="../slideLayouts/slideLayout1.xml"/>'
            '<Relationship Id="rId2" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" '
            'Target="../notesSlides/notesSlide1.xml"/>'
        )
        for rid, fname in self.rels:
            rels += (
                f'<Relationship Id="{rid}" '
                f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
                f'Target="../media/s{slide_index}_{fname}"/>'
            )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'{rels}</Relationships>'
        )


# ─────────────────────────────────────────────
# 各類投影片
# ─────────────────────────────────────────────

def make_title(s: Slide, cfg):
    s.bg()
    s.shapes.append(xml_rect(s.sid(), (SLIDE_CX - 900000) // 2, 950000,
                             900000, 28000, fill=C_RED_HEX))
    y = s.centered_block(cfg["zh_main"], cfg.get("py_main", ""), "",
                         1250000, size=170, py_sz=3200)
    y = s.centered_block(cfg["zh_sub"], cfg.get("py_sub", ""), "",
                         y + 150000, size=100, py_sz=2600)
    if cfg.get("en"):
        s.text_line(cfg["en"], 400000, y + 150000, SLIDE_CX - 800000, 2400,
                    C_ENGLISH, algn="ctr")
    if cfg.get("note"):
        s.text_line(cfg["note"], 400000, y + 620000, SLIDE_CX - 800000, 1500,
                    C_FOOT, algn="ctr")
    s.shapes.append(xml_rect(s.sid(), (SLIDE_CX - 900000) // 2,
                             SLIDE_CY - 700000, 900000, 28000, fill=C_RED_HEX))


def make_content(s: Slide, cfg, label, idx, total):
    s.bg()
    s.tag(cfg.get("tag", ""))
    s.footer(label, idx, total)
    lines = cfg.get("lines", [])
    n_blocks = (1 if cfg.get("speaker") else 0) + len(lines)
    compact = n_blocks >= 3
    y = 700000
    sp = cfg.get("speaker")
    if sp:
        y = s.block(sp["zh"], sp.get("py", ""), sp.get("en", ""), y,
                    fg=C_INK, size=84, compact=compact)
    for ln in lines:
        y = s.block(ln["zh"], ln.get("py", ""), ln.get("en", ""), y,
                    compact=compact)
    if y > SLIDE_CY - 250000:
        print(f"⚠️  投影片 {idx} 內容可能超出頁面（y={y}）")


def make_vocab(s: Slide, cfg, label, idx, total):
    s.bg()
    s.tag(cfg.get("tag", ""))
    s.footer(label, idx, total)
    # 標題「生詞」
    img, centers, _ = s.r.render_line(parse_zh("生詞"), 80, C_RED)
    w_emu, h_emu, scale = s.add_image(img, X_MARGIN, 750000)
    s.pinyin_tokens("shēng cí", centers, X_MARGIN, scale,
                    750000 + h_emu + 40000)
    s.text_line("Key Words · " + cfg.get("tag", "").split("·")[-1].strip(),
                X_MARGIN + w_emu + 250000, 900000, 4500000, 1800, C_FOOT)
    # 卡片
    words = cfg.get("words", [])[:3]
    n = len(words)
    gap = 200000
    cw = (AVAIL - gap * (n - 1)) // n if n else AVAIL
    ch_card = 3050000
    cy0 = 2850000
    for i, wd in enumerate(words):
        cx0 = X_MARGIN + i * (cw + gap)
        s.shapes.append(xml_rect(s.sid(), cx0, cy0, cw, ch_card,
                                 fill=C_CARD, line=C_LINE, prst="roundRect"))
        img, _, _ = s.r.render_line(parse_zh(wd["zh"]), 95, C_INK)
        w_emu = min(px_to_emu(img.width), cw - 300000)
        iw, ih, _ = s.add_image(img, cx0 + (cw - w_emu) // 2, cy0 + 350000,
                                max_w=cw - 300000)
        s.text_line(wd.get("py", ""), cx0, cy0 + 350000 + ih + 100000, cw,
                    2400, C_PINYIN, algn="ctr")
        s.text_line(wd.get("en", ""), cx0 + 150000,
                    cy0 + 350000 + ih + 560000, cw - 300000, 1700,
                    C_ENGLISH, algn="ctr", h=800000)


def make_end(s: Slide, cfg, label, idx, total):
    s.bg()
    s.footer(label, idx, total)
    s.shapes.append(xml_rect(s.sid(), (SLIDE_CX - 900000) // 2, 1500000,
                             900000, 28000, fill=C_RED_HEX))
    y = s.centered_block(cfg.get("zh", "謝謝！"), cfg.get("py", ""), "",
                         2000000, size=140, py_sz=3000)
    if cfg.get("en"):
        s.text_line(cfg["en"], 400000, y + 250000, SLIDE_CX - 800000, 2200,
                    C_ENGLISH, algn="ctr")


# ─────────────────────────────────────────────
# 打包
# ─────────────────────────────────────────────

def _patch_content_types(tmp: Path, n_slides: int) -> None:
    """範本只宣告原有張數的投影片；新增的必須補進 [Content_Types].xml，
    否則 PowerPoint 會顯示空白頁（LibreOffice 較寬鬆看不出來）。"""
    ct_path = tmp / "[Content_Types].xml"
    ct = ct_path.read_text(encoding="utf-8")
    ct = re.sub(r'<Override PartName="/ppt/slides/slide\d+\.xml"[^>]*/>', "", ct)
    overrides = "".join(
        f'<Override PartName="/ppt/slides/slide{i}.xml" '
        f'ContentType="application/vnd.openxmlformats-officedocument.'
        f'presentationml.slide+xml"/>'
        for i in range(1, n_slides + 1))
    ct = ct.replace("</Types>", overrides + "</Types>")
    ct_path.write_text(ct, encoding="utf-8")


def build(config, output_path: Path, font_path: Path):
    renderer = Renderer(font_path)
    slides_cfg = config["slides"]
    label = config.get("footer", "論語 · 學而篇 | The Analects · Book One")
    total = len(slides_cfg)
    slides = []
    for idx, cfg in enumerate(slides_cfg, 1):
        s = Slide(renderer)
        t = cfg.get("type", "content")
        if t == "title":
            make_title(s, cfg)
        elif t == "vocab":
            make_vocab(s, cfg, label, idx, total)
        elif t == "end":
            make_end(s, cfg, label, idx, total)
        else:
            make_content(s, cfg, label, idx, total)
        slides.append(s)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        with zipfile.ZipFile(TEMPLATE_PPTX, "r") as z:
            z.extractall(tmp)
        _patch_presentation(tmp, total)
        _patch_content_types(tmp, total)
        (tmp / "ppt" / "slides" / "_rels").mkdir(parents=True, exist_ok=True)
        (tmp / "ppt" / "media").mkdir(parents=True, exist_ok=True)
        for i, s in enumerate(slides, 1):
            (tmp / "ppt" / "slides" / f"slide{i}.xml").write_text(
                s.build_xml(), encoding="utf-8")
            (tmp / "ppt" / "slides" / "_rels" / f"slide{i}.xml.rels").write_text(
                s.build_rels_xml(i), encoding="utf-8")
            for fname, data in s.media.items():
                (tmp / "ppt" / "media" / f"s{i}_{fname}").write_bytes(data)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(tmp.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(tmp))
    print(f"✅ 已生成：{output_path}（{total} 張投影片）")


def main():
    ap = argparse.ArgumentParser(description="論語教學簡報產生器 v2")
    ap.add_argument("--config", "-c", type=Path, required=True)
    ap.add_argument("--output", "-o", type=Path)
    ap.add_argument("--font", "-f", type=Path)
    args = ap.parse_args()
    font_path = args.font or find_bpmf_font()
    print(f"📝 使用字型：{Path(font_path).name}")
    with open(args.config, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    output = args.output or args.config.with_suffix(".pptx")
    build(config, output, font_path)


if __name__ == "__main__":
    main()
