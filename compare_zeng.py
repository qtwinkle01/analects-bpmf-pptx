import uharfbuzz as hb
from fontTools.ttLib import TTFont
from PIL import Image
import freetype
import numpy as np

def render_glyph_to_image(font_path, glyph_name, font_size=120):
    """
    用 freetype-py 直接渲染指定 glyph name 到 numpy array
    """
    ft_font = TTFont(font_path)
    glyph_order = ft_font.getGlyphOrder()
    gid = glyph_order.index(glyph_name)

    face = freetype.Face(font_path)
    face.set_pixel_sizes(0, font_size)
    face.load_glyph(gid, freetype.FT_LOAD_RENDER)

    bitmap = face.glyph.bitmap
    w, h = bitmap.width, bitmap.rows
    arr = np.array(bitmap.buffer, dtype=np.uint8).reshape(h, w)
    return arr, face.glyph.bitmap_left, face.glyph.bitmap_top

def make_comparison_image(font_path, font_size=120):
    variants = [
        ("uni66FE",      "預設"),
        ("uni66FE.ss01", "ss01"),
        ("uni66FE.ss00", "ss10"),
    ]

    images = []
    for gname, label in variants:
        arr, bl, bt = render_glyph_to_image(font_path, gname, font_size)
        img = Image.fromarray(255 - arr)  # 反色：黑字白底
        images.append((img, label))

    # 拼成一張橫排比較圖
    total_w = sum(img.width + 40 for img, _ in images) + 40
    max_h = max(img.height for img, _ in images) + 20
    canvas = Image.new("L", (total_w, max_h), 255)

    x = 20
    for img, label in images:
        canvas.paste(img, (x, 10))
        x += img.width + 40

    canvas.save("compare_zeng.png")
    print("已儲存 compare_zeng.png")

make_comparison_image('fonts/BpmfZihiKaiStd-Regular.ttf')
