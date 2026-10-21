# -*- coding: utf-8 -*-
"""最终抠图修复：在"原始 38 阈值抠图"基础上，修掉几类已知缺陷：

1. 被当成背景吃掉的浅色物体像素（叉子最上面的齿）——把"原图里明显不是白色、但 alpha 被抠掉、
   且紧挨着角色"的像素补回来；
2. 白色毛球（睡觉帽尖、滑雪帽顶）——白色和背景分不开，用人工标好的圆 + 羽化补回来；
3. 被背景"漏进去"形成的小洞（上学袖子）——把被角色包围的透明小洞用周围颜色补上；
4. 右下角水印。

输出：src/cutouts4/*.webp（620px 高，透明）
"""
import collections
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "cutouts4"
NAMES = ["eat", "study", "sleep", "play", "birthday"]
MARK = (255, 0, 255, 255)
TARGET_H = 620

# 原图坐标下的毛球（cx, cy, r），只对这两张需要
POMS = {
    "sleep": [(932, 216, 54)],
    "play": [(640, 247, 36)],
}

# 原图坐标下需要"按颜色补回不透明"的区域（白色袖子被当成背景抠掉了）
# bbox 内：有轻微颜色（sat>6）或不是纯白（lum<246）的像素 → 补回，背景纯白不补
COLOR_PATCHES = {
    "study": [(740, 540, 930, 730)],
}


def base_alpha(im):
    """原始 38 阈值抠图（保留水印去除），返回原尺寸 alpha（L 图）"""
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
    bg[int(h * 0.86):, int(w * 0.70):] = True
    obj = (~bg).astype(np.uint8) * 255
    return Image.fromarray(obj, "L").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))


def restore_colored(im, alpha):
    """补回被误删的浅色物体像素（叉子齿等）"""
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    a = np.asarray(alpha).astype(np.float32) / 255.0
    near_obj = np.asarray(
        Image.fromarray((a * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(9))
    ) > 40
    candidate = ((lum < 232) | (sat > 18)) & (a < 0.35) & near_obj
    a2 = np.maximum(a, candidate.astype(np.float32))
    a2 = np.clip(a2, 0, 1)
    out = Image.fromarray((a2 * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.6))
    return out


def add_poms(alpha, poms):
    if not poms:
        return alpha
    w, h = alpha.size
    a = np.asarray(alpha).astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:h, 0:w]
    for cx, cy, r in poms:
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
        # 0.82r 内全不透明，0.82~1.15r 羽化到 0
        pom = np.clip((1.15 - d) / (1.15 - 0.82), 0, 1)
        a = np.maximum(a, pom)
    a = np.clip(a, 0, 1)
    return Image.fromarray((a * 255).astype(np.uint8), "L")


def add_color_patches(im, alpha, patches):
    """在指定 bbox 里，把"不是纯白背景"的像素补回 alpha，去掉纯白。"""
    if not patches:
        return alpha
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    a = np.asarray(alpha).astype(np.float32) / 255.0
    add = np.zeros_like(a)
    for x0, y0, x1, y1 in patches:
        box = (slice(y0, y1), slice(x0, x1))
        cand = ((sat[box] > 6) | (lum[box] < 246)) & (a[box] < 0.4)
        add[box] = np.maximum(add[box], cand.astype(np.float32))
    # 去掉很小的孤立点（背景 JPEG 噪点）
    add_img = Image.fromarray((add * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.8))
    add_arr = np.asarray(add_img)
    a2 = np.maximum(a, add_arr.astype(np.float32) / 255.0)
    return Image.fromarray(np.clip(a2 * 255, 0, 255).astype(np.uint8), "L")


def fill_holes(im, alpha):
    """填掉被角色包围的小透明洞，用最近颜色补，避免白点"""
    a = np.asarray(alpha)
    h, w = a.shape
    trans = a < 128
    seen = np.zeros_like(trans, bool)
    dq = collections.deque()
    for x in range(w):
        for y in (0, h - 1):
            if trans[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if trans[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and trans[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    holes = trans & ~seen
    if not holes.any():
        return im, alpha

    rgb = np.asarray(im.convert("RGB")).copy()
    aa = np.asarray(alpha).copy()
    filled = holes.copy()
    # 迭代：用 8 邻域的已知颜色填洞
    for _ in range(24):
        if not filled.any():
            break
        new_rgb = rgb.astype(np.float32)
        new_a = aa.astype(np.float32)
        known = ~filled
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                ys = slice(max(0, dy), h + min(0, dy))
                xs = slice(max(0, dx), w + min(0, dx))
                ys2 = slice(max(0, -dy), h + min(0, -dy))
                xs2 = slice(max(0, -dx), w + min(0, -dx))
                src = known[ys, xs]
                dst = filled[ys2, xs2]
                take = src & dst
                new_rgb[ys2, xs2][take] = new_rgb[ys, xs][take]
                new_a[ys2, xs2][take] = 255
        rgb = new_rgb.astype(np.uint8)
        aa = new_a.astype(np.uint8)
        filled = filled & (aa < 128)
    out_a = Image.fromarray(np.maximum(np.asarray(alpha), aa), "L")
    return Image.fromarray(rgb, "RGB"), out_a


def main():
    OUT.mkdir(exist_ok=True)
    for n in NAMES:
        im = Image.open(HERE / (n + ".jpg")).convert("RGB")
        alpha = base_alpha(im)
        alpha = restore_colored(im, alpha)
        alpha = add_poms(alpha, POMS.get(n, []))
        alpha = add_color_patches(im, alpha, COLOR_PATCHES.get(n, []))
        rgb, alpha = fill_holes(im, alpha)
        cut = rgb.convert("RGBA")
        cut.putalpha(alpha)
        bbox = cut.getbbox()
        if bbox:
            cut = cut.crop(bbox)
        scale = TARGET_H / cut.height
        cut = cut.resize((max(1, round(cut.width * scale)), TARGET_H), Image.LANCZOS)
        cut.save(OUT / (n + ".webp"), "WEBP", quality=90, method=6)
        print(n, cut.size, round((OUT / (n + ".webp")).stat().st_size / 1024), "KB")
    print("done ->", OUT)


if __name__ == "__main__":
    main()
