# -*- coding: utf-8 -*-
"""给透明抠图加"安全留白"：顶部 + 左右各 8%（以角色高度计）透明边。
这样即使某些手机浏览器会裁掉图片边缘几个像素，也不会裁到角色本身。
输出 PNG（比 WebP 更不容易遇到 alpha 解码问题）。"""
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "cutouts"
OUT = HERE / "cutouts_pad"
PAD = 0.08          # 相对角色高度的留白比例
NAMES = ["eat", "study", "sleep", "play", "birthday"]


def main():
    OUT.mkdir(exist_ok=True)
    for n in NAMES:
        im = Image.open(SRC / (n + ".webp")).convert("RGBA")
        w, h = im.size
        pad = max(4, round(h * PAD))
        canvas = Image.new("RGBA", (w + pad * 2, h + pad), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad), im)
        out = OUT / (n + ".png")
        canvas.save(out, "PNG", optimize=True)
        print(n, im.size, "->", canvas.size, round(out.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
