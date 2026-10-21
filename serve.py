#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pingu 的小世界 —— 本地服务器（默认 HTTPS，手机可以正常使用麦克风等需要安全环境的功能）
双击 启动手机版.bat 即可；也可以手动运行：

    python serve.py                 # HTTPS，端口 8443（手机用这个）
    python serve.py --http          # 普通 HTTP，端口 8000（仅电脑 localhost 能开摄像头）
    python serve.py --port 9000     # 自定义端口

第一次运行会自动生成自签名证书（.certs/ 目录，需要电脑装有 Git 自带的 openssl，
大多数 Windows 装了 Git 就有；没有也能用 --http）。
手机打开 https://电脑IP:8443 时，浏览器会提示"证书不安全"，
点"高级 → 继续前往"就行（只是本地自签名证书，不会上传任何东西）。
"""
import http.server
import os
import socket
import ssl
import subprocess
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(ROOT, ".certs")

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass


def find_openssl():
    candidates = [
        r"C:\Program Files\Git\usr\bin\openssl.exe",
        r"C:\Program Files\Git\mingw64\bin\openssl.exe",
        r"C:\Program Files (x86)\Git\usr\bin\openssl.exe",
        "openssl",
    ]
    for c in candidates:
        if c == "openssl":
            try:
                subprocess.run([c, "version"], check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                return c
            except Exception:
                continue
        if os.path.isfile(c):
            return c
    return None


def ensure_cert(ip):
    os.makedirs(CERT_DIR, exist_ok=True)
    cert = os.path.join(CERT_DIR, "cert.pem")
    key = os.path.join(CERT_DIR, "key.pem")
    if os.path.isfile(cert) and os.path.isfile(key):
        # 已经存在就直接用（IP 变了也能继续用，浏览器照样可以继续前往）
        return cert, key
    openssl = find_openssl()
    if not openssl:
        return None
    san = "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:" + ip
    try:
        subprocess.run(
            [openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", key, "-out", cert, "-days", "3650",
             "-subj", "/CN=Pingu Local", "-addext", san],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
        )
        return cert, key
    except Exception:
        return None


def pick_port(preferred):
    for p in range(preferred, preferred + 40):
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
    # 关键 MIME：.mjs / .wasm / .task 不对的话 MediaPipe 加载不起来
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".webp": "image/webp",
        ".html": "text/html",
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    use_https = "--http" not in sys.argv
    port_arg = None
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv) and sys.argv[i + 1].isdigit():
            port_arg = int(sys.argv[i + 1])
        elif a.isdigit():
            port_arg = int(a)

    ip = lan_ip()
    port = pick_port(port_arg or (8443 if use_https else 8000))

    scheme = "https" if use_https else "http"
    phone_url = "%s://%s:%d/" % (scheme, ip, port)
    pc_url = "%s://127.0.0.1:%d/" % (scheme, port)

    ctx = None
    if use_https:
        pair = ensure_cert(ip)
        if not pair:
            print("  ⚠️  没有找到 openssl，无法生成 HTTPS 证书。")
            print("      改用普通 HTTP（手机上麦克风等功能会被浏览器限制）。")
            use_https = False
            scheme = "http"
            port = pick_port(8000)
            phone_url = "http://%s:%d/" % (ip, port)
            pc_url = "http://127.0.0.1:%d/" % (port,)
        else:
            cert, key = pair
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(cert, key)

    print("")
    print("  🐧  Pingu 的小世界  ·  生日礼物")
    print("  " + "-" * 50)
    print("  手机打开：  " + phone_url)
    print("  电脑打开：  " + pc_url)
    print("  " + "-" * 50)
    if use_https:
        print("  手机第一次打开会提示证书不安全：")
        print("     点『高级』→『继续前往』即可（本地自签名证书，安全）")
        print("  手机和电脑要连同一个 WiFi；手机建议用 Chrome / Edge / Safari")
    else:
        print("  普通 HTTP 模式：只有电脑 localhost 能用麦克风等敏感功能")
    print("  " + "-" * 50)
    print("  停止服务：按 Ctrl + C")
    print("")

    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if ctx:
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    if "--open" in sys.argv:
        threading.Thread(target=lambda: (time.sleep(0.8), webbrowser.open(pc_url)), daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。下次见 👋")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
