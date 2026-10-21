# -*- coding: utf-8 -*-
"""生成网页用的图片资源（外置，避免把 2MB 图片塞进 HTML）。

从 src/cutouts/*.webp（透明抠图）出发：
- 顶部和左右各加 8% 透明安全留白（防止部分手机浏览器裁掉图片最外圈）
- 输出 assets/*.webp（质量 84，体积小、加载快）
"""
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / "cutouts"
OUT = ROOT / "assets"
PAD = 0.08
NAMES = ["eat", "study", "sleep", "play", "birthday"]


def main():
    OUT.mkdir(exist_ok=True)
    total = 0
    for n in NAMES:
        im = Image.open(SRC / (n + ".webp")).convert("RGBA")
        w, h = im.size
        pad = max(4, round(h * PAD))
        canvas = Image.new("RGBA", (w + pad * 2, h + pad), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad), im)
        out = OUT / (n + ".webp")
        canvas.save(out, "WEBP", quality=84, method=6)
        kb = out.stat().st_size / 1024
        total += kb
        print(n, canvas.size, round(kb), "KB")
    print("total", round(total), "KB")


if __name__ == "__main__":
    main()
