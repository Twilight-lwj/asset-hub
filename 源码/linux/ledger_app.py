#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
资产管理中枢 1.0.0 — Linux 桌面版启动器（免安装 AppImage 内运行）

把单文件记账页（index.html）本地化为 Linux 原生体验：
  * 内置 HTTP 服务，固定端口托管页面（origin 稳定 → localStorage 数据不丢）
  * 同时实现 /ns WebDAV 中转，替代 Android 原生桥，坚果云备份/恢复照常可用
  * 优先用 Chromium 系浏览器的 --app 模式开独立窗口，否则退回默认浏览器
  * 页面心跳停止（窗口关闭）一段时间后服务自动退出

版本说明：本版只把 VERSION 串改到 1.0.0（随页面走）；端口 17808、窗口 768×1024、
注入 CSS 与 /ns 中转逻辑均未改动。窗口尺寸可用 LEDGER_WINDOW=宽,高 覆盖。

用法：
  ./amhub                     启动（默认固定端口 17808）
  ./amhub --port 18000        指定端口（换端口 = 换 origin = 换一份本地数据，谨慎）
  ./amhub --browser none      只起服务，不自动开窗口
  ./amhub --version

说明：页面本身是纯前端 + localStorage，桌面端不需要把数据写进文件；
      唯一需要服务端配合的是坚果云 WebDAV（浏览器受 CORS 限制），故由 /ns 中转。
"""
import argparse
import base64
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, build_opener, urlopen, ProxyHandler
from urllib.error import HTTPError, URLError

APP_NAME = "amhub"
VERSION = "1.0.0"
DEFAULT_PORT = 17808
# v1.2.6：窗口尺寸＝平板竖屏（768×1024 CSS px），原来 1200×860 是横向宽屏，
# 页面在桌面上像「平板横屏」而不像竖屏。允许用 LEDGER_WINDOW=宽,高 覆盖。
WINDOW_SIZE = os.environ.get("LEDGER_WINDOW") or "768,1024"
DAV_ROOT = "https://dav.jianguoyun.com/dav/"
UA = "amhub/%s (Linux)" % VERSION
IDLE_LIMIT = int(os.environ.get("LEDGER_IDLE") or 180)   # 页面无心跳多久后退出（秒）
BOOT_GRACE = 240                                         # 从启动到第一次打开页面的最长等待（秒）

# 资产管理中枢云端目录：与手机端 NS_DIR / NS_DIR_OLD / NS_FILE 保持一致
BACKUP_DIR = "资产管理中枢"
NS_MAIN = "backup.json"
LEGACY_DIRS = {"资产管理中枢": "资产管理中枢备份"}


def _resource(name):
    """PyInstaller 打包后从 _MEIPASS 取；开发态从脚本目录 / 上级源码目录取。"""
    here = os.path.dirname(os.path.abspath(__file__))
    base = getattr(sys, "_MEIPASS", here)
    p = os.path.join(base, name)
    if os.path.exists(p):
        return p
    if name == "index.html":
        cand = os.path.abspath(os.path.join(here, "..", "资产管理中枢_浏览器版.html"))
        if os.path.exists(cand):
            return cand
    return p


with open(_resource("index.html"), "rb") as _f:
    HTML = _f.read()

ICON = b""
_icon = _resource("ledger.png")
if os.path.exists(_icon):
    with open(_icon, "rb") as _f:
        ICON = _f.read()

# 心跳：页面每 30s 请求 /ping，watchdog 据此判断窗口是否还开着（页面本身无心跳）
_HEARTBEAT = (b'<script>setInterval(function(){try{fetch("/ping",{cache:"no-store"});}'
              b'catch(e){}},30000);</script>')
if b"</body>" in HTML:
    HTML = HTML.replace(b"</body>", _HEARTBEAT + b"</body>", 1)

# v1.2.7：Linux 窗口没有系统状态栏，v1.2.5 给「平板竖屏」加的贴顶规则
# （body / .app 顶部留白归 0）在桌面上会让顶栏黑边贴着窗口上沿，显得局促。
# 做法：在 </head> 前追加一个 <style>，用同选择器把两段顶部留白补回来 ——
#   与原样式表特异性相同、但位置更晚，故覆盖生效；不改动页面文件本身。
# 平板竖屏（有状态栏）仍是贴顶效果，手机端不命中本断点。
DESK_TOP_CSS = (
    "<style>"
    "@media (min-width:560px) and (orientation:portrait){"
    "body{padding-top:.93em}"
    ".app{padding-top:.6em}"
    "}"
    "</style>"
)
if b"</head>" in HTML:
    HTML = HTML.replace(b"</head>", DESK_TOP_CSS.encode("utf-8") + b"</head>", 1)
else:                                              # 兜底：没有 head 就放最前面
    HTML = DESK_TOP_CSS.encode("utf-8") + HTML


# --------------------------------------------------------------------------
# 运行期状态
# --------------------------------------------------------------------------
class State:
    lock = threading.Lock()
    last_seen = time.time()
    served = False
    stop = threading.Event()


class DavError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status
        self.msg = msg


# --------------------------------------------------------------------------
# 坚果云 WebDAV 中转（与通用 WebDAV 中转同一实现，只换远程目录名）
# --------------------------------------------------------------------------
def _dav(method, path, user, pwd, body=None, headers=None, timeout=25):
    url = DAV_ROOT + quote(path.lstrip("/"), safe="/")
    auth = base64.b64encode(("%s:%s" % (user, pwd)).encode("utf-8")).decode("ascii")
    h = {"Authorization": "Basic " + auth, "User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = Request(url, data=body, method=method, headers=h)
    ctx = ssl.create_default_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, dict(r.headers), r.read()
    except HTTPError as e:
        return e.code, dict(e.headers or {}), e.read() or b""
    except URLError as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, socket.timeout):
            raise DavError(504, "连接坚果云超时，请检查网络")
        raise DavError(502, "连接坚果云失败：%s" % reason)
    except socket.timeout:
        raise DavError(504, "连接坚果云超时，请检查网络")


def _parse_propfind(xml_bytes):
    """取出 PROPFIND 响应里的文件名（仅本层，排除 collection 目录条目）。"""
    text = xml_bytes.decode("utf-8", "replace")
    blocks = re.findall(r"<[^>]*response[^>]*>(.*?)</[^>]*response>", text, re.S | re.I)
    has_blocks = bool(blocks)
    if not has_blocks:
        blocks = [text]
    names = []
    for block in blocks:
        if has_blocks and re.search(r"<[^>]*collection\b", block, re.I):
            continue
        m = re.search(r"<[^>]*href[^>]*>(.*?)</[^>]*href>", block, re.S | re.I)
        if not m:
            continue
        p = unquote(m.group(1).strip())
        if p.endswith("/"):
            continue
        name = p.rsplit("/", 1)[-1]
        if name and name not in names:
            names.append(name)
    return names


def _split_dir(path):
    p = unquote(path or "/")
    if not p.startswith("/"):
        p = "/" + p
    if p.endswith("/"):
        return p.rstrip("/")
    return p.rsplit("/", 1)[0]


def _backup_file(path):
    p = unquote(path or "/").strip("/")
    if p.endswith(".json"):
        return p
    return (p.rstrip("/") + "/" + NS_MAIN) if p else NS_MAIN


def _legacy_path(path):
    p = "/" + (path or "").lstrip("/")
    for new, old in LEGACY_DIRS.items():
        seg = "/" + new
        if p == seg or p.startswith(seg + "/"):
            return old + p[len(seg):]
    return None


def _legacy_folder(folder):
    for new, old in LEGACY_DIRS.items():
        if folder == new:
            return old
        if folder.startswith(new + "/"):
            return old + folder[len(new):]
    return None


def _hist_name(folder):
    return "%s/backup_%s.json" % (folder, time.strftime("%Y%m%d_%H%M%S", time.localtime()))


def _ensure_dir(path, user, pwd):
    folder = _split_dir(path).strip("/")
    if not folder:
        return ""
    parts = folder.split("/")
    cur = ""
    created = []
    for seg in parts:
        cur = (cur + "/" + seg) if cur else seg
        st, _, _ = _dav("PROPFIND", cur + "/", user, pwd, headers={"Depth": "0"})
        if st in (404, 409):
            st2, _, _ = _dav("MKCOL", cur + "/", user, pwd)
            if st2 in (201, 200, 204, 405):
                created.append(cur)
        elif st == 401:
            raise DavError(401, "账号或密码错误（坚果云请使用「第三方应用密码」）")
    return ("已创建远程目录 /%s" % "/".join(created)) if created else ""


def _prune(path, user, pwd, keep):
    folder = _split_dir(path).strip("/")
    if not folder:
        return
    st, _, body = _dav("PROPFIND", folder + "/", user, pwd, headers={"Depth": "1"})
    if st >= 300:
        return
    hist = sorted(n for n in _parse_propfind(body)
                  if re.match(r"^backup_\d{8}_\d{6}\.json$", n))
    for name in hist[:max(0, len(hist) - int(keep))]:
        _dav("DELETE", "%s/%s" % (folder, name), user, pwd)


def dav_relay(method, raw_path, user, pwd, body, hdrs):
    """把浏览器的 /ns 请求翻译成坚果云 WebDAV 调用，返回 (status, dict)。"""
    orig = unquote(raw_path or "/")
    path = _backup_file(raw_path)
    folder = _split_dir("/" + path).strip("/")
    probe = (hdrs.get("X-NS-Probe") or "").strip() == "1"
    want_list = (hdrs.get("X-NS-List") or "").strip() == "1"
    try:
        keep = int((hdrs.get("X-NS-Keep") or "0").strip() or 0)
    except ValueError:
        keep = 0
    if not user or not pwd:
        return 401, {"error": "请先在设置里填写坚果云账号与第三方应用密码"}

    if probe:
        tip = _ensure_dir("/" + path, user, pwd)
        st, _, _ = _dav("PROPFIND", folder + "/", user, pwd, headers={"Depth": "0"})
        if st == 401:
            return 401, {"error": "账号或密码错误（坚果云请使用「第三方应用密码」）"}
        out = {"ok": True}
        if tip:
            out["mkdir"] = tip
        return 200, out

    if want_list:
        st, _, raw = _dav("PROPFIND", folder + "/", user, pwd, headers={"Depth": "1"})
        if st in (404, 409) or (st < 300 and not _parse_propfind(raw)):
            alt = _legacy_folder(folder)
            if alt:
                st2, _, raw2 = _dav("PROPFIND", alt + "/", user, pwd, headers={"Depth": "1"})
                if st2 < 300 and _parse_propfind(raw2):
                    print("列目录：新目录为空，改用旧目录 /%s" % alt)
                    return 200, {"files": _parse_propfind(raw2)}
        if st in (404, 409):
            return 404, {"files": [], "error": "远程目录不存在，先备份一次即可创建"}
        if st == 401:
            return 401, {"error": "账号或密码错误（坚果云请使用「第三方应用密码」）"}
        if st >= 300:
            return st, {"error": "HTTP %s" % st}
        return 200, {"files": _parse_propfind(raw)}

    if method in ("PUT", "POST"):
        hist = _hist_name(folder)
        for target in (path, hist):
            st, _, _ = _dav("PUT", target, user, pwd, body=body,
                            headers={"Content-Type": "application/json"})
            if st in (404, 409):
                _ensure_dir("/" + target, user, pwd)
                st, _, _ = _dav("PUT", target, user, pwd, body=body,
                                headers={"Content-Type": "application/json"})
            if st == 401:
                return 401, {"error": "账号或密码错误（坚果云请使用「第三方应用密码」）"}
            if st >= 300:
                return st, {"error": "HTTP %s" % st}
        if keep > 0:
            try:
                _prune("/" + path, user, pwd, keep)
            except DavError:
                pass
        return 200, {"ok": True}

    if method in ("GET", "HEAD"):
        st, _, raw = _dav("GET", path, user, pwd)
        if st in (404, 409):
            alt = _legacy_path(path)
            if alt:
                st2, _, raw2 = _dav("GET", alt, user, pwd)
                if st2 == 200:
                    print("恢复：新目录无此文件，已从旧目录 /%s 取回" % alt)
                    st, raw = st2, raw2
        if st in (404, 409):
            return 404, {"error": "云端暂无备份文件：%s" % orig}
        if st == 401:
            return 401, {"error": "账号或密码错误（坚果云请使用「第三方应用密码」）"}
        if st >= 300:
            return st, {"error": "HTTP %s" % st}
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return 502, {"error": "云端文件不是有效的备份 JSON"}
        if not isinstance(data, dict):
            return 502, {"error": "云端备份格式不正确"}
        return 200, data

    st, _, _ = _dav(method, path, user, pwd, body=body)
    if st == 401:
        return 401, {"error": "账号或密码错误（坚果云请使用「第三方应用密码」）"}
    if st >= 300:
        return st, {"error": "HTTP %s" % st}
    return 200, {"ok": True}


# --------------------------------------------------------------------------
# HTTP 服务
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "amhub/%s" % VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _touch(self):
        with State.lock:
            State.last_seen = time.time()

    def do_GET(self):
        self._route("GET")

    def do_HEAD(self):
        self._route("HEAD")

    def do_PUT(self):
        self._route("PUT")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")

    def do_PROPFIND(self):
        self._route("PROPFIND")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET,HEAD,PUT,POST,DELETE,PROPFIND,OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _route(self, method):
        path = urlparse(self.path).path
        self._touch()

        if path in ("/", "/index.html"):
            with State.lock:
                State.served = True
            self._send(200, HTML, "text/html; charset=utf-8")
            return
        if path in ("/ledger.png", "/favicon.ico", "/icon.png"):
            if ICON:
                self._send(200, ICON, "image/png")
            else:
                self._send(404, {"error": "no icon"})
            return
        if path == "/ping":
            self._send(200, "pong", "text/plain; charset=utf-8")
            return
        if path == "/health":
            self._send(200, {"app": APP_NAME, "version": VERSION, "ok": True})
            return
        if path == "/ns":
            n = 0
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = 0
            body = self.rfile.read(n) if n else None
            try:
                status, data = dav_relay(
                    method,
                    self.headers.get("X-NS-Path") or "/",
                    (self.headers.get("X-NS-User") or "").strip(),
                    (self.headers.get("X-NS-Pass") or "").strip(),
                    body,
                    self.headers,
                )
            except DavError as e:
                status, data = e.status, {"error": e.msg}
            except Exception as e:                      # noqa: BLE001
                status, data = 500, {"error": "中转异常：%s" % e}
            self._send(status, data)
            return
        self._send(404, {"error": "not found"})


# --------------------------------------------------------------------------
# 窗口 & 生命周期
# --------------------------------------------------------------------------
CHROMES = [
    "chromium", "chromium-browser", "google-chrome", "google-chrome-stable",
    "microsoft-edge", "microsoft-edge-stable", "brave-browser", "vivaldi-stable",
    "chromium-freeworld", "ungoogled-chromium",
]


def _which(name):
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = os.path.join(d, name)
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def data_dir():
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    d = os.path.join(base, APP_NAME)
    os.makedirs(d, exist_ok=True)
    return d


def _port_file():
    return os.path.join(data_dir(), "last_port")


def _read_last_port():
    try:
        with open(_port_file(), "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except Exception:                                  # noqa: BLE001
        return 0


def _write_last_port(port):
    try:
        with open(_port_file(), "w", encoding="utf-8") as f:
            f.write(str(port))
    except Exception:                                  # noqa: BLE001
        pass


def open_window(url, mode="auto"):
    if mode == "none":
        return "none"
    if mode in ("auto", "chromium"):
        for name in CHROMES:
            exe = _which(name)
            if not exe:
                continue
            profile = os.path.join(data_dir(), "profile")
            os.makedirs(profile, exist_ok=True)
            args = [exe, "--app=" + url, "--window-size=" + WINDOW_SIZE,
                    "--user-data-dir=" + profile,
                    "--no-first-run", "--no-default-browser-check",
                    "--disable-features=Translate", "--class=" + APP_NAME]
            try:
                subprocess.Popen(args, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
                return exe
            except OSError:
                continue
        if mode == "chromium":
            return "manual"
    try:
        webbrowser.open(url, new=1)
        return "browser"
    except Exception:                                  # noqa: BLE001
        return "manual"


def watchdog():
    started = time.time()
    while not State.stop.wait(5):
        now = time.time()
        with State.lock:
            seen, served = State.last_seen, State.served
        if served and now - seen > IDLE_LIMIT:
            State.stop.set()
            os._exit(0)
        if not served and now - started > BOOT_GRACE:
            State.stop.set()
            os._exit(0)


def already_running(port):
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open("http://127.0.0.1:%d/health" % port, timeout=1.5) as r:
            data = json.loads(r.read().decode("utf-8"))
            return data.get("app") == APP_NAME
    except Exception:                                  # noqa: BLE001
        return False


def port_free(port):
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def pick_port(preferred):
    if port_free(preferred):
        return preferred, False
    p = preferred
    while p < 65000:
        p += 1
        if port_free(p):
            return p, True
    raise SystemExit("没有可用端口")


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:                                  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(prog=APP_NAME, description="资产管理中枢 %s" % VERSION)
    ap.add_argument("--port", type=int, default=None,
                    help="默认 %d；改端口等于换一份本地数据" % DEFAULT_PORT)
    ap.add_argument("--browser", default=os.environ.get("LEDGER_BROWSER") or "auto",
                    choices=["auto", "chromium", "default", "none"])
    ap.add_argument("--no-open", action="store_true", help="只启动服务，不开窗口")
    ap.add_argument("--version", action="store_true")
    args = ap.parse_args()

    if args.version:
        print("%s %s" % (APP_NAME, VERSION))
        return

    env_port = os.environ.get("LEDGER_PORT")
    explicit = args.port is not None or bool(env_port)
    port = args.port if args.port is not None else int(env_port or DEFAULT_PORT)

    if already_running(port):
        url = "http://127.0.0.1:%d/" % port
        print("资产管理中枢 已在运行：%s" % url)
        open_window(url, "none" if (args.no_open or args.browser == "none") else args.browser)
        return

    last = _read_last_port()
    if not explicit and last and last != port and already_running(last):
        url = "http://127.0.0.1:%d/" % last
        print("资产管理中枢 已在运行：%s（端口 %d 被占用，之前顺延到此）" % (url, port))
        open_window(url, "none" if (args.no_open or args.browser == "none") else args.browser)
        return

    wanted = port
    port, shifted = pick_port(wanted)
    if shifted:
        print("!" * 62)
        print("注意：端口 %d 被其它程序占用，资产管理中枢 已改用 %d。" % (wanted, port))
        print("      数据是按「端口」分开存的 —— 这个端口上看到的是空数据，")
        print("      不是原来的数据。想让旧数据回来：先关掉占用 %d 的程序再启动。" % wanted)
        print("!" * 62)
    url = "http://127.0.0.1:%d/" % port

    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as e:
        raise SystemExit("启动失败：%s" % e)
    httpd.daemon_threads = True
    _write_last_port(port)

    threading.Thread(target=watchdog, daemon=True).start()

    print("资产管理中枢 %s  —  %s" % (VERSION, url))
    print("窗口关闭后自动退出；数据保存在本机浏览器（origin: 127.0.0.1:%d）" % port)
    if not (args.no_open or args.browser == "none"):
        print("窗口尺寸 %s（与平板竖屏 768×1024 一致，可用 LEDGER_WINDOW 覆盖）" % WINDOW_SIZE)
        print("顶部已留白（Linux 无状态栏，抵消平板竖屏的贴顶规则）")
        how = open_window(url, args.browser)
        if how == "manual":
            print("没找到可用浏览器，请手动访问：%s" % url)

    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
