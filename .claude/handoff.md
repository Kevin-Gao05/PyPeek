# PyPeek Handoff — 2026-08-03

## 项目概述

PyPeek — Python 环境桌面浏览器。双击即开，一眼看全 Windows 机器上所有 Python 安装、虚拟环境、包缓存。安全清理，不用碰终端。

**技术栈**: pywebview（桌面外壳） + Python 标准库 ThreadingHTTPServer + 纯 HTML/CSS/JS（暗色主题，零框架）

**仓库**: `https://github.com/Kevin-Gao05/PyPeek.git` (branch: `master`)

---

## 当前进度（所有 Phase 均已完成）

| # | 模块 | 状态 | 说明 |
|---|------|------|------|
| #2 | 脚手架 |  | HTTP 服务 + pywebview 窗口 + 暗色主题骨架 UI |
| #3 | Python 发现 |  | PATH + Windows 注册表扫描 |
| #4 | Venv 发现 |  | pyvenv.cfg 全盘搜索 |
| #5 | pip 缓存 |  | pip cache info 解析 + CSS 柱状图 |
| #6 | Conda |  跳过 | — |
| #7 | 包浏览器 |  | 可展开行 +  安全徽章 + pip show 批量富化 |
| #8 | 安全卸载 |  | 三级安全分级 + 依赖冲突警告弹窗 + 强制卸载 |

**最新 commit**: `ee067ba` —  安全卸载 (#8)，已推送到 origin/master

---

## 项目结构

```
PyPeek/
├── main.py                 # 入口：启动 server + webview 窗口
├── start.bat               # Windows 一键启动
├── scanner/
│   ├── __init__.py
│   ├── pythons.py          # Python 安装发现（PATH + 注册表）
│   ├── venvs.py            # pyvenv.cfg 全盘搜索
│   ├── pip_cache.py        # pip 缓存分析
│   ├── site_packages.py    # 包详情 + 安全检查 + 卸载
│   └── conda.py            # Conda 环境（TODO）
├── server/
│   ├── __init__.py
│   ├── app.py              # HTTP 路由 + SSE 端点 + API
│   └── sse.py              # SSE 事件管理器（线程安全队列）
├── static/
│   ├── index.html          # 单页骨架 + 卸载弹窗 + Toast
│   ├── style.css           # 暗色主题 + 模态弹窗 + 动画
│   └── app.js              # SSE 消费 + 表格渲染 + 卸载流程
└── plans/
    └── implementation-plan.md  # 原始实现计划
```

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/scan` | 触发全量扫描，返回 `scan_id` |
| GET | `/api/scan/progress?scan_id=...` | SSE 事件流（实时进度） |
| GET | `/api/packages?python_path=...` | 获取指定 Python 的包列表 |
| POST | `/api/uninstall/preview` | 卸载前安全检查（dry-run） |
| POST | `/api/uninstall` | 执行卸载（需 `{python_path, package, force?}`） |

### 卸载流程

1. 前端点击「卸载」→ `POST /api/uninstall/preview` 获取安全等级
2.  safe → 确认弹窗 → 用户确认 → `POST /api/uninstall`
3.  warning → 依赖冲突弹窗（显示 `required_by` 列表）→ `POST /api/uninstall {force: true}`
4.  danger → 禁止弹窗，按钮 disabled，后端返回 403
5. 成功后自动刷新包列表 + Toast 提示

### 安全等级定义（`scanner/site_packages.py`）

- **CRITICAL_PACKAGES**: `pip`, `setuptools`, `wheel`, `pkg_resources` — 无条件拒绝
- `check_uninstall_safety()` — 返回 `{level, required_by, version, message}`
- `uninstall_package()` — 内部再做一次安全检查，然后 `pip uninstall -y`

---

## 关键设计决策

1. **零 Web 框架依赖** — 全部用标准库 `ThreadingHTTPServer` + `http.server`
2. **SSE 实时推送** — 扫描进度通过 `server/sse.py` 的线程安全队列推送
3. **前端零框架** — 纯 HTML/CSS/JS，暗色主题，CSS 变量驱动
4. **双重安全检查** — 前端 preview + 后端 force 标志， 包无论如何无法卸载
5. **LF→CRLF** — Windows 项目，git 会自动转换换行符

---

## 如何继续开发

### 本地运行（无 GUI）

```bash
cd /home/gao/projects/PyPeek
python3 -c "from server.app import create_app; create_app().run()"
# 打开 http://127.0.0.1:8080
```

### 测试扫描器

```bash
python3 -c "
from scanner.site_packages import check_uninstall_safety
import sys
print(check_uninstall_safety(sys.executable, 'pip'))
"
```

### 可能的后续工作

- Conda 集成 (`scanner/conda.py` + 前端 conda tab)
- Settings 标签页（配置扫描路径）
- 深色/浅色主题切换
- 搜索/过滤包列表
- 批量卸载
- Windows 实机测试

---

## Handoff 记录时间

2026-08-03，会话中完成了 #8 安全卸载的全部实现（6 files, +604/-7 lines），已 commit + push。
