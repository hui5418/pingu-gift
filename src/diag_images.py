# -*- coding: utf-8 -*-
"""诊断：原图 vs 抠图，检查缺失区域。"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SRC, "diag")
os.makedirs(OUT, exist_ok=True)
MARK = (255, 0, 255, 255)


def remove_bg(im, thresh=38, pad=0):
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
            ImageDraw.floodfill(work, s, MARK, thresh=thresh)
        except Exception:
            pass
    arr = np.array(work)
    bg = np.all(arr[:, :, :3] == np.array([255, 0, 255]), axis=2)
    wm = np.zeros_like(bg)
    wm[int(h * 0.88):, int(w * 0.74):] = True
    bg = bg | wm
    obj = (~bg).astype(np.uint8) * 255
    mask = Image.fromarray(obj, "L").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.copy()
    out.putalpha(mask)
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    return out


def checker(size, cell=12):
    im = Image.new("RGB", size, (255, 255, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2 == 0:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(210, 210, 210))
    return im


names = ["eat", "study", "sleep", "play", "birthday"]
for n in names:
    orig = Image.open(os.path.join(SRC, n + ".jpg")).convert("RGB")
    # 对比图：左原图，右抠图放在棋盘格上
    H = 620
    left = orig.resize((int(orig.width * H / orig.height), H), Image.LANCZOS)
    cut = remove_bg(orig)
    scale = H / cut.height
    right = cut.resize((max(1, int(cut.width * scale)), H), Image.LANCZOS)
    bg = checker((right.width, H))
    bg.paste(right, (0, 0), right)
    sheet = Image.new("RGB", (left.width + right.width + 20, H), (255, 255, 255))
    sheet.paste(left, (0, 0))
    sheet.paste(bg, (left.width + 20, 0))
    sheet.save(os.path.join(OUT, n + "-compare.png"))
    # 单独放大右侧手臂/帽子区域
    cut2 = cut.resize((cut.width * 2, cut.height * 2), Image.LANCZOS)
    cut2.save(os.path.join(OUT, n + "-cut2x.png"))
    print(n, "orig", orig.size, "cut", cut.size)
print("done")
