"""
Python 安装发现模块。

快速路径（<1s）：PATH 查找 + Windows 注册表。
深度扫描（后台）：文件系统遍历搜索 python.exe。
"""

import os
import sys
import json
import glob
import shutil
import subprocess
import platform
from pathlib import Path

IS_WINDOWS = platform.system() == "Windows"


def _deduplicate_paths(paths):
    """Deduplicate executable paths by resolving symlinks to canonical form."""
    seen = set()
    result = []
    for p in paths:
        key = os.path.normcase(os.path.realpath(p))
        if key not in seen and os.path.isfile(p):
            seen.add(key)
            result.append(p)
    return result


def discover_pythons(on_progress=None):
    """
    发现本机所有 Python 安装。

    on_progress(phase: str, data: dict) — 每发现一个 Python 或阶段完成时回调。
    返回: [{"path": "...", "version": "...", "source": "...", ...}, ...]
    """
    results = []

    # ── 阶段 A：快速扫描 ───────────────────────────────────────────
    _report(on_progress, "pythons", {
        "phase": "快速扫描",
        "detail": "正在 PATH 中查找 Python…",
        "progress": 0.0,
    })

    exe_paths = _scan_path()

    if IS_WINDOWS:
        exe_paths.extend(_scan_registry())
    else:
        exe_paths.extend(_scan_common_paths())

    # 去重（resolve symlinks to avoid e.g. python3 and python3.14 duplicates）
    unique = _deduplicate_paths(exe_paths)

    # 逐个获取详情
    total = len(unique)
    for i, exe in enumerate(unique):
        try:
            info = _get_python_info(exe)
            results.append(info)
            _report(on_progress, "pythons", {
                "phase": "快速扫描",
                "detail": f"发现 Python {info['version']} ({info['source']})",
                "progress": (i + 1) / max(total, 1),
                "pythons": list(results),
            })
        except Exception:
            continue

    _report(on_progress, "pythons", {
        "phase": "快速扫描完成",
        "detail": f"共发现 {len(results)} 个 Python 安装",
        "progress": 1.0,
        "pythons": list(results),
    })

    # ── 阶段 B：深度扫描（后台，Phase 7 完善）─────────────────────
    # TODO: 文件系统遍历搜索散落的 python.exe
    # _deep_scan(on_progress, results, seen)

    # ── 重复检测 ────────────────────────────────────────────────────
    _mark_python_duplicates(results)

    return results


# ── 数据源 ────────────────────────────────────────────────────────────

def _scan_path():
    """通过 PATH 环境变量查找 Python 可执行文件。"""
    found = []
    names = ["python", "python3"] if not IS_WINDOWS else ["python.exe", "python3.exe"]

    for name in names:
        path = shutil.which(name)
        if path and os.path.isfile(path):
            found.append(path)

    # Windows: where python 可能返回多个结果
    if IS_WINDOWS:
        for cmd in ["python", "python3"]:
            try:
                out = subprocess.run(
                    ["where", cmd], capture_output=True, text=True, timeout=5
                )
                for line in out.stdout.strip().split("\n"):
                    line = line.strip()
                    if line and os.path.isfile(line):
                        found.append(line)
            except Exception:
                pass

    return found


def _scan_registry():
    """Windows 注册表查找 Python 安装。"""
    found = []
    try:
        import winreg
        for root, label in [(winreg.HKEY_LOCAL_MACHINE, "HKLM"),
                            (winreg.HKEY_CURRENT_USER, "HKCU")]:
            for subkey in [r"SOFTWARE\Python\PythonCore"]:
                try:
                    key = winreg.OpenKey(root, subkey)
                    i = 0
                    while True:
                        try:
                            version_key_name = winreg.EnumKey(key, i)
                            version_key = winreg.OpenKey(key, version_key_name)
                            install_key = winreg.OpenKey(version_key, "InstallPath")
                            install_path, _ = winreg.QueryValueEx(install_key, "")
                            exe = os.path.join(install_path, "python.exe")
                            if os.path.isfile(exe):
                                found.append(exe)
                            winreg.CloseKey(install_key)
                            winreg.CloseKey(version_key)
                        except OSError:
                            break
                        i += 1
                    winreg.CloseKey(key)
                except OSError:
                    pass
    except ImportError:
        pass
    return found


def _scan_common_paths():
    """Linux/macOS: 在常见安装位置搜索 Python 可执行文件。"""
    found = []
    home = os.path.expanduser("~")

    patterns = [
        # 系统级 Python
        "/usr/bin/python*",
        "/usr/local/bin/python*",
        "/usr/lib/python*",
        # pyenv
        os.path.join(home, ".pyenv", "versions", "*", "bin", "python*"),
        # conda
        os.path.join(home, "anaconda3", "bin", "python*"),
        os.path.join(home, "miniconda3", "bin", "python*"),
        "/opt/conda/bin/python*",
    ]

    # macOS 特有路径（存在性检查）
    mac_paths = [
        "/Library/Frameworks/Python.framework/Versions/*/bin/python*",
        "/opt/homebrew/bin/python*",
        "/usr/local/opt/python*/bin/python*",
    ]
    if os.path.exists("/Library") or os.path.exists("/opt/homebrew"):
        patterns.extend(mac_paths)

    all_found = []
    for pattern in patterns:
        try:
            for path in glob.glob(pattern):
                if os.path.isfile(path):
                    all_found.append(path)
        except Exception:
            pass

    return _deduplicate_paths(all_found)


# ── 信息提取 ──────────────────────────────────────────────────────────

def _get_python_info(python_path):
    """提取单个 Python 安装的版本、包数量、大小、来源。"""
    # 解析符号链接，获取真实路径
    real_path = os.path.realpath(python_path)

    info = {
        "path": os.path.normpath(python_path),
        "version": _get_version(python_path),
        "source": _detect_source(python_path),
        "package_count": 0,
        "site_packages_size_mb": 0.0,
    }

    # pip list 获取包数量
    packages = _pip_list(python_path)
    info["package_count"] = len(packages)

    # site-packages 目录大小（用真实路径计算）
    info["site_packages_size_mb"] = _get_site_packages_size(real_path)

    return info


def _get_version(python_path):
    """python --version → '3.12.10'。"""
    try:
        out = subprocess.run(
            [python_path, "--version"], capture_output=True, text=True, timeout=5
        )
        text = out.stdout.strip() or out.stderr.strip()
        return text.split()[-1]
    except Exception:
        return "unknown"


def _pip_list(python_path):
    """pip list --format json → 包列表。"""
    try:
        out = subprocess.run(
            [python_path, "-m", "pip", "list", "--format", "json"],
            capture_output=True, text=True, timeout=15,
        )
        return json.loads(out.stdout)
    except Exception:
        return []


def _get_site_packages_size(python_path):
    """计算 site-packages 目录大小 (MB)。"""
    python_root = os.path.dirname(python_path)

    # Windows: <PythonRoot>/Lib/site-packages
    win_sp = os.path.join(python_root, "Lib", "site-packages")
    if os.path.isdir(win_sp):
        return _dir_size_mb(win_sp)

    # Linux: <prefix>/lib/pythonX.Y/{site,dist}-packages
    if not IS_WINDOWS:
        lib_dir = os.path.join(python_root, "lib")
        if not os.path.isdir(lib_dir):
            # python_root 是 /usr/bin 时，真正的 lib 在 /usr/lib
            lib_dir = os.path.join(os.path.dirname(python_root), "lib")
        if os.path.isdir(lib_dir):
            try:
                for entry in os.listdir(lib_dir):
                    if entry.startswith("python"):
                        for name in ("site-packages", "dist-packages"):
                            sp = os.path.join(lib_dir, entry, name)
                            if os.path.isdir(sp):
                                return _dir_size_mb(sp)
            except Exception:
                pass

    # venv/Scripts/python.exe → venv/Lib/site-packages
    venv_sp = os.path.join(python_root, "..", "Lib", "site-packages")
    venv_sp = os.path.normpath(venv_sp)
    if os.path.isdir(venv_sp):
        return _dir_size_mb(venv_sp)

    return 0.0


def _dir_size_mb(path):
    """递归计算目录大小，返回 MB（保留一位小数）。"""
    total = 0
    try:
        for dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
    except Exception:
        pass
    return round(total / (1024 * 1024), 1)


def _detect_source(python_path):
    """根据路径判断 Python 来源。"""
    lower = python_path.lower().replace("\\", "/")
    if "windowsapps" in lower:
        return "microsoft_store"
    if "anaconda" in lower or "miniconda" in lower:
        return "conda"
    if "program files" in lower and "python" in lower:
        return "python.org"
    if IS_WINDOWS:
        return "unknown"
    # Linux/macOS
    if "/.pyenv/versions/" in lower:
        return "pyenv"
    # macOS Homebrew (必须在 framework 之前检查，因为 /usr/local 可能重叠)
    if "/opt/homebrew/" in lower or "/usr/local/opt/" in lower or "/usr/local/cellar/" in lower:
        return "homebrew"
    # macOS python.org 安装器
    if "/library/frameworks/python.framework/" in lower:
        return "python.org"
    # 系统级 Python
    if lower.startswith("/usr/bin/") or lower.startswith("/usr/local/bin/"):
        return "system"
    return "unknown"


def _mark_python_duplicates(results):
    """检测并标记重复的 Python 安装（同版本号）。"""
    from collections import defaultdict

    # 按版本号分组
    by_version = defaultdict(list)
    for entry in results:
        ver = entry.get("version", "unknown")
        if ver != "unknown":
            by_version[ver].append(entry)

    for ver, entries in by_version.items():
        if len(entries) <= 1:
            continue
        # 按来源优先级排序（python.org 优先作为主条目）
        source_rank = {"python.org": 0, "microsoft_store": 1, "system": 2, "conda": 3, "unknown": 4}
        entries.sort(key=lambda e: source_rank.get(e.get("source", "unknown"), 4))
        # 标记所有条目
        for entry in entries:
            entry["duplicate_group"] = [
                e["path"] for e in entries if e["path"] != entry["path"]
            ]
            entry["is_primary"] = (entry is entries[0])


# ── 辅助 ──────────────────────────────────────────────────────────────

def _report(callback, phase, data):
    if callback:
        try:
            callback(phase, data)
        except Exception:
            pass
