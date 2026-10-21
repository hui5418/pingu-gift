# -*- coding: utf-8 -*-
"""把模板、农历代码、5 张带安全留白的 PNG 合成一个单文件 index.html。"""
import base64
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

IMAGES = {
    "__IMG_EAT__": "eat.png",
    "__IMG_STUDY__": "study.png",
    "__IMG_SLEEP__": "sleep.png",
    "__IMG_PLAY__": "play.png",
    "__IMG_BIRTHDAY__": "birthday.png",
}


def main():
    tpl = (HERE / "app.template.html").read_text(encoding="utf-8")
    lunar = (HERE / "lunar.js").read_text(encoding="utf-8")
    tpl = tpl.replace("__LUNAR_JS__", lunar)
    for key, fn in IMAGES.items():
        data = base64.b64encode((HERE / "cutouts_pad" / fn).read_bytes()).decode("ascii")
        tpl = tpl.replace(key, "data:image/png;base64," + data)
    for leftover in ("__IMG_", "__LUNAR_JS__", "__GESTURE_JS__"):
        if leftover in tpl:
            raise SystemExit("占位符没有替换完: " + leftover)
    out = ROOT / "index.html"
    out.write_text(tpl, encoding="utf-8")
    print("built", out, round(out.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
