#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pingu 的小世界 —— 本地服务器
让手机和电脑连同一个 WiFi，就能在手机上打开这份礼物。

用法：
    python serve.py            # 启动
    python serve.py --open     # 启动并自动在电脑浏览器打开
    python serve.py 8080       # 换一个端口
"""
import http.server
import os
import socket
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass


def pick_port(preferred):
    """端口被占用时自动往后找。"""
    for p in range(preferred, preferred + 30):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("0.0.0.0", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    return preferred


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 改完文件刷新就能看到，不被缓存卡住
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def copy_to_clipboard(text):
    """Windows 上顺手把网址复制到剪贴板，方便发到手机。"""
    if os.name != "nt":
        return False
    try:
        import subprocess
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Set-Clipboard", "-Value", text],
            check=False, timeout=4,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def main():
    port_arg = 8000
    for a in sys.argv[1:]:
        if a.isdigit():
            port_arg = int(a)
    port = pick_port(port_arg)
    ip = lan_ip()
    phone_url = f"http://{ip}:{port}/"
    pc_url = f"http://127.0.0.1:{port}/"

    print("")
    print("  🐧  Pingu 的小世界  ·  生日礼物")
    print("  " + "-" * 46)
    print(f"  手机打开：  {phone_url}")
    print(f"  电脑打开：  {pc_url}")
    print("  " + "-" * 46)
    print("  1) 手机和电脑连同一个 WiFi")
    print("  2) 手机浏览器输入上面的『手机打开』网址")
    print("  3) iPhone 点分享 → 添加到主屏幕，就像一个小 App")
    print("  " + "-" * 46)
    print("  ⚠️  Windows 弹防火墙提示时，请点『允许访问』")
    print("  停止服务：按 Ctrl + C")
    print("")
    if copy_to_clipboard(phone_url):
        print("  （网址已复制到剪贴板）")
        print("")

    if "--open" in sys.argv:
        threading.Thread(target=lambda: (time.sleep(0.8), webbrowser.open(pc_url)), daemon=True).start()

    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。下次见 👋")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
