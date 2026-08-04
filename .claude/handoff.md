# PyPeek Handoff — 2026-08-04

## 项目概述

PyPeek — Python 环境桌面浏览器。双击即开，一眼看全 Windows 机器上所有 Python 安装、虚拟环境、包缓存。安全清理，不用碰终端。

**技术栈**: pywebview（桌面外壳） + Python 标准库 ThreadingHTTPServer + 纯 HTML/CSS/JS（暗色主题，零框架）

**仓库**: `https://github.com/Kevin-Gao05/PyPeek.git` (branch: `master`)

---

## 当前进度

### Phase 1: 核心功能（全部完成）

| #   | 模块        | 状态  | 说明                                 |
| --- | --------- | --- | ---------------------------------- |
| #2  | 脚手架       |     | HTTP 服务 + pywebview 窗口 + 暗色主题骨架 UI |
| #3  | Python 发现 |     | PATH + Windows 注册表扫描               |
| #4  | Venv 发现   |     | pyvenv.cfg 全盘搜索                    |
| #5  | pip 缓存    |     | pip cache info 解析 + CSS 柱状图        |
| #6  | Conda     | 跳过  | —                                  |
| #7  | 包浏览器      |     | 可展开行 + 安全徽章 + pip show 批量富化          |
| #8  | 安全卸载      |     | 三级安全分级 + 依赖冲突警告弹窗 + 强制卸载           |

### Phase 2: V2 UX 增强（进行中）

| Ticket | 状态 | 说明 |
|--------|------|------|
| 01-local-cache |  | `scanner/cache.py` + `GET /api/cache` + 前端启动加载 |
| 02-welcome-dialog |  | 首次启动弹窗 + `scan_summary` 摘要行 |
| 03-pip-cache-cleanup | 待开工 | pip 缓存分类清理（独立） |
| 04-bidirectional-linking | 待开工 | Python ↔ Venv 双向关联（独立） |
| 05-duplicate-environments | 待开工 | 重复环境子标签（独立） |
| 06-onboarding | 待开工 | 轻量 onboarding（软依赖 01 已满足） |

**依赖关系**:
```
01 (缓存) ── 软依赖 ── 02 (弹窗) ✅
         └─ 软依赖 ── 06 (onboarding)

03 (pip清理)  ── 独立
04 (双向关联) ── 独立
05 (重复子标签) ── 独立
```

**最后 commit**: `7463d6c` — docs: 截图竖排展示（已推送 origin/master）

**未提交改动**:
```
 main.py           |   1 -      (pre-existing whitespace)
 server/app.py     | +79        (GET /api/cache, scan_summary in SSE, auto-save cache)
 static/app.js     | +105/-22   (cache-on-load, renderScanResults(), welcome dialog, scan summary)
 static/index.html | +48        (welcome modal, scan-summary row)
 static/style.css  | +80        (.scan-summary, .welcome-privacy, .welcome-scope)
 scanner/cache.py  | new file   (load_cache, save_cache, get_cache_path)
```

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
│   ├── cache.py            # 扫描结果缓存（load/save，~/.config/PyPeek/cache.json）
│   └── conda.py            # Conda 环境（TODO）
├── server/
│   ├── __init__.py
│   ├── app.py              # HTTP 路由 + SSE 端点 + API
│   └── sse.py              # SSE 事件管理器（线程安全队列）
├── static/
│   ├── index.html          # 单页骨架 + 卸载弹窗 + Welcome 弹窗 + Toast
│   ├── style.css           # 暗色主题 + 模态弹窗 + 动画 + scan-summary
│   └── app.js              # SSE 消费 + 表格渲染 + 卸载流程 + 缓存加载 + Welcome
├── .scratch/pypeek/
│   ├── v2-ux-enhancement-spec.md   # V2 UX 增强完整 Spec（27 user stories）
│   └── issues/
│       ├── 01-local-cache.md
│       ├── 02-welcome-dialog.md
│       ├── 03-pip-cache-cleanup.md
│       ├── 04-bidirectional-linking.md
│       ├── 05-duplicate-environments.md
│       └── 06-onboarding.md
└── plans/
    └── implementation-plan.md  # 原始实现计划
```

---

## API 端点

| 方法   | 路径                               | 说明                                       |
| ---- | -------------------------------- | ---------------------------------------- |
| GET  | `/api/health`                    | 健康检查                                     |
| GET  | `/api/cache`                     | 返回 `{"cached": bool, "data": {...}}` — cached=false 表示首次启动 |
| GET  | `/api/scan`                      | 触发全量扫描，返回 `scan_id`                      |
| GET  | `/api/scan/progress?scan_id=...` | SSE 事件流（实时进度），`scan_complete` 事件含 `scan_summary` |
| GET  | `/api/packages?python_path=...`  | 获取指定 Python 的包列表                         |
| POST | `/api/uninstall/preview`         | 卸载前安全检查（dry-run）                         |
| POST | `/api/uninstall`                 | 执行卸载（需 `{python_path, package, force?}`） |

### 缓存 schema（`~/.config/PyPeek/cache.json`）

```json
{
  "scanned_at": "<ISO timestamp>",
  "scan_summary": {"drives_scanned": [...], "files_checked": N, "duration_seconds": N},
  "pythons": [...], "venvs": [...], "pip_cache": {...}
}
```

### 卸载流程

1. 前端点击「卸载」→ `POST /api/uninstall/preview` 获取安全等级
2. safe → 确认弹窗 → 用户确认 → `POST /api/uninstall`
3. warning → 依赖冲突弹窗（显示 `required_by` 列表）→ `POST /api/uninstall {force: true}`
4. danger → 禁止弹窗，按钮 disabled，后端返回 403
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
4. **双重安全检查** — 前端 preview + 后端 force 标志，关键包无论如何无法卸载
5. **LF→CRLF** — Windows 项目，git 会自动转换换行符
6. **本地缓存** — 扫描结果缓存到 `~/.config/PyPeek/cache.json`，启动时优先加载缓存避免重复扫描

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

### 下一步

推荐从 **03-pip-cache-cleanup**、**04-bidirectional-linking**、**05-duplicate-environments**、**06-onboarding** 中任选一张继续 `/implement`。所有阻塞均已清除，可并行开工。

每张 ticket 实现完毕后运行 `/code-review` 做 Standards + Spec 双轴检查。

### 关键参考

- 完整 Spec：`.scratch/pypeek/v2-ux-enhancement-spec.md`
- Tickets：`.scratch/pypeek/issues/`

---

## Handoff 记录

- **2026-08-03** — #8 安全卸载全部实现（6 files, +604/-7 lines），commit + push
- **2026-08-04 Session 2** — grilling → spec → 拆分 6 张 ticket 到 `.scratch/pypeek/issues/`
- **2026-08-04 Session 3** — 实现 ticket 01（本地缓存）和 ticket 02（欢迎弹窗），未提交
