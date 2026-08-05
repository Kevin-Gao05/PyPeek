# PyPeek 架构速查

> 基于 2026-08-05 代码探索生成，供后续开发参考。

## 项目概览

PyPeek 是一个**客户端桌面应用**：Python stdlib HTTP 服务器 + pywebview 原生窗口。
- 入口：`main.py` → 启动 HTTP 服务（daemon 线程）→ 打开 pywebview 窗口指向 `http://127.0.0.1:8080`
- 前端：纯 vanilla JS + CSS，无框架
- 后端：`http.server.ThreadingHTTPServer` + `BaseHTTPRequestHandler`，无 Flask/FastAPI
- 无数据库、无 Redis、无第三方 Web 框架

## 文件结构

```
main.py                  # 入口：启动服务器 + pywebview 窗口
server/
  app.py                 # HTTP 路由处理（~450 行）
  sse.py                 # SSE 事件管理器（scan_id → queue.Queue）
scanner/
  cache.py               # 本地磁盘缓存（load/save cache.json）
  pythons.py             # Python 安装发现（PATH + 注册表）
  venvs.py               # 虚拟环境发现（扫描 pyvenv.cfg）
  pip_cache.py           # pip 缓存统计
static/
  app.js                 # 前端全部逻辑（~1800 行）
  style.css              # 样式（~1400 行）
  index.html             # DOM 结构（~250 行）
```

## API 路由表

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/cache` | 加载缓存扫描结果 |
| `GET` | `/api/scan` | 启动新扫描，返回 `scan_id` |
| `GET` | `/api/scan/progress?scan_id=` | SSE 实时事件流 |
| `GET` | `/api/packages?python_path=` | 获取某 Python 环境的包列表 |
| `GET` | `/api/pip-cache` | 实时 pip 缓存数据 |
| `POST` | `/api/uninstall/preview` | 卸载前安全检查 |
| `POST` | `/api/uninstall` | 执行卸载 |
| `POST` | `/api/cache/clear/preview` | pip 缓存清理预览 |
| `POST` | `/api/cache/clear` | 执行 pip 缓存清理 |
| `POST` | `/api/open-folder` | 在文件管理器中打开路径 |
| `POST` | `/api/delete-venv` | 删除虚拟环境目录 |

## 扫描数据流

```
GET /api/scan
  → server 创建 scan_id，起 daemon 线程跑三个 scanner
  → 立即返回 {scan_id, status: "started"}
  → 前端 connectSSE(scanId) 打开 EventSource

SSE 事件类型：
  phase_update   — 增量进度（每发现一个 Python/venv 推一次）
  scan_complete  — 扫描完成（含全部 pythons/venvs/pip_cache 数据）
  scan_error     — 扫描异常

scan_complete 后：
  → save_cache() 写 cache.json
  → 前端 renderScanResults(data) 渲染全部表格和统计卡片
```

## 前端全局状态 (app.js)

| 变量 | 行号 | 类型 | 用途 |
|---|---|---|---|
| `allPythonsData` | 332 | array | Python 安装列表 |
| `allVenvsData` | 333 | array | 虚拟环境列表 |
| `currentScanId` | 327 | string\|null | 当前扫描 ID |
| `selectedPython` | 328 | object\|null | 当前选中查看包列表的环境 |
| `previousTab` | 329 | string | 切换到包列表前的标签页 |
| `expandedLinkedPythonPath` | 334 | string\|null | 展开关联 venv 的 Python 行 |
| `currentVenvSubtab` | 544 | string | venv 子标签：「all」/「duplicates」 |
| `needsOnboarding` | 79 | boolean | 扫描后是否启动教程 |
| `onboardingActive` | 177 | boolean | 教程是否显示中 |
| `onboardingStep` | 178 | number | 当前教程步骤索引 (-1 = 未激活) |
| `_onboardingScanDone` | 179 | boolean | 扫描是否在教程期间完成 |
| `uninstallContext` | 1356 | object\|null | 卸载流程上下文 |
| `cacheClearContext` | 1357 | object\|null | 缓存清理流程上下文 |

**没有** `localStorage` / `sessionStorage` / `indexedDB` 调用。所有持久化靠后端 `cache.json`。

## 缓存系统

- 文件位置：Linux/macOS `~/.config/PyPeek/cache.json`，Windows `%APPDATA%/PyPeek/cache.json`
- 数据结构：`{scanned_at, scan_summary, pythons, venvs, pip_cache}`
- `load_cache()` 返回 `None` 的情况：文件不存在、JSON 损坏、缺少必需字段、**超过 7 天过期**
- 页面加载 → `loadCachedData()` IIFE → 有缓存就渲染，无缓存显示欢迎弹窗
- **7 天 TTL**：`CACHE_MAX_AGE_SECONDS = 7 * 24 * 3600`，过期缓存等同首次启动

## Onboarding 教程流

5 步骤（`ONBOARDING_STEPS` 数组，app.js:103-175）：
1. 统计卡片（`#stat-cards`）
2. 标签页栏（`#tab-bar`），beforeShow 自动切到 pythons 标签
3. 扫描进度条（`#scan-bar`）— 已扫过则跳过
4. 表格第一行（`#panel-pythons .data-table__row--expandable:first-child`）
5. 安全徽章（`#panel-packages .safety-badge:first-of-type`），beforeShow 异步等待包列表加载

触发路径：
- 欢迎弹窗「开始扫描」→ `needsOnboarding=true` → 启动教程
- Header 「?」按钮 → 有数据时重新进入教程，**跳过 Step 3**（`_onboardingScanDone=true`）
- Escape → 退出教程

## 关键渲染函数

| 函数 | 行号 | 说明 |
|---|---|---|
| `renderScanResults(data)` | 357 | 总入口：存 globals → 调各表格渲染 → 更新统计卡片 |
| `renderPythonsTable(pythons)` | 469 | Python 表：版本/路径/来源/关联venv数/包数/大小/操作 |
| `renderVenvsTable(venvs)` | 546 | Venv 表：含重复组彩色边框、子标签过滤 |
| `renderPipCacheTab(pipCache)` | 1080 | pip 缓存：CSS 柱状图 + 清理按钮 |
| `selectPythonRow(row)` | ~990 | 点击行展开包列表（调 `/api/packages`） |
| `updateStatCard(cardId, value)` | 1184 | 更新顶部统计卡片数字 |

## 双向关联 (Python ↔ Venv)

- `isRelatedPython(pythonPath, venvHomePath)` — 三种匹配：精确/父目录前缀/反向前缀
- Python 表「关联 venv」列 — 点击数字展开子列表，可跳转 venv 标签
- Venv 表「来源 Python」列 — 可点击链接，跳转 Python 标签 + 高亮闪烁

## 重复环境检测

- 后端给 `pythons`/`venvs` 打 `duplicate_group` 标记（含同组路径列表）
- Venv 子标签「全部」/「可能重复 (N)」— 纯前端过滤 `applyVenvSubtabFilter()`
- `applyDuplicateGroupStyling()` — 8 色调色板给同组行赋彩色左边框
- 删除 venv 后 `_cleanupDuplicateGroup()` 清理引用，单成员去标记
