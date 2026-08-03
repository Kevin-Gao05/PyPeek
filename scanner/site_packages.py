"""
Site-packages 包浏览器模块。

获取指定 Python 解释器的已安装包列表：
名称、版本、磁盘占用、简介、被依赖列表、安全等级。
"""

import os
import re
import json
import subprocess

# 系统关键包，禁止卸载
CRITICAL_PACKAGES = {"pip", "setuptools", "wheel", "pkg_resources"}


def get_packages(python_path):
    """
    获取指定 Python 的 site-packages 包列表。

    参数:
        python_path: python 可执行文件路径
    返回:
        [{"name": "...", "version": "...", "size_mb": 0, "summary": "...",
          "safety": "safe|warning|danger", "required_by": [...]}, ...]
    """
    # 阶段 1：pip list 获取名称 + 版本
    packages = _pip_list(python_path)
    if not packages:
        return []

    # 阶段 2：计算每个包的磁盘占用
    _compute_sizes(python_path, packages)

    # 阶段 3：pip show 批量获取简介和被依赖列表
    _enrich_packages(python_path, packages)

    # 阶段 4：安全分级
    for pkg in packages:
        pkg["safety"] = _classify_safety(pkg)

    return packages


# ── 阶段 1：pip list ─────────────────────────────────────────────────

def _pip_list(python_path):
    """pip list --format json → [{name, version}, ...]"""
    try:
        out = subprocess.run(
            [python_path, "-m", "pip", "list", "--format", "json"],
            capture_output=True, text=True, timeout=15,
        )
        raw = json.loads(out.stdout)
        return [
            {
                "name": item["name"],
                "version": item.get("version", ""),
                "size_mb": 0.0,
                "summary": "",
                "safety": "safe",
                "required_by": [],
            }
            for item in raw
        ]
    except Exception:
        return []


# ── 阶段 2：计算目录大小 ─────────────────────────────────────────────

def _compute_sizes(python_path, packages):
    """通过 site-packages 目录遍历，计算每个包的大小。"""
    site_pkg_dir = _find_site_packages(python_path)
    if not site_pkg_dir or not os.path.isdir(site_pkg_dir):
        return

    pkg_names = {p["name"].lower(): p for p in packages}
    total_sizes = {}  # lower_name → bytes

    try:
        for entry in os.scandir(site_pkg_dir):
            name = entry.name
            if name.endswith(".py"):
                # 单文件包，如 six.py → six
                key = name[:-3].lower()
                if key in pkg_names:
                    try:
                        total_sizes[key] = total_sizes.get(key, 0) + entry.stat().st_size
                    except OSError:
                        pass

            elif entry.is_dir(follow_symlinks=False):
                # 匹配包名（去掉版本号后缀 .dist-info / .egg-info）
                clean = _clean_dir_name(name).lower()
                if clean in pkg_names:
                    # 只计算非 .dist-info / .egg-info 目录
                    if not name.endswith((".dist-info", ".egg-info")):
                        try:
                            total_sizes[clean] = total_sizes.get(clean, 0) + _dir_bytes(entry.path)
                        except OSError:
                            pass
    except PermissionError:
        pass

    for name_lower, pkg in pkg_names.items():
        pkg["size_mb"] = round(total_sizes.get(name_lower, 0) / (1024 * 1024), 1)


def _clean_dir_name(dirname):
    """去掉 .dist-info / .egg-info 后缀，提取纯包名。"""
    # flask-3.1.0.dist-info → flask
    # numpy-1.26.0.dist-info → numpy
    # setuptools-68.0.0.dist-info → setuptools
    m = re.match(r"^(.+?)-[\d.]+\.(dist|egg)-info$", dirname)
    if m:
        return m.group(1)
    return dirname


def _dir_bytes(path):
    """快速计算目录大小（截断 5000 文件）。"""
    total = 0
    count = 0
    try:
        for dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                    count += 1
                    if count >= 5000:
                        return total
                except OSError:
                    pass
    except Exception:
        pass
    return total


def _find_site_packages(python_path):
    """定位 site-packages 目录。"""
    python_root = os.path.dirname(python_path)

    # Windows: <root>/Lib/site-packages
    win_sp = os.path.join(python_root, "Lib", "site-packages")
    if os.path.isdir(win_sp):
        return win_sp

    # Linux: <prefix>/lib/pythonX.Y/site-packages 或 dist-packages
    lib_candidates = [
        os.path.join(python_root, "lib"),
        os.path.join(os.path.dirname(python_root), "lib"),
    ]
    for lib_dir in lib_candidates:
        if not os.path.isdir(lib_dir):
            continue
        try:
            for entry in os.listdir(lib_dir):
                if entry.startswith("python"):
                    for name in ("site-packages", "dist-packages"):
                        sp = os.path.join(lib_dir, entry, name)
                        if os.path.isdir(sp):
                            return sp
        except PermissionError:
            continue

    return ""


# ── 阶段 3：pip show 批量富化 ────────────────────────────────────────

def _enrich_packages(python_path, packages):
    """批量 pip show，提取 Summary 和 Required-by。"""
    names = [p["name"] for p in packages]
    if not names:
        return

    # 批量调用 pip show（支持多个包名）
    # 使用 -- 分隔符防止包名被误解析为 pip 参数
    try:
        out = subprocess.run(
            [python_path, "-m", "pip", "show", "--"] + names,
            capture_output=True, text=True, timeout=30,
        )
        text = out.stdout
    except Exception:
        return

    # 解析输出（多个包用 --- 分隔）
    blocks = text.split("---")
    for block in blocks:
        info = _parse_pip_show(block)
        if not info:
            continue
        for pkg in packages:
            if pkg["name"].lower() == info["name"].lower():
                pkg["summary"] = info.get("summary", "")
                pkg["required_by"] = info.get("required_by", [])
                break


def _parse_pip_show(text):
    """解析单个 pip show 输出块。"""
    info = {}
    lines = text.strip().split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if ": " in line:
            key, _, value = line.partition(": ")
            key = key.strip().lower()
            value = value.strip()
            if key == "required-by":
                # Required-by 可能为空或逗号分隔
                info["required_by"] = (
                    [v.strip() for v in value.split(",") if v.strip()]
                    if value else []
                )
            elif key in ("name", "summary", "version"):
                info[key] = value
        i += 1
    return info if "name" in info else None


# ── 阶段 4：安全分级 ─────────────────────────────────────────────────

def _classify_safety(pkg):
    """根据包名和 Required-by 判断安全等级。"""
    if pkg["name"].lower() in CRITICAL_PACKAGES:
        return "danger"
    if pkg.get("required_by"):
        return "warning"
    return "safe"


# ── 安全卸载 ───────────────────────────────────────────────────────────

def check_uninstall_safety(python_path, package_name):
    """
    卸载前的安全检查。

    参数:
        python_path: Python 可执行文件路径
        package_name: 要卸载的包名

    返回:
        {"level": "safe|warning|danger",
         "required_by": [...],
         "version": "x.y.z",
         "size_mb": float}
    """
    #  系统关键包 — 无条件拒绝
    if package_name.lower() in CRITICAL_PACKAGES:
        return {
            "level": "danger",
            "required_by": [],
            "version": "",
            "size_mb": 0,
            "message": f"{package_name} 是 Python 系统关键包，卸载可能导致 pip 不可用。",
        }

    # 获取包详情（pip show）
    try:
        out = subprocess.run(
            [python_path, "-m", "pip", "show", "--", package_name],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode != 0:
            return {
                "level": "danger",
                "required_by": [],
                "version": "",
                "size_mb": 0,
                "message": f"未找到包: {package_name}",
            }

        info = _parse_pip_show(out.stdout)
        if not info:
            return {
                "level": "danger",
                "required_by": [],
                "version": "",
                "size_mb": 0,
                "message": f"无法解析包信息: {package_name}",
            }

        required_by = info.get("required_by", [])
        version = info.get("version", "")

        if required_by:
            return {
                "level": "warning",
                "required_by": required_by,
                "version": version,
                "size_mb": 0,
                "message": f"{package_name} 被 {', '.join(required_by)} 依赖。卸载后这些包可能无法正常工作。",
            }

        return {
            "level": "safe",
            "required_by": [],
            "version": version,
            "size_mb": 0,
            "message": f"{package_name} 没有被其他包依赖，可以安全卸载。",
        }

    except Exception as exc:
        return {
            "level": "danger",
            "required_by": [],
            "version": "",
            "size_mb": 0,
            "message": f"安全检查失败: {exc}",
        }


def uninstall_package(python_path, package_name):
    """
    执行 pip uninstall。

    参数:
        python_path: Python 可执行文件路径
        package_name: 要卸载的包名

    返回:
        {"ok": True/False, "message": "...", "version": "..."}
    """
    # 先做安全检查
    safety = check_uninstall_safety(python_path, package_name)
    if safety["level"] == "danger":
        return {
            "ok": False,
            "message": safety["message"],
            "version": safety.get("version", ""),
        }

    try:
        out = subprocess.run(
            [python_path, "-m", "pip", "uninstall", "-y", "--", package_name],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode == 0:
            return {
                "ok": True,
                "message": f"{package_name} {safety.get('version', '')} 已成功卸载",
                "version": safety.get("version", ""),
            }
        else:
            # 尝试从 stderr 提取有用信息
            err = out.stderr.strip() or out.stdout.strip() or "未知错误"
            return {
                "ok": False,
                "message": f"卸载失败: {err}",
                "version": safety.get("version", ""),
            }
    except Exception as exc:
        return {
            "ok": False,
            "message": f"卸载异常: {exc}",
            "version": "",
        }
