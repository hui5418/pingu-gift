# -*- coding: utf-8 -*-
"""把模板、农历代码、5 张透明 WebP 合成一个单文件 index.html。"""
import base64
import pathlib
import sys

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
    gesture = (HERE / "gesture-mediapipe.js").read_text(encoding="utf-8")
    tpl = tpl.replace("__LUNAR_JS__", lunar)
    tpl = tpl.replace("__GESTURE_JS__", gesture)
    for key, fn in IMAGES.items():
        data = base64.b64encode((HERE / "cutouts" / fn).read_bytes()).decode("ascii")
        tpl = tpl.replace(key, "data:image/webp;base64," + data)
    for leftover in ("__IMG_", "__LUNAR_JS__", "__GESTURE_JS__"):
        if leftover in tpl:
            raise SystemExit("占位符没有替换完: " + leftover)
    out = ROOT / "index.html"
    out.write_text(tpl, encoding="utf-8")
    print("built", out, round(out.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
