# -*- coding: utf-8 -*-
"""精细抠图（输出透明 PNG，供 assets/ 使用）：

在"原始 38 阈值抠图"基础上修复已知缺陷：
1. 被误当背景的浅色物体（叉子最上面的齿、滑雪杖、雪板浅色边缘）——把"不是白色、但 alpha 被抠掉、
   且紧挨角色"的像素补回来；
2. 白色毛球（睡觉帽尖、滑雪帽顶）——白+白分不开，用人工标好的圆 + 羽化补回来（RGB 取原图，保留毛绒质感）；
3. 白色袖子被抠出的洞（上学）——人工多边形 + 周围布料颜色 inpaint；
4. 被角色包围的小透明洞——自动 inpaint；
5. 右下角水印；
6. 边缘柔化（保留毛绒的半透明边），不做硬锯齿。

输出：src/cutouts4/<name>.png（高 620，透明，四周已裁到角色边界）
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

# 原图坐标下的白色毛球（cx, cy, r）
POMS = {
    "sleep": [(932, 216, 54)],
    "play": [(640, 247, 36)],
}

# 原图坐标下需要"填洞"的多边形（白色袖子被抠出的洞）
FILL_POLYGONS = {
    "study": [[(795, 595), (890, 588), (892, 635), (860, 655), (815, 660), (795, 630)]],
}


def base_alpha(im):
    """38 阈值洪水填充抠图（含水印去除），返回原尺寸 alpha"""
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
    bg[int(h * 0.86):, int(w * 0.70):] = True          # 豆包水印
    obj = (~bg).astype(np.uint8) * 255
    return Image.fromarray(obj, "L")


def restore_colored(im, alpha):
    """补回被误删的浅色物体像素（叉子齿、雪杖、雪板浅色边）"""
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    a = np.asarray(alpha).astype(np.float32) / 255.0
    near_obj = np.asarray(
        Image.fromarray((a * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(9))
    ) > 40
    candidate = ((lum < 232) | (sat > 18)) & (a < 0.35) & near_obj
    a2 = np.maximum(a, candidate.astype(np.float32))
    return Image.fromarray(np.clip(a2 * 255, 0, 255).astype(np.uint8), "L")


def add_poms(alpha, poms):
    if not poms:
        return alpha
    w, h = alpha.size
    a = np.asarray(alpha).astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:h, 0:w]
    for cx, cy, r in poms:
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
        pom = np.clip((1.15 - d) / (1.15 - 0.82), 0, 1)   # 0.82r 实心，外圈羽化
        a = np.maximum(a, pom)
    return Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), "L")


def _inpaint(rgb, need, known, rounds=80):
    """用已知像素一圈圈向内填 need 区域的颜色"""
    h, w = need.shape
    rgb = rgb.copy().astype(np.float32)
    known = known.copy()
    need = need.copy()
    for _ in range(rounds):
        if not need.any():
            break
        pad = np.pad(known, 1, constant_values=False)
        neigh = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
        front = need & neigh
        if not front.any():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros((h, w), np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                ys = slice(max(0, dy), h + min(0, dy))
                xs = slice(max(0, dx), w + min(0, dx))
                ys2 = slice(max(0, -dy), h + min(0, -dy))
                xs2 = slice(max(0, -dx), w + min(0, -dx))
                ok = known[ys, xs]
                acc[ys2, xs2][ok] += rgb[ys, xs][ok]
                cnt[ys2, xs2][ok] += 1
        fill = front & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill, None]
        known |= fill
        need &= ~fill
    return np.clip(rgb, 0, 255).astype(np.uint8)


def fill_polygons(im, alpha, polys):
    """多边形内的透明洞：用周围布料颜色补齐 + 不透明"""
    if not polys:
        return im, alpha
    w, h = alpha.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for pts in polys:
        d.polygon(pts, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.0))
    m = np.asarray(mask)
    a = np.asarray(alpha)
    need = (m > 120) & (a < 128)
    rgb = np.asarray(im.convert("RGB"))
    if need.any():
        known = a >= 128
        rgb = _inpaint(rgb, need, known)
    a2 = np.maximum(a.astype(np.float32), m.astype(np.float32))
    return Image.fromarray(rgb, "RGB"), Image.fromarray(np.clip(a2, 0, 255).astype(np.uint8), "L")


def fill_holes(im, alpha):
    """自动填掉被角色包围的小透明洞"""
    a = np.asarray(alpha)
    h, w = a.shape
    trans = a < 128
    if not trans.any():
        return im, alpha
    seen = np.zeros_like(trans)
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
    rgb = np.asarray(im.convert("RGB"))
    rgb = _inpaint(rgb, holes, ~holes)
    a2 = a.copy()
    a2[holes] = 255
    return Image.fromarray(rgb, "RGB"), Image.fromarray(a2, "L")


def main():
    OUT.mkdir(exist_ok=True)
    for n in NAMES:
        im = Image.open(HERE / (n + ".jpg")).convert("RGB")
        alpha = base_alpha(im)
        alpha = restore_colored(im, alpha)
        alpha = add_poms(alpha, POMS.get(n, []))
        rgb, alpha = fill_polygons(im, alpha, FILL_POLYGONS.get(n, []))
        rgb, alpha = fill_holes(im, alpha)
        # 毛绒软边：轻微内缩 1px + 羽化
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
        cut = rgb.convert("RGBA")
        cut.putalpha(alpha)
        bbox = cut.getbbox()
        if bbox:
            cut = cut.crop(bbox)
        scale = TARGET_H / cut.height
        cut = cut.resize((max(1, round(cut.width * scale)), TARGET_H), Image.LANCZOS)
        cut.save(OUT / (n + ".png"), "PNG", optimize=True)
        print(n, cut.size, round((OUT / (n + ".png")).stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
