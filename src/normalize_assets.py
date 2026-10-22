# -*- coding: utf-8 -*-
"""把 assets/ 里的新 PNG 统一成页面布局需要的规格：
- 裁到角色边界（alpha bbox）
- 角色高度缩放到 620px
- 四周加 8% 透明留白（50px）
- 输出透明 PNG（RGBA）

页面代码不改，靠统一素材规格保证 5 只 Pingu 的大小、脚底位置一致。
"""
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
ASSETS = ROOT / "assets"
NAMES = ["eat", "study", "sleep", "play", "birthday"]
CHAR_H = 620
PAD = round(CHAR_H * 0.08)      # 50px
BACKUP = ROOT / "diag10" / "originals"


def main():
    BACKUP.mkdir(parents=True, exist_ok=True)
    for n in NAMES:
        src = ASSETS / (n + ".png")
        im = Image.open(src).convert("RGBA")
        im.save(BACKUP / (n + ".png"), "PNG")    # 备份用户给的原始素材
        bbox = im.getchannel("A").getbbox()
        if not bbox:
            print(n, "empty alpha, skipped")
            continue
        cut = im.crop(bbox)
        scale = CHAR_H / cut.height
        cut = cut.resize((max(1, round(cut.width * scale)), CHAR_H), Image.LANCZOS)
        canvas = Image.new("RGBA", (cut.width + PAD * 2, CHAR_H + PAD * 2), (0, 0, 0, 0))
        canvas.paste(cut, (PAD, PAD), cut)
        canvas.save(src, "PNG", optimize=True)
        print(n, canvas.size, round(src.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
