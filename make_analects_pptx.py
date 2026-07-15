#!/usr/bin/env python3
"""
make_analects_pptx.py（修正版）
================================
修正重點：
  - 移除錯誤的 HarfBuzz GSUB shaping（BPMFVs 不使用 calt/liga）
  - 改用 Pillow ImageFont 直接渲染（FreeType 正確處理 composite glyph）
  - BPMFVs 字型的注音已內嵌在字形中，直接渲染即可顯示
  - 保留 IVS 選擇子支援（U+E01E1 等）
"""

import argparse
import io
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except ImportError:
    sys.exit("❌ 請先安裝 Pillow：pip install pillow")

try:
    import yaml
except ImportError:
    sys.exit("❌ 請先安裝 PyYAML：pip install pyyaml")

try:
    import uharfbuzz as hb
except ImportError:
    sys.exit("❌ 請先安裝 uharfbuzz：pip install uharfbuzz")

try:
    import freetype
except ImportError:
    sys.exit("❌ 請先安裝 freetype-py：pip install freetype-py")

try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("❌ 請先安裝 fonttools：pip install fonttools")

# ─────────────────────────────────────────────
# 常數設定
# ─────────────────────────────────────────────

SCRIPT_DIR    = Path(__file__).parent
FONTS_DIR     = SCRIPT_DIR / "fonts"
TEMPLATE_PPTX = SCRIPT_DIR / "template.pptx"

BPMF_FONT_CANDIDATES = [
    "BpmfZihiKaiStd-Regular.ttf",
    "BpmfIansui-Regular.ttf",
    "BpmfZihiSerif-Regular.ttf",
    "BpmfZihiSans-Regular.ttf",
]

# 投影片尺寸（EMU）
SLIDE_CX        = 9144000
SLIDE_CY        = 6858000
X_MARGIN        = 168165
AVAILABLE_WIDTH = SLIDE_CX - X_MARGIN * 2

# 渲染參數
IMG_DPI         = 150
BPMF_FONT_SIZE  = 80   # pt
BPMF_CHAR_GAP   = 10   # px between rendered BPMF glyph images

# PPTX 文字大小
SZ_PINYIN  = 3200
SZ_ENGLISH = 2800

COLOR_PINYIN  = "dk1"
COLOR_ENGLISH = "dk2"

NS = (
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
)

# ─────────────────────────────────────────────
# 字型載入
# ─────────────────────────────────────────────

def find_bpmf_font() -> Path:
    for name in BPMF_FONT_CANDIDATES:
        p = FONTS_DIR / name
        if p.exists():
            return p
    for d in [
        Path("/usr/local/share/fonts"), Path("/usr/share/fonts"),
        Path.home() / ".fonts", Path.home() / "Library/Fonts",
        Path("C:/Windows/Fonts"),
    ]:
        for name in BPMF_FONT_CANDIDATES:
            p = d / name
            if p.exists():
                return p
    raise FileNotFoundError(
        "找不到 BPMFVs 注音字型！\n"
        f"請從 https://github.com/ButTaiwan/bpmfvs/releases 下載，\n"
        f"並將 .ttf 放到 {FONTS_DIR}/"
    )

# ─────────────────────────────────────────────
# 注音圖片渲染（修正版：直接用 Pillow FreeType）
# ─────────────────────────────────────────────

def px_to_emu(px: float, dpi: int = IMG_DPI) -> int:
    return int(px / dpi * 914400)


def _is_ivs_char(ch: str) -> bool:
    return '\U000E0100' <= ch <= '\U000E01EF'


def split_chars_with_ivs(text: str) -> list[str]:
    result = []
    i = 0
    while i < len(text):
        unit = text[i]
        i += 1
        while i < len(text) and _is_ivs_char(text[i]):
            unit += text[i]
            i += 1
        result.append(unit)
    return result


def render_single_unit(
    unit: str,
    font_path: Path,
    font_size: int,
    ss_feature: str | None = None,
    fg_color: tuple = (0, 0, 0),
    bg_color: tuple = (255, 255, 255),
) -> Image.Image:
    is_colon = unit in (":", "：")
    if is_colon:
        unit = "："
    font_bytes = Path(font_path).read_bytes()
    blob = hb.Blob(font_bytes)
    face = hb.Face(blob)
    hb_font = hb.Font(face)
    hb_font.scale = (font_size * 64, font_size * 64)

    buf = hb.Buffer()
    buf.add_str(unit)
    buf.guess_segment_properties()

    has_ivs = any(_is_ivs_char(ch) for ch in unit)
    features = {} if has_ivs else ({ss_feature: True} if ss_feature else {})
    hb.shape(hb_font, buf, features)

    if not buf.glyph_infos:
        return Image.new("RGB", (font_size // 2, font_size), bg_color)

    gid = buf.glyph_infos[0].codepoint
    face_ft = freetype.Face(str(font_path))
    face_ft.set_pixel_sizes(0, font_size)
    face_ft.load_glyph(gid, freetype.FT_LOAD_RENDER)

    bmp = face_ft.glyph.bitmap
    if bmp.width == 0 or bmp.rows == 0:
        advance = int(face_ft.glyph.advance.x / 64)
        width = max(advance, font_size // 4)
        return Image.new("RGB", (width, font_size), bg_color)

    glyph_img = Image.frombytes("L", (bmp.width, bmp.rows), bytes(bmp.buffer))
    img = Image.new("RGB", (bmp.width, bmp.rows), bg_color)
    color_img = Image.new("RGB", (bmp.width, bmp.rows), fg_color)
    img.paste(color_img, (0, 0), mask=glyph_img)
    if is_colon:
        target_width = max(font_size * 2 // 3, bmp.width + font_size // 2)
        padded = Image.new("RGB", (target_width, bmp.rows), bg_color)
        padded.paste(img, ((target_width - bmp.width) // 2, 0))
        return padded
    return img


def _compose_units(
    units_with_images: list[tuple[str, Image.Image]],
    bg_color: tuple = (255, 255, 255),
) -> tuple[Image.Image, list[dict]]:
    """橫向拼接各單位圖片，並回傳每個單位的 (unit, x_px, w_px) 資訊。"""
    total_w = sum(img.width for _, img in units_with_images)
    max_h = max((img.height for _, img in units_with_images), default=1)
    img = Image.new("RGB", (max(total_w, 1), max(max_h, 1)), bg_color)

    metrics = []
    x = 0
    for unit, glyph_img in units_with_images:
        y = max_h - glyph_img.height
        img.paste(glyph_img, (x, y))
        metrics.append({"unit": unit, "x_px": x, "w_px": glyph_img.width})
        x += glyph_img.width

    return img, metrics


def render_text(
    text: str,
    font_path: Path,
    font_size: int = BPMF_FONT_SIZE,
    ss_feature: str | None = None,
    fg_color: tuple = (0, 0, 0),
    bg_color: tuple = (255, 255, 255),
) -> Image.Image:
    """
    將整串文字逐單位渲染為 PIL Image。
    對含 IVS 的單元會先拆出字 + IVS，並逐一渲染後橫向拼接。
    """
    if not text:
        return Image.new("RGB", (1, 1), bg_color)

    units = split_chars_with_ivs(text)
    pairs = [
        (unit, render_single_unit(unit, font_path, font_size, ss_feature, fg_color, bg_color))
        for unit in units
    ]
    img, _ = _compose_units(pairs, bg_color)
    return img


def render_char(
    char: str,
    font_path: str,
    font_size: int,
    ss_feature: str | None = None,
    fg_color: tuple = (0, 0, 0),
    bg_color: tuple = (255, 255, 255),
) -> Image.Image:
    """
    回傳該字的 PIL Image，已套用指定的 ss feature。

    流程：uharfbuzz shaping → 取得 GID → freetype 渲染 bitmap → PIL Image
    """
    return render_text(char, Path(font_path), font_size, ss_feature, fg_color, bg_color)


def make_bpmf_image(text_or_chars, font_path: Path,
                    font_size: int = BPMF_FONT_SIZE) -> tuple:
    """
    使用 uharfbuzz + freetype 渲染 BPMFVs 字型。
    支援傳入單字串或文字清單，其中清單可指定 char 與 ss_feature。
    """
    if isinstance(text_or_chars, list):
        pairs = []
        for entry in text_or_chars:
            if not isinstance(entry, dict) or "char" not in entry:
                raise ValueError(
                    "characters 欄位必須是 dict 清單，且每個項目需包含 'char'。"
                )
            ss_feature_value = entry.get("ss_feature", entry.get("ss"))
            pairs.append((
                entry["char"],
                render_char(
                    entry["char"],
                    font_path,
                    font_size,
                    ss_feature=ss_feature_value,
                ),
            ))
        img, metrics = _compose_units(pairs)
    else:
        units = split_chars_with_ivs(text_or_chars)
        pairs = [
            (unit, render_single_unit(unit, font_path, font_size))
            for unit in units
        ]
        img, metrics = _compose_units(pairs)

    buf_out = io.BytesIO()
    img.save(buf_out, format="PNG", dpi=(IMG_DPI, IMG_DPI))
    png_bytes = buf_out.getvalue()

    w_emu = px_to_emu(img.width)
    h_emu = px_to_emu(img.height)
    if w_emu > AVAILABLE_WIDTH:
        scale_r = AVAILABLE_WIDTH / w_emu
        w_emu = AVAILABLE_WIDTH
        h_emu = int(h_emu * scale_r)

    return png_bytes, w_emu, h_emu, metrics, img.width

# ─────────────────────────────────────────────
# XML 片段生成
# ─────────────────────────────────────────────

def _esc(text: str) -> str:
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def xml_pic(shape_id, name, rid, x, y, cx, cy) -> str:
    return (
        f'<p:pic>'
        f'<p:nvPicPr>'
        f'<p:cNvPr id="{shape_id}" name="{name}"/>'
        f'<p:cNvPicPr preferRelativeResize="0"/>'
        f'<p:nvPr/>'
        f'</p:nvPicPr>'
        f'<p:blipFill rotWithShape="1">'
        f'<a:blip r:embed="{rid}"><a:alphaModFix/></a:blip>'
        f'<a:srcRect b="0" l="0" r="0" t="0"/>'
        f'<a:stretch/>'
        f'</p:blipFill>'
        f'<p:spPr>'
        f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f'<a:noFill/><a:ln><a:noFill/></a:ln>'
        f'</p:spPr>'
        f'</p:pic>'
    )


def xml_run(text, underline=False, sz=SZ_PINYIN, color=COLOR_PINYIN) -> str:
    u = 'u="sng"' if underline else 'u="none"'
    return (
        f'<a:r>'
        f'<a:rPr lang="en-US" sz="{sz}" {u}>'
        f'<a:solidFill><a:schemeClr val="{color}"/></a:solidFill>'
        f'<a:latin typeface="Calibri"/>'
        f'<a:ea typeface="Calibri"/>'
        f'<a:cs typeface="Calibri"/>'
        f'</a:rPr>'
        f'<a:t>{_esc(text)}</a:t>'
        f'</a:r>'
    )


def xml_textbox(shape_id, name, x, y, cx, cy, runs_xml, sz=SZ_PINYIN,
                algn="l", lins=91425, rins=91425, autofit=True,
                wrap="square") -> str:
    return (
        f'<p:sp>'
        f'<p:nvSpPr>'
        f'<p:cNvPr id="{shape_id}" name="{name}"/>'
        f'<p:cNvSpPr txBox="1"/>'
        f'<p:nvPr/>'
        f'</p:nvSpPr>'
        f'<p:spPr>'
        f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f'<a:noFill/><a:ln><a:noFill/></a:ln>'
        f'</p:spPr>'
        f'<p:txBody>'
        f'<a:bodyPr anchorCtr="0" anchor="t" bIns="45700" lIns="{lins}" '
        f'spcFirstLastPara="1" rIns="{rins}" wrap="{wrap}" tIns="45700">'
        f'{"<a:spAutoFit/>" if autofit else ""}'
        f'</a:bodyPr>'
        f'<a:lstStyle/>'
        f'<a:p>'
        f'<a:pPr indent="0" lvl="0" marL="0" marR="0" rtl="0" algn="{algn}">'
        f'<a:spcBef><a:spcPts val="0"/></a:spcBef>'
        f'<a:spcAft><a:spcPts val="0"/></a:spcAft>'
        f'<a:buNone/>'
        f'</a:pPr>'
        f'{runs_xml}'
        f'<a:endParaRPr sz="{sz}">'
        f'<a:solidFill><a:schemeClr val="{COLOR_PINYIN}"/></a:solidFill>'
        f'<a:latin typeface="Calibri"/>'
        f'<a:ea typeface="Calibri"/>'
        f'<a:cs typeface="Calibri"/>'
        f'</a:endParaRPr>'
        f'</a:p>'
        f'</p:txBody>'
        f'</p:sp>'
    )


def _is_han(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x3400 <= cp <= 0x4DBF or
        0x4E00 <= cp <= 0x9FFF or
        0xF900 <= cp <= 0xFAFF or
        0x20000 <= cp <= 0x3FFFF
    )


def pinyin_tokens(pinyin_list) -> list[tuple[str, bool]]:
    """把 pinyin 設定攤平成 (token, underline) 清單，音節以空白切開。"""
    if isinstance(pinyin_list, str):
        return [(tok, True) for tok in pinyin_list.split()]
    tokens = []
    for item in pinyin_list:
        if isinstance(item, dict):
            if "underline" in item:
                tokens += [(tok, True) for tok in item["underline"].split()]
            elif "plain" in item:
                tokens += [(tok, False) for tok in item["plain"].split()]
        elif isinstance(item, str):
            tokens += [(tok, True) for tok in item.split()]
    return tokens


def est_token_width_emu(tok: str, sz: int = SZ_PINYIN) -> int:
    """粗估 token 在 Calibri 字型下的寬度（EMU），用於避免音節互相重疊。"""
    em = sz * 127  # sz 單位為 1/100 pt；1pt = 12700 EMU
    w = 0.0
    for ch in tok:
        c = ch.lower()
        if c in "ijl'’ìíǐīĭ":
            w += 0.28
        elif c in "mw":
            w += 0.82
        elif c in "ftr":
            w += 0.38
        elif c in "?:,.\";!":
            w += 0.30
        elif ch.isupper():
            w += 0.62
        else:
            w += 0.52
    return int(w * em)


def map_tokens_to_units(tokens, metrics):
    """
    將拼音 token 對應到中文字單位。
    - 漢字單位依序吃 underline（音節）token
    - 標點單位（非開頭）依序吃 plain token
    回傳 [(token, underline, unit_metric), ...]；音節數與漢字數不符時回傳 None。
    """
    syllables = [t for t in tokens if t[1]]
    plains = [t for t in tokens if not t[1]]
    han_units = [m for m in metrics if _is_han(m["unit"][0])]
    if len(syllables) != len(han_units):
        return None

    mapping = []
    si = pi = 0
    started = False
    for m in metrics:
        if _is_han(m["unit"][0]):
            tok, ul = syllables[si]
            si += 1
            started = True
            mapping.append((tok, ul, m))
        elif started and pi < len(plains):
            tok, ul = plains[pi]
            pi += 1
            mapping.append((tok, ul, m))
    return mapping


def build_pinyin_runs(pinyin_list) -> str:
    if isinstance(pinyin_list, str):
        return xml_run(pinyin_list, underline=True)
    runs = ""
    for item in pinyin_list:
        if isinstance(item, dict):
            if "underline" in item:
                runs += xml_run(item["underline"], underline=True)
            elif "plain" in item:
                runs += xml_run(item["plain"], underline=False)
        elif isinstance(item, str):
            runs += xml_run(item, underline=True)
    return runs


def build_english_runs(english: str) -> str:
    return xml_run(english, underline=False, sz=SZ_ENGLISH, color=COLOR_ENGLISH)

# ─────────────────────────────────────────────
# 投影片組裝
# ─────────────────────────────────────────────

class SlideBuilder:
    def __init__(self, font_path: Path):
        self.font_path    = font_path
        self._shapes      = []
        self._media       = {}
        self._rels        = []
        self._shape_id    = 2
        self._rid_counter = 3
        self._img_counter = 0

    def _next_id(self):
        sid = self._shape_id
        self._shape_id += 1
        return sid

    def _next_rid(self):
        rid = f"rId{self._rid_counter}"
        self._rid_counter += 1
        return rid

    def _add_image(self, png_bytes: bytes, name: str):
        self._img_counter += 1
        fname = f"{name}_{self._img_counter}.png"
        self._media[fname] = png_bytes
        rid = self._next_rid()
        self._rels.append((rid, fname))   # ← 只存檔名，前綴在 build_pptx 加
        # 重新量測圖片尺寸
        img = Image.open(io.BytesIO(png_bytes))
        w_px, h_px = img.size
        w_emu = px_to_emu(w_px)
        h_emu = px_to_emu(h_px)
        if w_emu > AVAILABLE_WIDTH:
            s = AVAILABLE_WIDTH / w_emu
            w_emu = AVAILABLE_WIDTH
            h_emu = int(h_emu * s)
        return rid, w_emu, h_emu

    def add_bpmf_block(self, text_or_chars, pinyin_list, english,
                       y_start, gap_img_pinyin=80000,
                       gap_pinyin_english=580000) -> int:
        # 1. 注音圖片
        png_bytes, _, _, metrics, img_w_px = make_bpmf_image(
            text_or_chars, self.font_path)
        rid, w_emu, h_emu = self._add_image(png_bytes, "bpmf")
        self._shapes.append(xml_pic(
            self._next_id(), f"bpmf_img_{self._shape_id}",
            rid, X_MARGIN, y_start, w_emu, h_emu
        ))
        y_pinyin = y_start + h_emu + gap_img_pinyin

        # 2. 拼音：每個音節各自置中對齊在對應中文字下方
        mapping = None
        if pinyin_list:
            tokens = pinyin_tokens(pinyin_list)
            mapping = map_tokens_to_units(tokens, metrics)

        if mapping:
            emu_per_px = w_emu / max(img_w_px, 1)
            GAP = 100000  # 音節之間的最小間距
            prev_end = None
            for tok, ul, m in mapping:
                center = X_MARGIN + int((m["x_px"] + m["w_px"] / 2) * emu_per_px)
                tok_w = est_token_width_emu(tok)
                x = center - tok_w // 2
                if prev_end is not None and x < prev_end + GAP:
                    x = prev_end + GAP  # 避免與前一個音節重疊
                x = max(x, 0)
                prev_end = x + tok_w
                self._shapes.append(xml_textbox(
                    self._next_id(), f"pinyin_{self._shape_id}",
                    x, y_pinyin, tok_w + 300000, 584775,
                    xml_run(tok, underline=ul), sz=SZ_PINYIN,
                    algn="l", lins=0, rins=0, wrap="none"
                ))
        elif pinyin_list:
            # 音節數與漢字數不符 → 退回整行拼音
            runs = build_pinyin_runs(pinyin_list)
            self._shapes.append(xml_textbox(
                self._next_id(), f"pinyin_{self._shape_id}",
                X_MARGIN, y_pinyin, AVAILABLE_WIDTH, 584775,
                runs, sz=SZ_PINYIN
            ))
        y_english = y_pinyin + gap_pinyin_english

        # 3. 英文
        eng_runs = build_english_runs(english)
        self._shapes.append(xml_textbox(
            self._next_id(), f"english_{self._shape_id}",
            X_MARGIN, y_english, AVAILABLE_WIDTH, 900000,
            eng_runs, sz=SZ_ENGLISH
        ))
        return y_english + 900000

    def build_xml(self) -> str:
        shapes_xml = "".join(self._shapes)
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<p:sld {NS}>'
            '<p:cSld><p:spTree>'
            '<p:nvGrpSpPr>'
            '<p:cNvPr id="1" name="Shape 1"/>'
            '<p:cNvGrpSpPr/><p:nvPr/>'
            '</p:nvGrpSpPr>'
            '<p:grpSpPr><a:xfrm>'
            '<a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
            '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/>'
            '</a:xfrm></p:grpSpPr>'
            f'{shapes_xml}'
            '</p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
            '</p:sld>'
        )

    def build_rels_xml(self, slide_index: int) -> str:
        """slide_index: 1-based，用來產生正確的 media 路徑前綴"""
        rels = (
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" '
            'Target="../slideLayouts/slideLayout1.xml"/>'
            '<Relationship Id="rId2" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" '
            'Target="../notesSlides/notesSlide1.xml"/>'
        )
        for rid, fname in self._rels:
            # 加入 slide index 前綴，避免多張投影片的圖片檔名衝突
            prefixed = f"s{slide_index}_{fname}"
            rels += (
                f'<Relationship Id="{rid}" '
                f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
                f'Target="../media/{prefixed}"/>'
            )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'{rels}'
            '</Relationships>'
        )

# ─────────────────────────────────────────────
# PPTX 打包
# ─────────────────────────────────────────────

def build_pptx(config: dict, output_path: Path, font_path: Path) -> None:
    if not TEMPLATE_PPTX.exists():
        raise FileNotFoundError(f"找不到範本：{TEMPLATE_PPTX}")

    slides_data = config.get("slides", [])
    if not slides_data:
        raise ValueError("設定檔中沒有 slides 資料！")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        with zipfile.ZipFile(TEMPLATE_PPTX, "r") as z:
            z.extractall(tmp)

        slide_results = []
        for slide_cfg in slides_data:
            builder = SlideBuilder(font_path)
            y = 350000

            speaker_spec = slide_cfg.get("speaker_characters") or slide_cfg.get("speaker", "")
            if speaker_spec:
                y = builder.add_bpmf_block(
                    speaker_spec,
                    slide_cfg.get("speaker_pinyin", speaker_spec if isinstance(speaker_spec, str) else ""),
                    slide_cfg.get("speaker_english", ""),
                    y_start=y, gap_pinyin_english=580000
                )
                y += 150000

            for sent in slide_cfg.get("sentences", []):
                text_spec = sent.get("characters") or sent.get("chinese", "")
                if text_spec:
                    y = builder.add_bpmf_block(
                        text_spec,
                        sent.get("pinyin", ""),
                        sent.get("english", ""),
                        y_start=y, gap_pinyin_english=580000
                    )
                    y += 100000

            slide_results.append(builder)

        _patch_presentation(tmp, len(slide_results))

        (tmp / "ppt" / "slides").mkdir(parents=True, exist_ok=True)
        (tmp / "ppt" / "slides" / "_rels").mkdir(parents=True, exist_ok=True)
        (tmp / "ppt" / "media").mkdir(parents=True, exist_ok=True)

        for i, builder in enumerate(slide_results, start=1):
            slide_path = tmp / "ppt" / "slides" / f"slide{i}.xml"
            rels_path  = tmp / "ppt" / "slides" / "_rels" / f"slide{i}.xml.rels"

            slide_path.write_text(builder.build_xml(), encoding="utf-8")
            rels_path.write_text(builder.build_rels_xml(i), encoding="utf-8")

            # 寫入媒體檔案（加 s{i}_ 前綴）
            for fname, data in builder._media.items():
                media_file = tmp / "ppt" / "media" / f"s{i}_{fname}"
                media_file.write_bytes(data)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(tmp.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(tmp))

    print(f"✅ 已生成：{output_path}")


def _patch_presentation(tmp: Path, n_slides: int) -> None:
    prs_path = tmp / "ppt" / "presentation.xml"
    content  = prs_path.read_text(encoding="utf-8")
    sld_ids  = "".join(
        f'<p:sldId id="{256 + i}" r:id="rId{6 + i}"/>'
        for i in range(n_slides)
    )
    content = re.sub(
        r"<p:sldIdLst>.*?</p:sldIdLst>",
        f"<p:sldIdLst>{sld_ids}</p:sldIdLst>",
        content, flags=re.DOTALL
    )
    prs_path.write_text(content, encoding="utf-8")

    rels_path  = tmp / "ppt" / "_rels" / "presentation.xml.rels"
    slide_rels = "".join(
        f'<Relationship Id="rId{6 + i}" '
        f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" '
        f'Target="slides/slide{i + 1}.xml"/>'
        for i in range(n_slides)
    )
    rels_path.write_text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme2.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>'
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
        '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>'
        f'{slide_rels}'
        '</Relationships>',
        encoding="utf-8"
    )

# ─────────────────────────────────────────────
# 內建示範資料
# ─────────────────────────────────────────────

DEMO_CONFIGS = {
    "1.4": {
        "title": "學而 1.4",
        "slides": [
            {
                "speaker": "曾\U000E01E1子曰：",
                "speaker_pinyin": [
                    {"underline": "Céng  zǐ   yuē"},
                    {"plain": "   :"},
                ],
                "speaker_english": "Zeng Zi said,",
                "sentences": [
                    {
                        "chinese": "「吾日三省吾身：",
                        "pinyin": [
                            {"underline": "Wú   rì   sān   xǐng   wú   shēn"},
                            {"plain": "   :"},
                        ],
                        "english": '"I daily examine myself on three points:',
                    },
                    {
                        "chinese": "為人謀而不忠乎？",
                        "pinyin": [
                            {"underline": "Wèi   rén   móu   ér   bù   zhōng   hū"},
                            {"plain": "   ?"},
                        ],
                        "english": "whether, in transacting business for others, I may have been not faithful;",
                    },
                ],
            },
            {
                "sentences": [
                    {
                        "chinese": "與朋友交而不信乎？",
                        "pinyin": [
                            {"underline": "Yǔ   péng   yǒu   jiāo   ér   bù   xìn   hū"},
                            {"plain": "   ?"},
                        ],
                        "english": "whether, in intercourse with friends, I may have been not sincere;",
                    },
                    {
                        "chinese": "傳不習乎？」",
                        "pinyin": [
                            {"underline": "Chuán   bù   xí   hū"},
                            {"plain": '   ?"'},
                        ],
                        "english": 'whether I may have not mastered and practiced the instructions of my teacher."',
                    },
                ],
            },
        ],
    },
    "1.5": {
        "title": "學而 1.5",
        "slides": [
            {
                "speaker": "子曰：",
                "speaker_pinyin": [
                    {"underline": "Zǐ   yuē"},
                    {"plain": "   :"},
                ],
                "speaker_english": "The Master said,",
                "sentences": [
                    {
                        "chinese": "「道千乘之國，",
                        "pinyin": [
                            {"underline": "Dào   qiān   shèng   zhī   guó"},
                            {"plain": "   ,"},
                        ],
                        "english": '"In guiding a state of a thousand chariots,',
                    },
                    {
                        "chinese": "敬事而信，",
                        "pinyin": [
                            {"underline": "Jìng   shì   ér   xìn"},
                            {"plain": "   ,"},
                        ],
                        "english": "approach every matter with reverence and faithfulness;",
                    },
                ],
            },
            {
                "sentences": [
                    {
                        "chinese": "節用而愛人，",
                        "pinyin": [
                            {"underline": "Jié   yòng   ér   ài   rén"},
                            {"plain": "   ,"},
                        ],
                        "english": "be economical in expenditure and love the people;",
                    },
                    {
                        "chinese": "使民以時。」",
                        "pinyin": [
                            {"underline": "Shǐ   mín   yǐ   shí"},
                            {"plain": '   ."'},
                        ],
                        "english": 'and employ the people only at the proper seasons."',
                    },
                ],
            },
        ],
    },
}

# ─────────────────────────────────────────────
# CLI 入口
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="論語投影片生成工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--config", "-c", type=Path, help="YAML 設定檔路徑")
    parser.add_argument("--output", "-o", type=Path, help="輸出 PPTX 路徑")
    parser.add_argument("--font",   "-f", type=Path, help="指定 BPMFVs 字型路徑")
    parser.add_argument("--demo", choices=["1.4", "1.5"], help="內建示範資料")
    parser.add_argument("--list-fonts", action="store_true", help="列出可用字型")
    args = parser.parse_args()

    if args.list_fonts:
        print("fonts/ 資料夾中的 BPMFVs 字型：")
        if FONTS_DIR.exists():
            for f in sorted(FONTS_DIR.glob("*.ttf")):
                print(f"  {f.name}")
        return

    if args.font:
        font_path = args.font
        if not font_path.exists():
            sys.exit(f"❌ 找不到字型：{font_path}")
    else:
        try:
            font_path = find_bpmf_font()
            print(f"📝 使用字型：{font_path.name}")
        except FileNotFoundError as e:
            sys.exit(f"❌ {e}")

    if args.demo:
        config = DEMO_CONFIGS[args.demo]
        output = args.output or Path(f"學而{args.demo}.pptx")
        build_pptx(config, output, font_path)
        return

    if not args.config:
        parser.print_help()
        sys.exit(1)

    if not args.config.exists():
        sys.exit(f"❌ 找不到設定檔：{args.config}")

    with open(args.config, encoding="utf-8") as f:
        config = yaml.safe_load(f)

    output = args.output or args.config.with_suffix(".pptx")
    build_pptx(config, output, font_path)


if __name__ == "__main__":
    main()
