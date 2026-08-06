"""
虚拟环境发现模块。

通过文件系统遍历搜索 pyvenv.cfg 文件来定位虚拟环境。
安全排除系统目录，跳过符号链接/junction point。
"""

import os
import stat
import json
import subprocess
import platform
from datetime import datetime, timezone

IS_WINDOWS = platform.system() == "Windows"

# 系统目录排除列表（不进入这些目录搜索）
SKIP_DIRS_WIN = {
    "Windows", "Program Files", "Program Files (x86)",
    "ProgramData", "$Recycle.Bin", "System Volume Information",
    "Recovery", "Config.Msi", "MSOCache",
}
SKIP_DIRS_LINUX = {
    "proc", "sys", "dev", "run", "tmp", "snap",
    "etc", "boot", "lost+found", "mnt", "media",
    ".cache", ".config", ".local",
}


def discover_venvs(on_progress=None):
    """
    遍历文件系统，发现所有虚拟环境（通过 pyvenv.cfg 识别）。

    on_progress(phase, data) — 每发现一个 venv 时回调。
    返回: [{"path": "...", "python_version": "...", ...}, ...]
    """
    results = []
    scanned = 0

    _report(on_progress, "venvs", {
        "phase": "虚拟环境扫描",
        "detail": "正在搜索 pyvenv.cfg 文件…",
        "progress": 0.0,
        "venvs": [],
    })

    start_dirs = _get_scan_roots()

    for start in start_dirs:
        if not os.path.isdir(start):
            continue

        try:
            for entry in os.scandir(start):
                # 系统目录跳过
                if _should_skip(entry.name):
                    continue

                if entry.is_dir(follow_symlinks=False):
                    # 递归搜索该目录
                    for venv_path in _scan_dir(entry.path):
                        scanned += 1
                        try:
                            info = _get_venv_info(venv_path)
                            results.append(info)
                            _report(on_progress, "venvs", {
                                "phase": "虚拟环境扫描",
                                "detail": f"已扫描 {scanned} 个目录，发现 {len(results)} 个 venv",
                                "progress": 0.5,
                                "venvs": list(results),
                            })
                        except Exception:
                            continue

                elif entry.is_file(follow_symlinks=False):
                    if entry.name == "pyvenv.cfg":
                        # 直接在根目录下找到了（不太常见但处理）
                        venv_path = os.path.dirname(entry.path) or start
                        scanned += 1
                        try:
                            info = _get_venv_info(venv_path)
                            results.append(info)
                            _report(on_progress, "venvs", {
                                "phase": "虚拟环境扫描",
                                "detail": f"已扫描 {scanned} 个目录，发现 {len(results)} 个 venv",
                                "progress": 0.5,
                                "venvs": list(results),
                            })
                        except Exception:
                            continue
        except PermissionError:
            continue

    _report(on_progress, "venvs", {
        "phase": "虚拟环境扫描完成",
        "detail": f"共扫描 {scanned} 个目录，发现 {len(results)} 个虚拟环境",
        "progress": 1.0,
        "venvs": list(results),
    })

    # ── 重复检测 ────────────────────────────────────────────────────
    _mark_venv_duplicates(results)

    return results


# ── 文件系统遍历 ──────────────────────────────────────────────────────

def _get_scan_roots():
    """获取扫描的起始目录。"""
    roots = []

    if IS_WINDOWS:
        # 用户目录优先
        home = os.path.expanduser("~")
        if os.path.isdir(home):
            roots.append(home)
        # 以及其他盘符
        for drive in "CDEFGH":
            p = f"{drive}:\\"
            if os.path.isdir(p):
                roots.append(p)
    else:
        home = os.path.expanduser("~")
        if os.path.isdir(home):
            roots.append(home)
        # pyenv 管理的 Python 版本目录
        pyenv_versions = os.path.join(home, ".pyenv", "versions")
        if os.path.isdir(pyenv_versions):
            roots.append(pyenv_versions)
        # 常见项目目录
        for d in ["/opt", "/srv"]:
            if os.path.isdir(d):
                roots.append(d)

    return roots


def _scan_dir(root_path):
    """递归搜索目录，yield 所有包含 pyvenv.cfg 的目录路径。"""
    try:
        entries = list(os.scandir(root_path))
    except (PermissionError, OSError):
        return

    # 先检查当前目录是否有 pyvenv.cfg
    has_venv = False
    subdirs = []

    for entry in entries:
        if entry.is_file(follow_symlinks=False):
            if entry.name == "pyvenv.cfg":
                has_venv = True
        elif entry.is_dir(follow_symlinks=False):
            if not _should_skip(entry.name):
                subdirs.append(entry.path)

    if has_venv:
        yield root_path
        # 找到 venv 后不继续递归进入（venv 内部不会有嵌套 venv）
        return

    # 限制深度，避免无限递归
    depth = root_path.count(os.sep)
    start_depth = os.path.expanduser("~").count(os.sep)
    if depth - start_depth > 6:
        return

    for subdir in subdirs:
        yield from _scan_dir(subdir)


# ── 安全检查 ──────────────────────────────────────────────────────────

def _should_skip(dirname):
    """判断目录是否应该跳过。"""
    lower = dirname.lower()

    # 隐藏目录（除了 .venv / venv）
    if lower.startswith(".") and lower not in (".venv", "venv", ".virtualenvs"):
        return True

    # node_modules 等大型依赖目录
    if lower in ("node_modules", "__pycache__", ".git", ".svn", ".hg"):
        return True

    if IS_WINDOWS:
        if dirname in SKIP_DIRS_WIN:
            return True
    else:
        if lower in SKIP_DIRS_LINUX:
            return True

    return False


# ── 信息提取 ──────────────────────────────────────────────────────────

def _get_venv_info(venv_path):
    """提取虚拟环境的详细信息。"""
    cfg = _parse_pyvenv_cfg(venv_path)

    version = cfg.get("version_info") or cfg.get("version", "unknown")

    info = {
        "path": os.path.normpath(venv_path),
        "python_version": version,
        "home_python": cfg.get("home", ""),
        "total_size_mb": _dir_size_mb(venv_path),
        "package_count": 0,
        "last_modified": _get_mtime(venv_path),
    }

    # pip list 获取包数量
    python_exe = _find_venv_python(venv_path)
    if python_exe:
        packages = _pip_list(python_exe)
        info["package_count"] = len(packages)

    return info


def _parse_pyvenv_cfg(venv_path):
    """解析 pyvenv.cfg 文件，返回 dict。"""
    cfg = {}
    cfg_path = os.path.join(venv_path, "pyvenv.cfg")
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    key, _, value = line.partition("=")
                    cfg[key.strip()] = value.strip()
    except (OSError, UnicodeDecodeError):
        pass
    return cfg


def _find_venv_python(venv_path):
    """找到 venv 内的 python 可执行文件。"""
    if IS_WINDOWS:
        candidates = [
            os.path.join(venv_path, "Scripts", "python.exe"),
        ]
    else:
        candidates = [
            os.path.join(venv_path, "bin", "python3"),
            os.path.join(venv_path, "bin", "python"),
        ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def _pip_list(python_exe):
    """pip list --format json → 包列表。"""
    try:
        out = subprocess.run(
            [python_exe, "-m", "pip", "list", "--format", "json"],
            capture_output=True, text=True, timeout=15,
        )
        return json.loads(out.stdout)
    except Exception:
        return []


def _get_mtime(path):
    """获取目录最后修改时间，返回 ISO 格式字符串。"""
    try:
        ts = os.stat(path).st_mtime
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        return dt.isoformat()
    except OSError:
        return ""


def _dir_size_mb(path):
    """递归计算目录大小（MB），最多遍历 5000 个文件后截断。"""
    total = 0
    count = 0
    max_files = 5000
    try:
        for dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                    count += 1
                    if count >= max_files:
                        return round(total / (1024 * 1024), 1)
                except OSError:
                    pass
    except Exception:
        pass
    return round(total / (1024 * 1024), 1)


# ── 辅助 ──────────────────────────────────────────────────────────────

def _mark_venv_duplicates(results):
    """检测并标记重复的虚拟环境（同版本 + 同父目录）。"""
    from collections import defaultdict

    by_key = defaultdict(list)
    for entry in results:
        ver = entry.get("python_version", "unknown")
        # 父目录（向上两级，捕获项目级重复）
        parent = os.path.dirname(entry["path"])
        key = f"{ver}|{parent}"
        by_key[key].append(entry)

    for key, entries in by_key.items():
        if len(entries) <= 1:
            continue
        # 按大小排序（最大的作为主条目）
        entries.sort(key=lambda e: e.get("total_size_mb", 0), reverse=True)
        for entry in entries:
            entry["duplicate_group"] = [
                e["path"] for e in entries if e["path"] != entry["path"]
            ]
            entry["is_primary"] = (entry is entries[0])


def _report(callback, phase, data):
    if callback:
        try:
            callback(phase, data)
        except Exception:
            pass
