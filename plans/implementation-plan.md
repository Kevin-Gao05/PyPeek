# PyPeek — Implementation Plan

## Context

Windows 新手装了 Python（python.org / Microsoft Store / conda，不知道从哪装的），跟着教程跑过 `pip install`、`conda install`，几个月后 C 盘红条了。他们不知道哪些能删、哪些不能删、删了会不会搞坏项目。

PyPeek 打开即看——自动发现本机所有 Python 生态，结构化展示 + 安全卸载。

### Target User

刚学 Python 的大学生/轻度用户。不认识终端，需要双击图标就能打开的东西。

### 产品定位（来自 grill-with-docs）

- 浏览为主，可安全卸载（依赖检查 + 分级警告）
- 去 uv，覆盖 pip + conda + Python 安装 + venvs
- 导航按 Python 生态结构组织，配工具提示说明
- 快速展示（<1s）+ 后台深度扫描

## Architecture

```
┌──────────────────────────┐
│   pywebview (native win) │  ← 无浏览器外壳
│  ┌──────────────────────┐│
│  │  HTML + CSS + JS     ││  ← 暗色主题，单页应用
│  │  SSE consumer        ││
│  │  5 tabs + progress   ││
│  └──────────┬───────────┘│
│             │ HTTP/SSE    │
│  ┌──────────▼───────────┐│
│  │  ThreadingHTTPServer ││  ← 标准库，多线程
│  │  SSE push manager    ││
│  │  /api/* routes       ││
│  └──────────┬───────────┘│
│             │ subprocess  │
│  ┌──────────▼───────────┐│
│  │  Scanner modules     ││
│  │  pythons / venvs     ││
│  │  pip_cache / pkgs    ││
│  │  conda (optional)    ││
│  └──────────────────────┘│
└──────────────────────────┘
```

## Dependencies

```
pywebview          # 原生桌面窗口
```

全部 subprocess 调系统命令。不依赖 fastapi、flask、jinja2 等 web 框架。`importlib.metadata` 仅用于扫描 PyPeek 自身所在的 Python。

## File Structure

```
PyPeek/
├── main.py              # 入口：启动 server + webview 窗口
├── start.bat            # 一键启动
├── requirements.txt
├── README.md
├── CONTEXT.md           # 领域术语表（已写）
├── scanner/
│   ├── __init__.py
│   ├── pythons.py       # Python 安装发现
│   ├── venvs.py         # pyvenv.cfg 搜索
│   ├── pip_cache.py     # pip cache 统计
│   ├── site_packages.py # 包详情 + 依赖
│   └── conda.py         # conda 检测 + 环境
├── server/
│   ├── __init__.py
│   ├── app.py           # HTTP 路由 + SSE 端点
│   └── sse.py           # SSE 事件管理
├── static/
│   ├── index.html       # 单页主界面
│   ├── style.css        # 暗色主题
│   └── app.js           # SSE 消费 + tab + 进度条
└── plans/
    └── (this file)
```

## Backend: API Design

### `GET /api/scan`

Starts a full scan. Returns immediately with `{"scan_id": "uuid", "status": "started"}`.
Subscribes the caller to SSE events on `GET /api/scan/progress?scan_id=uuid`.

### `GET /api/scan/progress?scan_id=uuid`

SSE endpoint. Pushes phase snapshots as scanning progresses:

```
event: phase_update
data: {
  "phase": "pythons|venvs|pip_cache|site_packages|conda",
  "done": false,
  "progress": 0.35,
  "pythons": [...],
  "venvs": [...],
  "pip_cache": null,
  "conda_envs": null
}

event: scan_complete
data: {"done": true, "pythons": [...], "venvs": [...], "pip_cache": {...}, "conda_envs": [...]}
```

### `POST /api/uninstall`

```json
// Request
{"python_path": "C:\\...\\python.exe", "package": "numpy"}

// Response
{"ok": true, "message": "numpy 2.1.0 uninstalled"}
```

Or:

```json
{"ok": false, "error": "DEPENDENCY_CONFLICT", "required_by": ["pandas", "scipy"], "message": "numpy is required by pandas, scipy. Continue?"}
```

Frontend calls a second time with `force: true` to proceed despite warnings.  critical packages reject unconditionally.

### Dependency Check Logic

```python
def check_uninstall_safety(python_path, package_name):
    """Returns (level, required_by_list)."""
    CRITICAL = {'pip', 'setuptools', 'wheel', 'pkg_resources'}
    if package_name in CRITICAL:
        return ('danger', [])
    result = subprocess.run(
        [python_path, '-m', 'pip', 'show', package_name],
        capture_output=True, text=True
    )
    required_by = parse_required_by(result.stdout)
    if required_by:
        return ('warning', required_by)
    return ('safe', [])
```

## Scanner Modules

### Module 1: Python Installation Discovery (`scanner/pythons.py`)

**Fast path** (runs first, <1s):

1. `where python` / `where python3` — get all Pythons on PATH
2. Windows registry — `HKLM\SOFTWARE\Python\PythonCore\` and `HKCU\SOFTWARE\Python\PythonCore\`
3. Deduplicate by `python.exe` path

**Deep scan** (background, optional):

1. `os.scandir` walk `C:\` excluding `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`, `$Recycle.Bin`
2. Find `python.exe` files
3. Skip junction points / reparse points
4. Walk other drive roots (D:\, E:\ if present)
5. Progress reported via SSE callback

Data per Python installation:

```json
{
  "path": "C:\\Program Files\\Python312\\python.exe",
  "version": "3.12.10",
  "source": "python.org",
  "package_count": 23,
  "site_packages_size_mb": 1200
}
```

Source detection heuristic:

- Path contains `WindowsApps` → `microsoft_store`
- Path contains `anaconda` or `miniconda` → `conda`
- Path contains `Program Files\Python` → `python.org`
- Otherwise → `unknown`

### Module 2: Virtual Environment Discovery (`scanner/venvs.py`)

1. `os.scandir` walk (same safety rules as Module 1 deep scan)
2. Target: files named `pyvenv.cfg`
3. For each found: read `pyvenv.cfg` → extract `version_info`, `home`, `uv` version if present
4. Compute dir size via `os.scandir` walk
5. Get `last_modified` from directory stat
6. `pip list --format json --python <venv>\Scripts\python.exe` for package listing
7. `pip show <pkg>` per package for Summary + Required-by (background, after initial display)

Data per venv:

```json
{
  "path": "C:\\Users\\tom\\myproject\\.venv",
  "python_version": "3.12.10",
  "home_python": "C:\\Program Files\\Python312\\",
  "total_size_mb": 156,
  "package_count": 12,
  "last_modified": "2026-07-15T14:30:00",
  "packages": [
    {"name": "flask", "version": "3.1.0", "size_mb": 8.5, "summary": "...", "safety": "safe"}
  ]
}
```

### Module 3: pip Package Cache (`scanner/pip_cache.py`)

1. `pip cache info` → parse text output for aggregate numbers
2. `os.scandir` walk `%LOCALAPPDATA%\pip\cache\` for per-category sizes
3. Present as graphical breakdown, not raw text

Data:

```json
{
  "path": "C:\\Users\\tom\\AppData\\Local\\pip\\cache",
  "total_size_mb": 340,
  "categories": [
    {"name": "HTTP cache", "path": "...", "size_mb": 280, "file_count": 47, "description": "Downloaded wheel and sdist files"},
    {"name": "Self-check", "path": "...", "size_mb": 0.5, "file_count": 2, "description": "pip's own update check data"},
    {"name": "Locally built wheels", "path": "...", "size_mb": 60, "file_count": 5, "description": "Wheels built locally from sdist"}
  ]
}
```

If `pip` not on PATH on the PyPeek host Python, fall back to pure filesystem scan.

### Module 4: Site-Packages Detail (`scanner/site_packages.py`)

For each discovered Python installation or venv:

1. Locate `site-packages` dir (`Lib\site-packages` under Python root or venv)
2. `os.scandir` each top-level package dir for size
3. **Fast display**: from `pip list --format json --python <path>` → name + version → compute dir sizes → show immediately
4. **Background enrichment**: `pip show <pkg> --python <path>` per package → add `summary`, `required_by`, `safety` level
5. Progress reported as `{site_packages_enriched: 5/12}` in SSE updates

Cache rule: `pip show` results cached for the session (they don't change during a single PyPeek run).

### Module 5: Conda (`scanner/conda.py`)

1. **Detection**: `conda --version` or `where conda`. If not found → skip entirely, no conda tab in UI
2. `conda info --json` → base prefix, envs dirs, package cache
3. `conda env list --json` → all environments with paths
4. For each env: `conda list --json --prefix <path>` → packages
5. Package cache size: `os.scandir` walk `pkgs/` directory

## Frontend Design

### Design Tokens

- Dark theme (developer tool feel)
- Accent: `#7C3AED` (purple)
- Background: `#0F172A` (slate-900)
- Surface: `#1E293B` (slate-800)
- No external CSS/JS framework

### Layout

```
┌──────────────────────────────────────────────────┐
│   PyPeek                    [Settings] [About] │ ← header
├──────────────────────────────────────────────────┤
│  Quick Scan complete. 2 Pythons found.            │
│  Deep scan ████████████░░░░ 67%  (found 3 venvs) │ ← scan bar
├──────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│  │Python  │ │  venvs │ │pip     │ │site-   │   │ ← stat cards
│  │2 found │ │ 5 found│ │340 MB  │ │pkgs    │   │
│  └────────┘ └────────┘ └────────┘ └────────┘   │
├──────────────────────────────────────────────────┤
│ Tab: [Pythons] [Venvs] [pip Cache] [Packages]    │ ← tab bar
│       [Conda]*                                    │   * if detected
├──────────────────────────────────────────────────┤
│                                                   │
│  Main content area — scrollable                   │
│                                                   │
│  Pythons tab: table (version, path, source,       │
│  package count, size). Click → expand packages.   │
│                                                   │
│  Venvs tab: table (path, python ver, size,        │
│  last used, package count). Sortable columns.     │
│  Click → expand package list.                     │
│                                                   │
│  Pip Cache tab: horizontal bar chart (CSS only)   │
│  of categories, then detail table. [Clear] button │
│  runs `pip cache purge`.                          │
│                                                   │
│  Packages tab: selected Python/venv's packages.   │
│  Table: name | ver | size | safety | desc.        │
│  Click package → detail panel with summary,       │
│  required-by list. [Uninstall] button.            │
│                                                   │
│  Conda tab: envs table + pkgs cache size.         │
│                                                   │
└──────────────────────────────────────────────────┘
```

### Key Interactions

- **Progress bar**: real-time SSE-driven, shows phase + found count
- **Expandable rows**: click a Python/venv → package list slides open
- **Sortable columns**: click column header to sort
- **Safety colors**:  green badge /  yellow badge /  red badge next to package names
- **Uninstall flow**: click [Uninstall] → dependency check → if  show warning modal → confirm → execute → refresh list
- **Tooltips**: `?` icon next to terms like "venv", "site-packages", "pip cache" with one-line explanations

## Implementation Order

### Phase 1: Scaffold

1. Init `requirements.txt` with `pywebview`
2. `main.py` — minimal HTTP server (health endpoint `GET /api/health`) + pywebview window
3. `start.bat` — check pip, `pip install -r requirements.txt`, `python main.py`
4. `static/index.html` — skeleton HTML with dark theme CSS variables + tab bar (empty tabs)

### Phase 2: Python Discovery (Module 1)

5. `scanner/pythons.py` — PATH + registry fast scan
6. `server/app.py` — `/api/scan` trigger, `/api/scan/progress` SSE endpoint
7. `server/sse.py` — SSE event manager (thread-safe queue per scan)
8. `static/app.js` — SSE consumer, progress bar, Pythons tab populated
9. `static/style.css` — stat cards, table styles, progress bar animation

### Phase 3: Venv Discovery (Module 2)

10. `scanner/venvs.py` — `pyvenv.cfg` search with safety exclusions
11. SSE updates: push found venvs as they're discovered
12. Frontend: Venvs tab with expandable rows

### Phase 4: pip Cache (Module 3)

13. `scanner/pip_cache.py` — `pip cache info` parser + directory scan fallback
14. Frontend: pip Cache tab with CSS bar chart + category table

### Phase 5: Site Packages Detail (Module 4)

15. `scanner/site_packages.py` — fast display + background enrichment
16. Frontend: Packages tab, expand from Python/venv click, safety badges
17. Uninstall flow: dependency check modal + confirm + execute

### Phase 6: Conda (Module 5)

18. `scanner/conda.py` — detection + env listing
19. Frontend: conda tab (shown only if detected)

### Phase 7: Polish

20. Deep scan implementation (background filesystem walk)
21. Settings tab: configure scan paths
22. Loading / error / empty states
23. Tooltips for all domain terms
24. Refresh / re-scan button

## Verification

### Phase 1

- `python main.py` → pywebview window opens, shows skeleton UI
- `GET /api/health` returns `{"status": "ok"}`

### Phase 2

- Window shows Python count immediately (< 1s)
- SSE progress events flowing
- Stat cards update as data arrives

### Phase 3

- Venvs tab populated with real venvs from the system
- Expandable rows show package lists

### Phase 4

- pip cache tab shows bar chart with real numbers
- Data matches `pip cache info` output

### Phase 5

- Click a Python → see its packages with sizes and safety badges
- Uninstall a  package → disappears from list
- Try uninstall a  package → warning modal appears
- Try uninstall a  package → rejected

### Phase 6

- If conda present: tab visible with env list
- If conda absent: tab hidden entirely

### Windows-specific

- Verify on a real Windows machine with pip+conda
- Verify deep scan excludes `C:\Windows\` and `C:\Program Files\`
- Verify junction points don't cause infinite loops
- Verify `start.bat` works when double-clicked from Explorer
