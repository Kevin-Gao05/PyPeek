"""
pip 包缓存发现模块。

解析 pip cache info 获取汇总数据，遍历缓存目录获取分类详情。
pip 不可用时降级为纯文件系统扫描。
"""

import os
import re
import subprocess
import platform

IS_WINDOWS = platform.system() == "Windows"


def discover_pip_cache(on_progress=None):
    """
    发现 pip 包缓存，返回汇总及分类数据。

    返回: {"path": "...", "total_size_mb": 0, "categories": [...]}
    """
    _report(on_progress, "pip_cache", {
        "phase": "pip 缓存扫描",
        "detail": "正在检查 pip 缓存…",
        "progress": 0.0,
    })

    cache_path = _get_cache_path()
    if not cache_path or not os.path.isdir(cache_path):
        _report(on_progress, "pip_cache", {
            "phase": "pip 缓存扫描完成",
            "detail": "未发现 pip 缓存目录",
            "progress": 1.0,
            "pip_cache": {"path": "", "total_size_mb": 0, "categories": []},
        })
        return {"path": "", "total_size_mb": 0, "categories": []}

    # 尝试 pip cache info
    pip_info = _parse_pip_cache_info()

    # 按目录分类统计
    categories = _scan_cache_categories(cache_path, pip_info)

    total = sum(c["size_mb"] for c in categories)

    result = {
        "path": cache_path,
        "total_size_mb": round(total, 1),
        "categories": categories,
    }

    _report(on_progress, "pip_cache", {
        "phase": "pip 缓存扫描完成",
        "detail": f"pip 缓存共 {result['total_size_mb']} MB，{len(categories)} 个分类",
        "progress": 1.0,
        "pip_cache": result,
    })

    return result


# ── 路径 ──────────────────────────────────────────────────────────────

def _get_cache_path():
    """获取 pip 缓存目录路径。"""
    if IS_WINDOWS:
        localappdata = os.environ.get("LOCALAPPDATA", "")
        if localappdata:
            return os.path.join(localappdata, "pip", "cache")
    else:
        home = os.path.expanduser("~")
        return os.path.join(home, ".cache", "pip")
    return ""


# ── pip cache info 解析 ───────────────────────────────────────────────

def _parse_pip_cache_info():
    """执行 pip cache info，解析出各项数值。"""
    info = {}
    try:
        out = subprocess.run(
            ["pip", "cache", "info"], capture_output=True, text=True, timeout=10
        )
        text = out.stdout
    except Exception:
        try:
            # 尝试 python -m pip
            out = subprocess.run(
                ["python3", "-m", "pip", "cache", "info"],
                capture_output=True, text=True, timeout=10,
            )
            text = out.stdout
        except Exception:
            return info

    # 解析各行
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue

        # "Package index page cache size: 298 kB"
        m = re.match(r".+size:\s*([\d.]+)\s*(\w+)", line, re.IGNORECASE)
        if m:
            info["http_size_bytes"] = _parse_bytes(float(m.group(1)), m.group(2))

        # "Number of HTTP files: 12"
        m = re.match(r"Number of HTTP files:\s*(\d+)", line, re.IGNORECASE)
        if m:
            info["http_file_count"] = int(m.group(1))

        # "Locally built wheels size: 0 bytes"
        m = re.match(r"Locally built wheels size:\s*([\d.]+)\s*(\w+)", line, re.IGNORECASE)
        if m:
            info["wheels_size_bytes"] = _parse_bytes(float(m.group(1)), m.group(2))

        # "Number of locally built wheels: 0"
        m = re.match(r"Number of locally built wheels:\s*(\d+)", line, re.IGNORECASE)
        if m:
            info["wheels_file_count"] = int(m.group(1))

    return info


def _parse_bytes(value, unit):
    """将带单位的数值转为字节。"""
    unit = unit.lower().rstrip("s")  # "bytes" → "byte"
    multipliers = {"byte": 1, "kb": 1024, "mb": 1024**2, "gb": 1024**3}
    return int(value * multipliers.get(unit, 1))


# ── 目录分类扫描 ─────────────────────────────────────────────────────

def _scan_cache_categories(cache_path, pip_info):
    """遍历缓存目录，按子目录分类统计。"""
    categories = []
    category_meta = {
        "http": {
            "name": "下载缓存",
            "description": "pip install 时下载的包文件，删了也不影响已安装的包",
        },
        "http-v2": {
            "name": "下载缓存 (新版)",
            "description": "新版 pip 格式的下载缓存，同样可以安全清理",
        },
        "wheels": {
            "name": "本地编译缓存",
            "description": "从源码编译生成的包文件，删了下次装包时会重新编译",
        },
        "selfcheck": {
            "name": "pip 自检记录",
            "description": "pip 检查自己有没有新版本的记录，非常小，不用管它",
        },
    }

    try:
        entries = os.listdir(cache_path)
    except PermissionError:
        return categories

    for entry in sorted(entries):
        full = os.path.join(cache_path, entry)
        if not os.path.isdir(full):
            continue

        size_mb, file_count = _dir_stats(full)
        if size_mb == 0 and file_count == 0:
            continue

        meta = category_meta.get(entry, {
            "name": entry,
            "description": "",
        })

        categories.append({
            "name": meta["name"],
            "path": full,
            "size_mb": size_mb,
            "file_count": file_count,
            "description": meta["description"],
        })

    return categories


def _dir_stats(path):
    """遍历目录，返回 (size_mb, file_count)。"""
    total = 0
    count = 0
    max_files = 5000
    try:
        for _dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                try:
                    total += os.path.getsize(os.path.join(_dirpath, f))
                    count += 1
                    if count >= max_files:
                        return (round(total / (1024 * 1024), 1), count)
                except OSError:
                    pass
    except Exception:
        pass
    return (round(total / (1024 * 1024), 1), count)


# ── 辅助 ──────────────────────────────────────────────────────────────

def get_cache_root():
    """返回 pip 缓存根目录路径（公开接口）。"""
    return _get_cache_path()


def get_dir_stats(path):
    """获取目录统计信息，返回 (size_mb, file_count)（公开接口）。"""
    return _dir_stats(path)


def _report(callback, phase, data):
    if callback:
        try:
            callback(phase, data)
        except Exception:
            pass
