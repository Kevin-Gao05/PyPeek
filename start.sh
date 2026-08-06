#!/usr/bin/env bash
set -e

echo "================================"
echo "  PyPeek - Python 环境查看器"
echo "================================"
echo ""

# ── 检查 Python ──────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "[错误] 未找到 Python3，请先安装 Python。"
    echo "https://www.python.org/downloads/"
    exit 1
fi

# ── Linux: 检查系统依赖 ──────────────────────────────────────
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    MISSING_PKGS=""

    # GTK3 introspection（pywebview 窗口引擎）
    if ! python3 -c "import gi; gi.require_version('Gtk','3.0')" 2>/dev/null; then
        MISSING_PKGS="$MISSING_PKGS gir1.2-gtk-3.0"
    fi

    # WebKit2GTK introspection（pywebview 浏览器内核）
    if ! python3 -c "import gi; gi.require_version('WebKit2','4.1')" 2>/dev/null; then
        MISSING_PKGS="$MISSING_PKGS gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0"
    fi

    # CJK 字体（中文不会变方框）
    if ! fc-list :lang=zh 2>/dev/null | grep -q .; then
        MISSING_PKGS="$MISSING_PKGS fonts-noto-cjk"
    fi

    if [ -n "$MISSING_PKGS" ]; then
        echo "[系统依赖] 缺少以下包："
        echo "  $MISSING_PKGS"
        echo ""
        echo "  请执行："
        echo "    sudo apt-get install -y$MISSING_PKGS"
        echo ""
        exit 1
    fi
fi

# ── 安装 Python 依赖 ────────────────────────────────────────
echo "[1/2] 正在安装 Python 依赖..."
python3 -m pip install -r requirements.txt -q 2>/dev/null || python3 -m pip install -r requirements.txt -q --break-system-packages 2>/dev/null || echo "  (依赖已安装，跳过)"

# ── 启动 ─────────────────────────────────────────────────────
echo "[2/2] 正在启动 PyPeek..."
python3 main.py
