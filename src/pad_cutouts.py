# -*- coding: utf-8 -*-
"""把 repair_cutouts.py 输出的透明 PNG 四周统一加 8% 留白，作为网页资源。

- 上下左右都留白（主体不贴画布边缘）
- 输出 assets/*.png（透明 alpha 通道，不是 jpg）
"""
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / "cutouts4"
OUT = ROOT / "assets"
PAD = 0.08
NAMES = ["eat", "study", "sleep", "play", "birthday"]


def main():
    OUT.mkdir(exist_ok=True)
    total = 0
    for n in NAMES:
        im = Image.open(SRC / (n + ".png")).convert("RGBA")
        w, h = im.size
        pad = max(6, round(h * PAD))
        canvas = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad), im)
        out = OUT / (n + ".png")
        canvas.save(out, "PNG", optimize=True)
        kb = out.stat().st_size / 1024
        total += kb
        print(n, canvas.size, round(kb), "KB")
    print("total", round(total), "KB")


if __name__ == "__main__":
    main()
