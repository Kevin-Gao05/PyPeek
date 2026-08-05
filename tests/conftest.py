"""
pytest 共享 fixtures。
"""

import json
import socket
import sys
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

# 确保项目根目录在 sys.path 中
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def temp_cache_dir(tmp_path, monkeypatch):
    """将缓存目录重定向到临时路径，避免污染真实缓存。"""
    import scanner.cache as cache_mod

    cache_subdir = tmp_path / "PyPeek"
    monkeypatch.setattr(cache_mod, "get_cache_dir", lambda: str(cache_subdir))
    monkeypatch.setattr(cache_mod, "get_cache_path",
                        lambda: str(cache_subdir / "cache.json"))
    return str(cache_subdir)


@pytest.fixture
def sse_manager():
    """返回一个全新的 SSEManager 实例。"""
    from server.sse import SSEManager
    return SSEManager()


def _find_free_port():
    """找到一个可用的 TCP 端口。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def test_server():
    """启动一个测试用的 HTTP 服务器，返回 base URL。module 级别复用。"""
    from server.app import create_app

    port = _find_free_port()
    app = create_app(host="127.0.0.1", port=port)
    t = threading.Thread(target=app.run, daemon=True)
    t.start()
    time.sleep(0.1)  # 等待服务器就绪

    yield f"http://127.0.0.1:{port}"

    app.shutdown()
    t.join(timeout=2)


@pytest.fixture
def valid_cache_data():
    """返回一份有效的缓存数据样例。"""
    return {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "scan_summary": {
            "drives_scanned": ["C:\\"],
            "files_checked": 1234,
            "duration_seconds": 5.6,
        },
        "pythons": [
            {
                "path": "C:\\Python310\\python.exe",
                "version": "3.10.11",
                "source": "python.org",
                "package_count": 42,
                "site_packages_size_mb": 156.3,
            },
        ],
        "venvs": [
            {
                "path": "C:\\Users\\test\\venv",
                "python_version": "3.10.11",
                "home_python": "C:\\Python310\\python.exe",
                "total_size_mb": 89.2,
                "package_count": 15,
                "last_modified": "2026-08-01T12:00:00",
            },
        ],
        "pip_cache": {
            "path": "C:\\Users\\test\\AppData\\Local\\pip\\cache",
            "total_size_mb": 250.0,
            "categories": [],
        },
    }


@pytest.fixture
def expired_cache_data():
    """返回一份过期（8 天前）的缓存数据。"""
    return {
        "scanned_at": (datetime.now(timezone.utc) - timedelta(days=8)).isoformat(),
        "scan_summary": {"drives_scanned": [], "files_checked": 0, "duration_seconds": 0},
        "pythons": [],
        "venvs": [],
        "pip_cache": {"path": "", "total_size_mb": 0, "categories": []},
    }


@pytest.fixture
def write_cache_file(temp_cache_dir, valid_cache_data):
    """在临时缓存目录中写入有效缓存文件，返回文件路径。"""
    from scanner.cache import get_cache_path
    cache_path = get_cache_path()
    Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(valid_cache_data, f, ensure_ascii=False, indent=2)
    return cache_path
