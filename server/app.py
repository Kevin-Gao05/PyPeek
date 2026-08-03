"""
PyPeek HTTP 服务 — 基于标准库 ThreadingHTTPServer。

提供静态文件（HTML/CSS/JS）和 JSON/SSE API 端点。
不依赖任何第三方 Web 框架。
"""

import json
import os
import threading
import mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from scanner.pythons import discover_pythons
from scanner.venvs import discover_venvs
from scanner.pip_cache import discover_pip_cache
from scanner.site_packages import get_packages, check_uninstall_safety, uninstall_package
from server.sse import sse_manager

# 并发扫描锁（同一时间只允许一个扫描运行）
_scan_lock = threading.Lock()

STATIC_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "static")
)

# Python 可执行文件的合法文件名（防止传入 calc.exe 等非 Python 程序）
VALID_PYTHON_NAMES = {
    "python.exe", "python3.exe", "pythonw.exe",  # Windows
    "python", "python3", "python3.",              # Linux/macOS (python3.xx)
}


def _is_valid_python_exe(path):
    """校验路径指向的是合法的 Python 可执行文件。"""
    # 同时处理 Windows (\\) 和 Linux (/) 路径分隔符
    basename = os.path.basename(path).lower()
    if not basename or basename == path.lower():
        # 跨平台回退：手动提取文件名
        for sep in ("/", "\\"):
            if sep in path:
                basename = path.rsplit(sep, 1)[-1].lower()
                break

    # 精确匹配
    if basename in VALID_PYTHON_NAMES:
        return True

    # Linux: python3.12, python3.11, python3.10 等
    if basename.startswith("python3.") and basename[8:].isdigit():
        return True
    if basename.startswith("python.") and basename[7:].isdigit():
        return True  # python.8 等

    return False


class RequestHandler(BaseHTTPRequestHandler):
    """PyPeek API 路由 + 静态文件请求处理器。"""

    # ── 路由 ────────────────────────────────────────────────────────

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == "/api/health":
            self._send_json({"status": "ok"})

        elif path == "/api/scan":
            self._handle_scan()

        elif path == "/api/scan/progress":
            self._handle_sse_stream(params)

        elif path == "/api/packages":
            self._handle_packages(params)

        elif path.startswith("/api/"):
            self._send_json({"error": "not implemented"}, status=501)

        else:
            self._serve_static(path)

    def do_POST(self):
        """处理 POST 请求（卸载等）。"""
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/uninstall":
            self._handle_uninstall()
        elif path == "/api/uninstall/preview":
            self._handle_uninstall_preview()
        elif path == "/api/open-folder":
            self._handle_open_folder()
        elif path == "/api/delete-venv":
            self._handle_delete_venv()
        else:
            self._send_json({"error": "not found"}, status=404)

    def do_OPTIONS(self):
        """处理 CORS 预检请求。"""
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    # ── API 处理器 ─────────────────────────────────────────────────

    def _handle_scan(self):
        """GET /api/scan — 启动一次完整扫描，立即返回 scan_id。"""
        # 速率限制：同一时间只允许一个扫描运行
        if _scan_lock.locked():
            self._send_json(
                {"error": "已有扫描正在运行，请等待完成后再试"}, status=429
            )
            return

        scan_id = sse_manager.create_scan()

        def run_scan():
            try:
                _scan_lock.acquire()
                def on_progress(phase, data):
                    sse_manager.push(scan_id, "phase_update", data)

                pythons = discover_pythons(on_progress=on_progress)
                venvs = discover_venvs(on_progress=on_progress)
                pip_cache = discover_pip_cache(on_progress=on_progress)

                # 最终推送
                sse_manager.push(scan_id, "phase_update", {
                    "phase": "pythons",
                    "detail": f"快速扫描完成 — 共发现 {len(pythons)} 个 Python 安装",
                    "progress": 1.0,
                    "pythons": pythons,
                })
                sse_manager.push(scan_id, "scan_complete", {
                    "done": True,
                    "pythons": pythons,
                    "venvs": venvs,
                    "pip_cache": pip_cache,
                    "conda_envs": None,
                })
            except Exception as exc:
                sse_manager.push(scan_id, "scan_error", {
                    "error": str(exc),
                })
            finally:
                sse_manager.finish_scan(scan_id)
                _scan_lock.release()

        threading.Thread(target=run_scan, daemon=True).start()
        self._send_json({"scan_id": scan_id, "status": "started"})

    def _handle_sse_stream(self, params):
        """GET /api/scan/progress?scan_id=... — SSE 事件流。"""
        scan_ids = params.get("scan_id", [])
        if not scan_ids:
            self._send_json({"error": "缺少 scan_id 参数"}, status=400)
            return

        scan_id = scan_ids[0]

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._cors_headers()
        self.end_headers()

        try:
            for payload in sse_manager.subscribe(scan_id):
                self.wfile.write(payload.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # 客户端断开连接

    def _handle_packages(self, params):
        """GET /api/packages?python_path=... — 获取指定 Python 的包列表。"""
        python_paths = params.get("python_path", [])
        if not python_paths:
            self._send_json(
                {"error": "缺少 python_path 参数"}, status=400
            )
            return

        python_path = python_paths[0]
        if not os.path.isfile(python_path):
            self._send_json(
                {"error": f"Python 不存在: {python_path}"}, status=404
            )
            return

        if not _is_valid_python_exe(python_path):
            self._send_json(
                {"error": "python_path 不是合法的 Python 可执行文件"}, status=400
            )
            return

        try:
            packages = get_packages(python_path)
            self._send_json({"python_path": python_path, "packages": packages})
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=500)

    def _handle_uninstall_preview(self):
        """POST /api/uninstall/preview — 卸载前安全检查（不执行）。"""
        body = self._read_body()
        if body is None:
            return

        python_path = body.get("python_path", "")
        package_name = body.get("package", "")

        if not python_path or not package_name:
            self._send_json(
                {"error": "缺少 python_path 或 package 参数"}, status=400
            )
            return

        if not os.path.isfile(python_path):
            self._send_json(
                {"error": f"Python 不存在: {python_path}"}, status=404
            )
            return

        if not _is_valid_python_exe(python_path):
            self._send_json(
                {"error": "python_path 不是合法的 Python 可执行文件"}, status=400
            )
            return

        try:
            result = check_uninstall_safety(python_path, package_name)
            self._send_json(result)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=500)

    def _handle_uninstall(self):
        """POST /api/uninstall — 执行卸载。"""
        body = self._read_body()
        if body is None:
            return

        python_path = body.get("python_path", "")
        package_name = body.get("package", "")
        force = body.get("force", False)

        if not python_path or not package_name:
            self._send_json(
                {"error": "缺少 python_path 或 package 参数"}, status=400
            )
            return

        if not os.path.isfile(python_path):
            self._send_json(
                {"error": f"Python 不存在: {python_path}"}, status=404
            )
            return

        if not _is_valid_python_exe(python_path):
            self._send_json(
                {"error": "python_path 不是合法的 Python 可执行文件"}, status=400
            )
            return

        try:
            # 先做安全检查
            safety = check_uninstall_safety(python_path, package_name)

            #  danger — 无条件拒绝
            if safety["level"] == "danger":
                self._send_json({
                    "ok": False,
                    "error": "BLOCKED",
                    "level": "danger",
                    "message": safety["message"],
                }, status=403)
                return

            #  warning — 需要 force 标志
            if safety["level"] == "warning" and not force:
                self._send_json({
                    "ok": False,
                    "error": "DEPENDENCY_CONFLICT",
                    "level": "warning",
                    "required_by": safety["required_by"],
                    "message": safety["message"],
                }, status=409)
                return

            # 执行卸载
            result = uninstall_package(python_path, package_name)
            if result["ok"]:
                self._send_json(result)
            else:
                self._send_json(result, status=500)

        except Exception as exc:
            self._send_json({"ok": False, "message": str(exc)}, status=500)

    def _handle_open_folder(self):
        """POST /api/open-folder — 在文件管理器中打开路径。"""
        import platform
        import subprocess as sp

        body = self._read_body()
        if body is None:
            return

        target = body.get("path", "")
        if not target:
            self._send_json({"error": "缺少 path 参数"}, status=400)
            return

        # 如果路径是文件，打开其所在目录
        if os.path.isfile(target):
            target = os.path.dirname(target)

        if not os.path.isdir(target):
            self._send_json({"error": f"路径不存在: {target}"}, status=404)
            return

        try:
            if platform.system() == "Windows":
                sp.Popen(["explorer", os.path.normpath(target)])
            elif platform.system() == "Darwin":
                sp.Popen(["open", target])
            else:
                sp.Popen(["xdg-open", target])
            self._send_json({"ok": True, "path": target})
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=500)

    def _handle_delete_venv(self):
        """POST /api/delete-venv — 删除虚拟环境目录。"""
        import shutil
        import stat as _stat

        body = self._read_body()
        if body is None:
            return

        target = body.get("path", "")
        if not target:
            self._send_json({"error": "缺少 path 参数"}, status=400)
            return

        norm = os.path.normpath(target)

        # 拒绝符号链接（防止通过 symlink 删除系统目录）
        try:
            if os.path.islink(norm):
                self._send_json({
                    "ok": False,
                    "error": "SYMLINK",
                    "message": "拒绝删除符号链接目录，仅允许删除真实目录。",
                }, status=403)
                return
        except OSError:
            pass

        if not os.path.isdir(norm):
            self._send_json({"error": f"路径不存在: {target}"}, status=404)
            return

        # 安全检查：必须有 pyvenv.cfg 才允许删除
        cfg = os.path.join(norm, "pyvenv.cfg")
        if not os.path.isfile(cfg):
            self._send_json({
                "ok": False,
                "error": "NOT_A_VENV",
                "message": "该目录不是虚拟环境（缺少 pyvenv.cfg），拒绝删除以防止误操作。",
            }, status=403)
            return

        # ── 执行删除（多策略）─────────────────────────────────────

        deleted = False
        errors = []

        # 策略 1：Python shutil.rmtree（带 onerror 修复权限）
        def _onerror(_func, path, _excinfo):
            if os.path.islink(path):
                os.unlink(path)
                return
            try:
                os.chmod(path, _stat.S_IWRITE)
                if os.path.isfile(path):
                    os.unlink(path)
                elif os.path.isdir(path):
                    os.rmdir(path)
            except Exception as e:
                errors.append(f"{path}: {e}")

        try:
            shutil.rmtree(norm, onerror=_onerror)
        except Exception as e:
            errors.append(str(e))

        # 验证：目录是否真的被删除了？
        if not os.path.isdir(norm):
            deleted = True
        elif not errors:
            # rmtree 没报错但目录还在 — 尝试 Windows 原生命令
            import platform as _pf
            if _pf.system() == "Windows":
                try:
                    subprocess.run(
                        ["cmd", "/c", "rmdir", "/s", "/q", norm],
                        capture_output=True, timeout=30,
                    )
                    if not os.path.isdir(norm):
                        deleted = True
                except Exception as e:
                    errors.append(f"rmdir fallback: {e}")
            else:
                # Linux/macOS fallback
                try:
                    subprocess.run(
                        ["rm", "-rf", norm],
                        capture_output=True, timeout=30,
                    )
                    if not os.path.isdir(norm):
                        deleted = True
                except Exception as e:
                    errors.append(f"rm fallback: {e}")

        if deleted:
            self._send_json({"ok": True, "message": f"已删除: {norm}"})
        else:
            detail = "; ".join(errors) if errors else "目录删除后仍然存在（可能被其他进程占用）"
            self._send_json({
                "ok": False,
                "message": f"删除失败: {detail}",
            }, status=500)

    def _read_body(self):
        """读取 POST 请求体并解析为 JSON。"""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._send_json({"error": "请求体不能为空"}, status=400)
            return None
        try:
            raw = self.rfile.read(content_length)
            return json.loads(raw)
        except (json.JSONDecodeError, Exception) as exc:
            self._send_json({"error": f"无效的 JSON: {exc}"}, status=400)
            return None

    # ── 辅助方法 ────────────────────────────────────────────────────

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        # 仅允许本地来源（pywebview 窗口 + 本地浏览器开发）
        origin = self.headers.get("Origin", "")
        allowed = {
            "",  # 无 Origin 头（pywebview 直连）
            "http://127.0.0.1:8080",
            "http://localhost:8080",
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "null",  # file:// 协议
        }
        if origin in allowed or origin.startswith("http://127.0.0.1") or origin.startswith("http://localhost"):
            self.send_header("Access-Control-Allow-Origin", origin if origin else "*")
        else:
            # 拒绝外部来源
            self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:8080")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _serve_static(self, path):
        # 根路径默认返回 index.html
        if path == "/":
            path = "/index.html"

        # 安全检查：确保请求路径不逃逸出 STATIC_DIR
        requested = os.path.normpath(
            os.path.join(STATIC_DIR, path.lstrip("/"))
        )
        if not requested.startswith(STATIC_DIR):
            self.send_error(403, "Forbidden")
            return

        if not os.path.isfile(requested):
            self.send_error(404, "Not found")
            return

        content_type, _ = mimetypes.guess_type(requested)
        if content_type is None:
            content_type = "application/octet-stream"

        with open(requested, "rb") as f:
            body = f.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        """屏蔽 http.server 默认的 stderr 日志。"""
        pass


class Server:
    """封装 ThreadingHTTPServer，作为 PyPeek 后端服务。"""

    def __init__(self, host="127.0.0.1", port=8080):
        self.host = host
        self.port = port
        self._httpd = None

    def run(self):
        self._httpd = ThreadingHTTPServer(
            (self.host, self.port), RequestHandler
        )
        print(f"PyPeek 服务已启动 → http://{self.host}:{self.port}")
        try:
            self._httpd.serve_forever()
        except KeyboardInterrupt:
            pass

    def shutdown(self):
        if self._httpd:
            self._httpd.shutdown()


def create_app(host="127.0.0.1", port=8080):
    """工厂函数 — 返回一个可直接运行的 Server 实例。"""
    return Server(host, port)
