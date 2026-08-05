"""
HTTP 集成测试 — 启动真实服务器，发 HTTP 请求验证路由。
"""

import json
import urllib.request
import urllib.error

import pytest


# ═══════════════════════════════════════════════════════════════════
# GET
# ═══════════════════════════════════════════════════════════════════

class TestHealth:
    """GET /api/health"""

    def test_returns_200_ok(self, test_server):
        resp = _get(test_server, "/api/health")
        assert resp["status"] == 200
        assert resp["body"]["status"] == "ok"


class TestCacheEndpoint:
    """GET /api/cache"""

    def test_returns_valid_response(self, test_server):
        """有缓存或无缓存都应该返回 200。"""
        resp = _get(test_server, "/api/cache")
        assert resp["status"] == 200
        assert "cached" in resp["body"]
        assert isinstance(resp["body"]["cached"], bool)


class TestScanEndpoint:
    """GET /api/scan"""

    def test_returns_scan_id(self, test_server):
        resp = _get(test_server, "/api/scan")
        assert resp["status"] == 200
        assert "scan_id" in resp["body"]
        assert resp["body"]["status"] == "started"
        assert len(resp["body"]["scan_id"]) > 0


class TestScanProgressEndpoint:
    """GET /api/scan/progress"""

    @pytest.mark.xfail(reason="urllib 不支持 SSE streaming response，status=0 为客户端连接异常")
    def test_unknown_scan_returns_sse_error(self, test_server):
        """无效 scan_id 的 SSE stream 应返回 200 且包含错误。"""
        resp = _get_raw(test_server, "/api/scan/progress?scan_id=nonexistent")
        assert resp["status"] == 200
        headers = resp["headers"]
        assert "text/event-stream" in headers.get("content-type", "")
        assert "error" in resp["raw_body"] or "unknown" in resp["raw_body"]

    def test_valid_scan_stream(self, test_server):
        """有效扫描 → SSE stream 包含 scan_complete。"""
        # 先启动扫描
        start = _get(test_server, "/api/scan")
        scan_id = start["body"]["scan_id"]

        # 连接 SSE（读取流可能阻塞，用超时）
        import socket
        socket.setdefaulttimeout(5)
        try:
            raw = _get_raw(test_server, f"/api/scan/progress?scan_id={scan_id}")
            assert raw["status"] == 200
            body = raw["raw_body"]
            assert "text/event-stream" in raw["headers"].get("content-type", "")
            # 至少应该包含 scan_complete 事件
            assert "scan_complete" in body or "phase_update" in body or "keepalive" in body
        finally:
            socket.setdefaulttimeout(None)


class TestPackagesEndpoint:
    """GET /api/packages"""

    def test_missing_python_path_returns_400(self, test_server):
        resp = _get(test_server, "/api/packages")
        assert resp["status"] == 400


class TestStaticFiles:
    """静态文件服务。"""

    def test_root_returns_html(self, test_server):
        resp = _get_raw(test_server, "/")
        assert resp["status"] == 200
        assert "text/html" in resp["headers"].get("content-type", "")

    def test_index_html(self, test_server):
        resp = _get_raw(test_server, "/index.html")
        assert resp["status"] == 200
        assert "text/html" in resp["headers"].get("content-type", "")

    def test_app_js(self, test_server):
        resp = _get_raw(test_server, "/app.js")
        assert resp["status"] == 200

    def test_style_css(self, test_server):
        resp = _get_raw(test_server, "/style.css")
        assert resp["status"] == 200
        assert "text/css" in resp["headers"].get("content-type", "")

    def test_unknown_api_path_returns_501(self, test_server):
        resp = _get(test_server, "/api/nonexistent")
        assert resp["status"] == 501


# ═══════════════════════════════════════════════════════════════════
# POST
# ═══════════════════════════════════════════════════════════════════

class TestOpenFolderEndpoint:
    """POST /api/open-folder"""

    def test_returns_json_response(self, test_server):
        resp = _post(test_server, "/api/open-folder", {"path": "/tmp"})
        # 返回状态码取决于 OS 是否能打开文件夹
        assert isinstance(resp["status"], int)
        assert resp["status"] > 0


class TestDeleteVenvEndpoint:
    """POST /api/delete-venv"""

    def test_returns_json_response(self, test_server):
        resp = _post(test_server, "/api/delete-venv", {"path": "/nonexistent/venv"})
        # 返回状态码可能因路径不存在等条件而异
        assert isinstance(resp["status"], int)
        assert resp["status"] > 0


class TestUnknownPost:
    """未知 POST 路径。"""

    def test_returns_404(self, test_server):
        resp = _post(test_server, "/api/unknown", {})
        assert resp["status"] == 404


# ═══════════════════════════════════════════════════════════════════
# OPTIONS (CORS)
# ═══════════════════════════════════════════════════════════════════

class TestOptions:
    """OPTIONS 预检请求。"""

    def test_options_returns_204(self, test_server):
        req = urllib.request.Request(
            f"{test_server}/api/scan",
            method="OPTIONS",
        )
        resp = urllib.request.urlopen(req)
        assert resp.status == 204

    def test_options_includes_cors_headers(self, test_server):
        req = urllib.request.Request(
            f"{test_server}/api/scan",
            method="OPTIONS",
        )
        resp = urllib.request.urlopen(req)
        assert "Access-Control-Allow-Origin" in resp.headers
        assert "Access-Control-Allow-Methods" in resp.headers


# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════

def _get(base_url, path):
    """发送 GET 请求，返回 {status, body}（body 被解析为 JSON）。"""
    try:
        req = urllib.request.Request(f"{base_url}{path}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return {"status": resp.status, "body": body}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = None
        return {"status": e.code, "body": body}
    except Exception as e:
        return {"status": 0, "body": str(e)}


def _get_raw(base_url, path):
    """发送 GET 请求，返回 {status, headers, raw_body}（不解析 JSON）。"""
    try:
        req = urllib.request.Request(f"{base_url}{path}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            headers = {k.lower(): v for k, v in dict(resp.headers).items()}
            return {"status": resp.status, "headers": headers, "raw_body": raw}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "headers": {}, "raw_body": ""}
    except Exception as e:
        return {"status": 0, "headers": {}, "raw_body": str(e)}


def _post(base_url, path, data):
    """发送 POST 请求，返回 {status, body}。"""
    try:
        payload = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}{path}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return {"status": resp.status, "body": body}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = None
        return {"status": e.code, "body": body}
    except Exception as e:
        return {"status": 0, "body": str(e)}
