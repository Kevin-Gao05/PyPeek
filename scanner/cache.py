"""
本地扫描缓存模块。

扫描结果自动持久化到本地 JSON 文件，下次启动直接渲染缓存数据，
用户手动刷新才重扫。同时为其他 ticket（欢迎弹窗、onboarding）
提供首次启动检测能力。
"""

import os
import json
import platform

IS_WINDOWS = platform.system() == "Windows"


def get_cache_dir():
    """获取缓存目录路径（平台感知）。"""
    if IS_WINDOWS:
        appdata = os.environ.get("APPDATA", os.path.expanduser("~"))
        return os.path.join(appdata, "PyPeek")
    else:
        # XDG 兼容：Linux/macOS 使用 ~/.config/PyPeek
        return os.path.join(os.path.expanduser("~"), ".config", "PyPeek")


def get_cache_path():
    """获取缓存文件完整路径。"""
    return os.path.join(get_cache_dir(), "cache.json")


def load_cache():
    """
    加载缓存的扫描结果。

    返回:
        dict | None — 有效缓存数据；None 表示无缓存、缓存损坏或首次启动。
        调用方可通过返回 None 判断是否为首次启动。
    """
    cache_path = get_cache_path()
    if not os.path.isfile(cache_path):
        return None

    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    # 验证必需字段 — 缺少任何字段视为损坏
    required = ("scanned_at", "pythons", "venvs", "pip_cache")
    if not all(k in data for k in required):
        return None

    return data


def save_cache(data):
    """
    保存扫描结果到缓存文件。

    data 应包含:
        scanned_at: ISO 时间戳
        scan_summary: {drives_scanned, files_checked, duration_seconds}
        pythons: Python 安装列表
        venvs: 虚拟环境列表
        pip_cache: pip 缓存数据
    """
    cache_dir = get_cache_dir()
    os.makedirs(cache_dir, exist_ok=True)

    cache_path = get_cache_path()
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
