#!/usr/bin/env python3
"""
PyPeek 测试环境搭建脚本。

创建多种 Python 虚拟环境+包组合，覆盖所有功能的测试场景。
在项目根目录运行:  python3 tests/setup_test_envs.py
"""

import os
import subprocess
import sys
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_DIR = os.path.join(BASE_DIR, "tests", "_test_envs")


def run(cmd, **kw):
    """运行命令，打印输出。"""
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if result.returncode != 0 and kw.get("check") is not False:
        print(f"   {result.stderr.strip()[:200]}")
    return result


def create_venv(name):
    """创建一个虚拟环境，返回其路径和 python 路径。"""
    venv_path = os.path.join(TEST_DIR, name)
    if os.path.isdir(venv_path):
        shutil.rmtree(venv_path, ignore_errors=True)
    run([sys.executable, "-m", "venv", venv_path])
    if sys.platform == "win32":
        python_exe = os.path.join(venv_path, "Scripts", "python.exe")
    else:
        python_exe = os.path.join(venv_path, "bin", "python3")
    # 确保 pip 可用（某些 Linux 发行版的 venv 不包含 pip）
    _ensure_pip(python_exe)
    return venv_path, python_exe


def _ensure_pip(python_exe):
    """确保 venv 中的 pip 可用。"""
    try:
        r = subprocess.run(
            [python_exe, "-m", "pip", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if r.returncode == 0:
            return True
    except Exception:
        pass
    # 尝试 ensurepip 引导安装
    try:
        subprocess.run(
            [python_exe, "-m", "ensurepip", "--upgrade", "--default-pip"],
            capture_output=True, timeout=30, check=True
        )
        return True
    except Exception:
        pass
    # 尝试安装 pip（通过 get-pip.py 或系统 pip + --target）
    try:
        import importlib.util
        spec = importlib.util.find_spec("pip")
        if spec and spec.origin:
            # 找到系统 pip 的 site-packages，复制到 venv
            import site
            site_pkgs = site.getsitepackages()[0]
            r = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--target",
                 os.path.join(os.path.dirname(os.path.dirname(python_exe)),
                              "lib", f"python{sys.version_info.major}.{sys.version_info.minor}",
                              "site-packages"),
                 "--quiet", "pip"],
                capture_output=True, timeout=30
            )
            if r.returncode == 0:
                return True
    except Exception:
        pass
    return False


def pip_install(python_exe, *packages):
    """在指定 Python 环境中安装包。如果 pip 不可用则跳过。"""
    try:
        r = subprocess.run(
            [python_exe, "-m", "pip", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if r.returncode != 0:
            print(f"   pip 不可用，跳过安装: {', '.join(packages)}")
            return
    except Exception:
        print(f"   pip 不可用，跳过安装: {', '.join(packages)}")
        return
    run([python_exe, "-m", "pip", "install", "--quiet"] + list(packages),
        timeout=120)


def main():
    print("=" * 60)
    print("PyPeek 测试环境搭建")
    print(f"目标目录: {TEST_DIR}")
    print("=" * 60)
    print()

    # 清理旧环境
    if os.path.isdir(TEST_DIR):
        print("[清理] 删除旧的测试环境…")
        shutil.rmtree(TEST_DIR, ignore_errors=True)
    os.makedirs(TEST_DIR, exist_ok=True)

    # ═══════════════════════════════════════════════════════════════
    # 环境 1: 干净环境 — 只有 pip/setuptools
    # ═══════════════════════════════════════════════════════════════
    print("\n 环境 1: 干净环境 (bare)")
    v1_path, v1_py = create_venv("bare_env")
    # 不安装任何东西，只保留 pip/setuptools
    print(f"  路径: {v1_path}")
    print(f"  包数量: 仅 pip + setuptools")
    print(f"  测试:  危险包显示 / 空状态(无多余包时)")

    # ═══════════════════════════════════════════════════════════════
    # 环境 2: 基础环境 — 无依赖冲突的独立包
    # ═══════════════════════════════════════════════════════════════
    print("\n 环境 2: 安全卸载测试 (safe_uninstall)")
    v2_path, v2_py = create_venv("safe_uninstall")
    pip_install(v2_py, "six", "pyyaml", "tomli", "colorama")
    print(f"  路径: {v2_path}")
    print(f"  安装: six, pyyaml, tomli, colorama")
    print(f"  测试:  安全包橙色标识 / 卸载弹窗 / 卸载后刷新")

    # ═══════════════════════════════════════════════════════════════
    # 环境 3: 依赖链环境 — 有 required_by 关系
    # ═══════════════════════════════════════════════════════════════
    print("\n 环境 3: 依赖冲突测试 (dep_chain)")
    v3_path, v3_py = create_venv("dep_chain")
    # flask → (jinja2 → markupsafe) + click + blinker + itsdangerous + werkzeug
    pip_install(v3_py, "flask", "requests")
    print(f"  路径: {v3_path}")
    print(f"  安装: flask, requests (及其依赖链)")
    print(f"  测试:  依赖警告 / 依赖标签列表 / 强制卸载")

    # ═══════════════════════════════════════════════════════════════
    # 环境 4: 模拟重复环境 A — 同项目两个 venv
    # ═══════════════════════════════════════════════════════════════
    print("\n 环境 4: 重复环境 — 同父目录 (dup_project)")
    proj_dir = os.path.join(TEST_DIR, "my_project")
    os.makedirs(proj_dir, exist_ok=True)
    # 在 my_project 下创建两个 venv
    dup_a = os.path.join(proj_dir, "venv")
    dup_b = os.path.join(proj_dir, ".venv_backup")
    for name, path in [("venv", dup_a), (".venv_backup", dup_b)]:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        run([sys.executable, "-m", "venv", path])
        if sys.platform == "win32":
            py = os.path.join(path, "Scripts", "python.exe")
        else:
            py = os.path.join(path, "bin", "python3")
        pip_install(py, "numpy")
    print(f"  路径 A: {dup_a}")
    print(f"  路径 B: {dup_b}")
    print(f"  测试:  重复环境标记 / Toast 提示")

    # ═══════════════════════════════════════════════════════════════
    # 环境 5: 大体积环境 — 测试磁盘占用显示
    # ═══════════════════════════════════════════════════════════════
    print("\n 环境 5: 大体积环境 (big_env)")
    v5_path, v5_py = create_venv("big_env")
    pip_install(v5_py, "pandas", "numpy")
    print(f"  路径: {v5_path}")
    print(f"  安装: pandas, numpy (体积较大)")
    print(f"  测试: 包大小显示准确 / 排序")

    # ═══════════════════════════════════════════════════════════════
    # 环境 6: 模拟"已删除"环境 — 用来测试删除功能
    # ═══════════════════════════════════════════════════════════════
    print("\n 环境 6: 待删除测试环境 (to_delete)")
    v6_path, v6_py = create_venv("to_delete")
    pip_install(v6_py, "pillow")
    print(f"  路径: {v6_path}")
    print(f"  安装: pillow")
    print(f"  测试:  删除按钮 → 确认弹窗 → 目录消失 → 重新扫描不出现")

    # ═══════════════════════════════════════════════════════════════
    # 制造 pip 缓存
    # ═══════════════════════════════════════════════════════════════
    print("\n 生成 pip 缓存…")
    try:
        r = subprocess.run(
            [sys.executable, "-m", "pip", "cache", "info"],
            capture_output=True, text=True, timeout=10
        )
        if r.returncode == 0:
            # 先清理缓存以便观察变化
            subprocess.run(
                [sys.executable, "-m", "pip", "cache", "purge"],
                capture_output=True, timeout=20
            )
            # 用临时 venv 安装再卸载来制造缓存
            cache_env = os.path.join(TEST_DIR, "_cache_builder")
            if os.path.isdir(cache_env):
                shutil.rmtree(cache_env, ignore_errors=True)
            run([sys.executable, "-m", "venv", cache_env])
            if sys.platform == "win32":
                cache_py = os.path.join(cache_env, "Scripts", "python.exe")
            else:
                cache_py = os.path.join(cache_env, "bin", "python3")
            pip_install(cache_py, "flask", "requests", "click")
            # 卸载但不删除下载缓存
            subprocess.run(
                [cache_py, "-m", "pip", "uninstall", "-y", "flask", "requests", "click"],
                capture_output=True, timeout=30
            )
            shutil.rmtree(cache_env, ignore_errors=True)
            print("   pip 缓存已生成")
        else:
            print("   pip 不可用，跳过快取生成")
    except Exception as e:
        print(f"   快取生成失败: {e}")

    # ═══════════════════════════════════════════════════════════════
    # 汇总
    # ═══════════════════════════════════════════════════════════════
    print()
    print("=" * 60)
    print(" 测试环境创建完成！")
    print(f"   总路径: {TEST_DIR}")
    print()
    venvs_found = sum(1 for d in os.listdir(TEST_DIR)
                      if os.path.isdir(os.path.join(TEST_DIR, d))
                      and os.path.isfile(os.path.join(TEST_DIR, d, "pyvenv.cfg")))
    # my_project 下的 venv 不算在直接子目录中
    for sub in os.listdir(TEST_DIR):
        subp = os.path.join(TEST_DIR, sub)
        if os.path.isdir(subp) and sub != "my_project":
            if os.path.isfile(os.path.join(subp, "pyvenv.cfg")):
                pass  # already counted
    print(f"   虚拟环境数量: {len([1 for d in os.listdir(TEST_DIR) if os.path.isdir(os.path.join(TEST_DIR, d)) and os.path.isfile(os.path.join(TEST_DIR, d, 'pyvenv.cfg'))])} 个 (顶层)")
    # 也找嵌套的
    nested = 0
    for root, dirs, files in os.walk(TEST_DIR):
        if "pyvenv.cfg" in files:
            nested += 1
    print(f"   总计发现 pyvenv.cfg: {nested} 个")
    print()
    print("现在可以启动 PyPeek 并点击刷新来测试所有功能。")
    print("=" * 60)


if __name__ == "__main__":
    main()
