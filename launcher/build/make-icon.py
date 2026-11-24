"""生成 Canvas Agent 应用图标（png / ico / icns）。

用法：python build/make-icon.py
"""

from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 1024
BG = (13, 16, 21, 255)
ACCENT = (61, 220, 151)
BLUE = (91, 140, 255)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size, start, end, angle=45):
    img = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(img)
    rad = math.radians(angle)
    dx, dy = math.cos(rad), math.sin(rad)
    for i in range(size * 2):
        t = i / (size * 2 - 1)
        color = lerp(start, end, t)
        offset = i - size / 2
        draw.line(
            [(offset * dx - size * dy, offset * dy + size * dx),
             (offset * dx + size * dy, offset * dy - size * dx)],
            fill=color + (255,),
            width=3,
        )
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def build() -> Image.Image:
    # 底：深色圆角卡片
    card = Image.new("RGBA", (SIZE, SIZE), BG)
    mask = rounded_mask(SIZE, int(SIZE * 0.22))
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(card, (0, 0), mask)

    # 内发光（渐变描边）
    ring = gradient(SIZE, ACCENT, BLUE)
    ring_mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(ring_mask).rounded_rectangle(
        [3, 3, SIZE - 4, SIZE - 4], radius=int(SIZE * 0.22), outline=255, width=10
    )
    ring.putalpha(ring_mask)
    canvas.alpha_composite(ring)

    # 图形：三角节点 + 连线
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = SIZE / 2, SIZE / 2
    r = SIZE * 0.21
    pts = [
        (cx, cy - r),
        (cx - r * 0.87, cy + r * 0.5),
        (cx + r * 0.87, cy + r * 0.5),
    ]
    line_w = int(SIZE * 0.036)
    for i in range(3):
        a, b = pts[i], pts[(i + 1) % 3]
        draw.line([a, b], fill=(255, 255, 255, 60), width=line_w)
    for i, (x, y) in enumerate(pts):
        color = lerp(ACCENT, BLUE, i / 2)
        dot_r = SIZE * 0.075
        draw.ellipse([x - dot_r, y - dot_r, x + dot_r, y + dot_r], fill=color + (255,))

    # 光晕
    glow = layer.filter(ImageFilter.GaussianBlur(SIZE * 0.035))
    glow.putalpha(glow.getchannel("A").point(lambda v: int(v * 0.55)))
    canvas.alpha_composite(glow)
    canvas.alpha_composite(layer)
    return canvas


def main() -> int:
    img = build()
    png_path = os.path.join(HERE, "icon.png")
    img.save(png_path)
    print("saved", png_path)

    ico_path = os.path.join(HERE, "icon.ico")
    img.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("saved", ico_path)

    tray_path = os.path.join(HERE, "tray.png")
    img.resize((64, 64), Image.LANCZOS).save(tray_path)
    print("saved", tray_path)

    icns_path = os.path.join(HERE, "icon.icns")
    try:
        img.save(icns_path)
        print("saved", icns_path)
    except Exception as error:  # noqa: BLE001
        print("icns skipped:", error)
    return 0


if __name__ == "__main__":
    sys.exit(main())
