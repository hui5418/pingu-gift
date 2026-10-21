# -*- coding: utf-8 -*-
"""把 5 张白底 Pingu 图抠成透明 WebP，用于网页合成。"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SRC, "cutouts")
os.makedirs(OUT, exist_ok=True)

FILES = [
    ("eat", "eat.jpg"),
    ("study", "study.jpg"),
    ("sleep", "sleep.jpg"),
    ("play", "play.jpg"),
    ("birthday", "birthday.jpg"),
]

MARK = (255, 0, 255, 255)


def remove_bg(im):
    im = im.convert("RGBA")
    w, h = im.size
    work = im.copy()
    seeds = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]
    for i in range(1, 10):
        x = int(w * i / 10)
        seeds += [(x, 2), (x, h - 3)]
        y = int(h * i / 10)
        seeds += [(2, y), (w - 3, y)]
    for s in seeds:
        try:
            ImageDraw.floodfill(work, s, MARK, thresh=38)
        except Exception:
            pass
    arr = np.array(work)
    bg = np.all(arr[:, :, :3] == np.array([255, 0, 255]), axis=2)
    # 去掉右下角水印区域
    watermark = np.zeros_like(bg)
    watermark[int(h * 0.88):, int(w * 0.74):] = True
    bg = bg | watermark
    obj = (~bg).astype(np.uint8) * 255
    mask = Image.fromarray(obj, "L")
    # 内缩 1px 去白边，再羽化 0.8px
    mask = mask.filter(ImageFilter.MinFilter(3))
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    alpha = np.array(mask)
    out = im.copy()
    out.putalpha(Image.fromarray(alpha, "L"))
    # 裁掉透明边
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    return out


def main():
    sheet = Image.new("RGB", (5 * 260, 460), (120, 190, 235))
    for idx, (name, fn) in enumerate(FILES):
        im = Image.open(os.path.join(SRC, fn))
        cut = remove_bg(im)
        w, h = cut.size
        target_h = 620
        target_w = max(1, round(w * target_h / h))
        cut = cut.resize((target_w, target_h), Image.LANCZOS)
        path = os.path.join(OUT, name + ".webp")
        cut.save(path, "WEBP", quality=88, method=6)
        # 预览：贴到浅蓝背景上
        prev = Image.new("RGB", (260, 460), (120, 190, 235))
        sc = min(240 / target_w, 430 / target_h)
        small = cut.resize((max(1, round(target_w * sc)), max(1, round(target_h * sc))), Image.LANCZOS)
        prev.paste(small, ((260 - small.width) // 2, 460 - small.height - 10), small)
        sheet.paste(prev, (idx * 260, 0))
        print(name, "size", cut.size, "bytes", os.path.getsize(path))
    sheet.save(os.path.join(SRC, "contact-sheet.jpg"), quality=88)
    print("sheet ok")


if __name__ == "__main__":
    main()
