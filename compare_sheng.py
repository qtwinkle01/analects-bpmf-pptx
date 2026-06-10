import uharfbuzz as hb
from fontTools.ttLib import TTFont
import freetype
import numpy as np
from PIL import Image

font_path = 'fonts/BpmfZihiKaiStd-Regular.ttf'

def shape_char(char, font_path, feature=None):
    """回傳 shaping 後的 glyph name"""
    with open(font_path, "rb") as f:
        font_data = f.read()

    blob = hb.Blob(font_data)
    face = hb.Face(blob)
    hb_font = hb.Font(face)
    hb_font.scale = (120 * 64, 120 * 64)

    buf = hb.Buffer()
    buf.add_str(char)
    buf.guess_segment_properties()

    features = {feature: True} if feature else {}
    hb.shape(hb_font, buf, features)

    gid = buf.glyph_infos[0].codepoint
    ft_font = TTFont(font_path)
    glyph_name = ft_font.getGlyphOrder()[gid]
    return gid, glyph_name

def render_glyph_by_name(font_path, glyph_name, font_size=120):
    """用 freetype 渲染指定 glyph name"""
    ft_font = TTFont(font_path)
    glyph_order = ft_font.getGlyphOrder()
    gid = glyph_order.index(glyph_name)

    face = freetype.Face(font_path)
    face.set_pixel_sizes(0, font_size)
    face.load_glyph(gid, freetype.FT_LOAD_RENDER)

    bitmap = face.glyph.bitmap
    if bitmap.width == 0 or bitmap.rows == 0:
        return Image.new("L", (font_size, font_size), 255)
    arr = np.array(bitmap.buffer, dtype=np.uint8).reshape(bitmap.rows, bitmap.width)
    return Image.fromarray(255 - arr)

# ── 掃描「省」的所有 ss feature ──
char = "省"
features_to_test = [None, "ss01", "ss02", "ss03", "ss04", "ss05", "ss10"]

print(f"{'Feature':<10} {'GID':<8} {'Glyph Name'}")
print("-" * 40)

results = []
for feat in features_to_test:
    gid, gname = shape_char(char, font_path, feat)
    print(f"{str(feat):<10} {gid:<8} {gname}")
    img = render_glyph_by_name(font_path, gname)
    results.append((feat, img))

# ── 拼成比較圖 ──
cell_w, cell_h = 140, 160
canvas = Image.new("RGB", (cell_w * len(results), cell_h), (255, 255, 255))

for i, (feat, img) in enumerate(results):
    # 置中貼上字形
    x = i * cell_w + (cell_w - img.width) // 2
    y = 10
    canvas.paste(img.convert("RGB"), (x, y))

# 加上 feature 標籤（用 Pillow 預設字型）
from PIL import ImageDraw
draw = ImageDraw.Draw(canvas)
for i, (feat, _) in enumerate(results):
    label = str(feat) if feat else "預設"
    draw.text((i * cell_w + 10, cell_h - 25), label, fill=(200, 0, 0))

canvas.save("compare_sheng.png")
print("\n已儲存 compare_sheng.png")
