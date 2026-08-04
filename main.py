"""
PyPeek — Python 环境桌面浏览器

入口：在守护线程中启动 HTTP 后端，然后打开 pywebview 原生窗口。
"""

import threading
import sys
import webview

from server.app import create_app


def main():
    host = "127.0.0.1"
    port = 8080

    # ── 在后台线程中启动 HTTP 服务 ─────────────────────────────────
    app = create_app(host=host, port=port)
    server_thread = threading.Thread(target=app.run, daemon=True)
    server_thread.start()

    url = f"http://{host}:{port}"

    # ── 打开原生桌面窗口 ───────────────────────────────────────────
    window = webview.create_window(
        title="PyPeek",
        url=url,
        width=1200,
        height=800,
        min_size=(900, 600),
    )
    webview.start()

    # 窗口关闭后清理退出
    app.shutdown()
    sys.exit(0)


if __name__ == "__main__":
    main()
