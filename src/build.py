# -*- coding: utf-8 -*-
"""把模板、农历代码合成 index.html；图片外置在 assets/（加载更快）。"""
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

IMAGES = {
    "__IMG_EAT__": "eat.webp",
    "__IMG_STUDY__": "study.webp",
    "__IMG_SLEEP__": "sleep.webp",
    "__IMG_PLAY__": "play.webp",
    "__IMG_BIRTHDAY__": "birthday.webp",
}


def main():
    tpl = (HERE / "app.template.html").read_text(encoding="utf-8")
    lunar = (HERE / "lunar.js").read_text(encoding="utf-8")
    tpl = tpl.replace("__LUNAR_JS__", lunar)
    for key, fn in IMAGES.items():
        # 外置图片：同一个站点下的 assets/ 目录，浏览器可以并行下载 + 缓存
        tpl = tpl.replace(key, "assets/" + fn)
    for leftover in ("__IMG_", "__LUNAR_JS__", "__GESTURE_JS__"):
        if leftover in tpl:
            raise SystemExit("占位符没有替换完: " + leftover)
    out = ROOT / "index.html"
    out.write_text(tpl, encoding="utf-8")
    print("built", out, round(out.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
