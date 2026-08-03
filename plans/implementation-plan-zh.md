# PyPeek — 实现计划

## 背景

Windows 新手装了 Python（python.org / Microsoft Store / conda，不知道从哪装的），跟着教程跑过 `pip install`、`conda install`，几个月后 C 盘红条了。他们不知道哪些能删、哪些不能删、删了会不会搞坏项目。

PyPeek 打开即看——自动发现本机所有 Python 生态，结构化展示 + 安全卸载。

### 目标用户

刚学 Python 的大学生/轻度用户。不认识终端，需要双击图标就能打开的东西。

### 产品定位（来自 grill-with-docs）

- 浏览为主，可安全卸载（依赖检查 + 分级警告）
- 去 uv，覆盖 pip + conda + Python 安装 + venvs
- 导航按 Python 生态结构组织，配工具提示说明
- 快速展示（<1s）+ 后台深度扫描

## 架构

```
┌──────────────────────────┐
│   pywebview (原生窗口)    │  ← 无浏览器外壳
│  ┌──────────────────────┐│
│  │  HTML + CSS + JS     ││  ← 暗色主题，单页应用
│  │  SSE 消费者           ││
│  │  5 个标签页 + 进度条   ││
│  └──────────┬───────────┘│
│             │ HTTP/SSE    │
│  ┌──────────▼───────────┐│
│  │  ThreadingHTTPServer ││  ← 标准库，多线程
│  │  SSE 推送管理器       ││
│  │  /api/* 路由          ││
│  └──────────┬───────────┘│
│             │ subprocess  │
│  ┌──────────▼───────────┐│
│  │  扫描器模块            ││
│  │  pythons / venvs     ││
│  │  pip_cache / pkgs    ││
│  │  conda（可选）        ││
│  └──────────────────────┘│
└──────────────────────────┘
```

## 依赖

```
pywebview          # 原生桌面窗口
```

全部 subprocess 调系统命令。不依赖 fastapi、flask、jinja2 等 web 框架。`importlib.metadata` 仅用于扫描 PyPeek 自身所在的 Python。

## 文件结构

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
    └── (本文件)
```

## 后端：API 设计

### `GET /api/scan`

启动一次完整扫描。立即返回 `{"scan_id": "uuid", "status": "started"}`。
为调用方订阅 `GET /api/scan/progress?scan_id=uuid` 上的 SSE 事件。

### `GET /api/scan/progress?scan_id=uuid`

SSE 端点。随着扫描进行推送各阶段快照：

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
// 请求
{"python_path": "C:\\...\\python.exe", "package": "numpy"}

// 响应
{"ok": true, "message": "numpy 2.1.0 已卸载"}
```

或：

```json
{"ok": false, "error": "DEPENDENCY_CONFLICT", "required_by": ["pandas", "scipy"], "message": "numpy 被 pandas, scipy 依赖。是否继续？"}
```

前端第二次调用时带上 `force: true` 跳过警告继续执行。 关键包无条件拒绝。

### 依赖检查逻辑

```python
def check_uninstall_safety(python_path, package_name):
    """返回 (安全等级, 被依赖列表)。"""
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

## 扫描器模块

### 模块 1：Python 安装发现 (`scanner/pythons.py`)

**快速路径**（先运行，<1s）：

1. `where python` / `where python3` —— 获取 PATH 上所有 Python
2. Windows 注册表 —— `HKLM\SOFTWARE\Python\PythonCore\` 和 `HKCU\SOFTWARE\Python\PythonCore\`
3. 按 `python.exe` 路径去重

**深度扫描**（后台运行，可选）：

1. `os.scandir` 遍历 `C:\`，排除 `C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\ProgramData`、`$Recycle.Bin`
2. 查找 `python.exe` 文件
3. 跳过 junction point / reparse point
4. 遍历其他盘符根目录（D:\、E:\ 等，如果存在）
5. 通过 SSE 回调报告进度

每个 Python 安装的数据结构：

```json
{
  "path": "C:\\Program Files\\Python312\\python.exe",
  "version": "3.12.10",
  "source": "python.org",
  "package_count": 23,
  "site_packages_size_mb": 1200
}
```

来源识别启发式规则：

- 路径包含 `WindowsApps` → `microsoft_store`
- 路径包含 `anaconda` 或 `miniconda` → `conda`
- 路径包含 `Program Files\Python` → `python.org`
- 其他 → `unknown`

### 模块 2：虚拟环境发现 (`scanner/venvs.py`)

1. `os.scandir` 遍历（安全规则同模块 1 深度扫描）
2. 目标：名为 `pyvenv.cfg` 的文件
3. 对每个发现的文件：读取 `pyvenv.cfg` → 提取 `version_info`、`home`、uv 版本（如有）
4. 通过 `os.scandir` 遍历计算目录大小
5. 从目录 stat 获取 `last_modified`
6. `pip list --format json --python <venv>\Scripts\python.exe` 获取包列表
7. 对每个包运行 `pip show <pkg>` 获取简介 + Required-by（后台执行，在初始展示之后）

每个虚拟环境的数据结构：

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

### 模块 3：pip 包缓存 (`scanner/pip_cache.py`)

1. `pip cache info` → 解析文本输出获取汇总数据
2. `os.scandir` 遍历 `%LOCALAPPDATA%\pip\cache\` 获取分类大小
3. 以图形化方式展示，而非原始文本

数据结构：

```json
{
  "path": "C:\\Users\\tom\\AppData\\Local\\pip\\cache",
  "total_size_mb": 340,
  "categories": [
    {"name": "HTTP 缓存", "path": "...", "size_mb": 280, "file_count": 47, "description": "已下载的 wheel 和 sdist 文件"},
    {"name": "自检缓存", "path": "...", "size_mb": 0.5, "file_count": 2, "description": "pip 自身的更新检查数据"},
    {"name": "本地构建的 wheel", "path": "...", "size_mb": 60, "file_count": 5, "description": "从 sdist 本地构建的 wheel"}
  ]
}
```

如果 PyPeek 宿主 Python 的 PATH 上没有 `pip`，降级为纯文件系统扫描。

### 模块 4：Site-Packages 详情 (`scanner/site_packages.py`)

对每个发现的 Python 安装或虚拟环境：

1. 定位 `site-packages` 目录（Python 根目录或 venv 下的 `Lib\site-packages`）
2. `os.scandir` 遍历每个顶层包目录获取大小
3. **快速展示**：从 `pip list --format json --python <path>` 获取名称 + 版本 → 计算目录大小 → 立即展示
4. **后台富化**：对每个包运行 `pip show <pkg> --python <path>` → 补充 `summary`、`required_by`、`safety` 等级
5. 进度以 SSE 更新形式报告：`{site_packages_enriched: 5/12}`

缓存规则：`pip show` 结果在会话期间缓存（单次 PyPeek 运行期间不会变化）。

### 模块 5：Conda (`scanner/conda.py`)

1. **检测**：`conda --version` 或 `where conda`。如果未找到 → 完全跳过，UI 中不显示 conda 标签页
2. `conda info --json` → base 前缀、环境目录、包缓存
3. `conda env list --json` → 所有环境及路径
4. 对每个环境：`conda list --json --prefix <path>` → 包列表
5. 包缓存大小：`os.scandir` 遍历 `pkgs/` 目录

## 前端设计

### 设计令牌

- 暗色主题（开发者工具风格）
- 强调色：`#7C3AED`（紫色）
- 背景色：`#0F172A`（slate-900）
- 表面色：`#1E293B`（slate-800）
- 无外部 CSS/JS 框架

### 布局

```
┌──────────────────────────────────────────────────┐
│   PyPeek                    [设置] [关于]       │ ← 顶栏
├──────────────────────────────────────────────────┤
│  快速扫描完成。发现 2 个 Python。                   │
│  深度扫描 ████████████░░░░ 67%  (发现 3 个 venv)  │ ← 扫描进度条
├──────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│  │Python  │ │  venvs │ │pip     │ │site-   │   │ ← 统计卡片
│  │发现 2  │ │ 发现 5 │ │340 MB  │ │pkgs    │   │
│  └────────┘ └────────┘ └────────┘ └────────┘   │
├──────────────────────────────────────────────────┤
│ 标签页: [Python 安装] [虚拟环境] [pip 缓存]        │ ← 标签页栏
│         [包列表] [Conda]*                          │   * 检测到才显示
├──────────────────────────────────────────────────┤
│                                                   │
│  主内容区域 — 可滚动                               │
│                                                   │
│  Python 安装标签页：表格（版本、路径、来源、         │
│  包数量、大小）。点击 → 展开包列表。                 │
│                                                   │
│  虚拟环境标签页：表格（路径、Python 版本、大小、     │
│  最后使用时间、包数量）。列可排序。                   │
│  点击 → 展开包列表。                               │
│                                                   │
│  Pip 缓存标签页：分类横向柱状图（纯 CSS）            │
│  + 详情表格。[清理] 按钮执行 `pip cache purge`。    │
│                                                   │
│  包列表标签页：选定 Python/venv 的包。              │
│  表格：名称 | 版本 | 大小 | 安全等级 | 简介。       │
│  点击包 → 详情面板，含简介和被依赖列表。             │
│  [卸载] 按钮。                                     │
│                                                   │
│  Conda 标签页：环境表格 + 包缓存大小。               │
│                                                   │
└──────────────────────────────────────────────────┘
```

### 关键交互

- **进度条**：实时，SSE 驱动，显示阶段名称和已发现数量
- **可展开行**：点击 Python 安装或 venv → 包列表展开
- **可排序列**：点击列标题排序
- **安全颜色**：包名称旁显示  绿色 /  黄色 /  红色徽章
- **卸载流程**：点击 [卸载] → 依赖检查 → 如果  显示警告弹窗 → 确认 → 执行 → 刷新列表
- **工具提示**：领域术语（venv、site-packages、pip 缓存）旁边的 `?` 图标，给新手提供一行解释

## 实现顺序

### Phase 1：脚手架

1. 初始化 `requirements.txt`，写入 `pywebview`
2. `main.py` — 最小 HTTP 服务（health 端点 `GET /api/health`）+ pywebview 窗口
3. `start.bat` — 检查 pip、`pip install -r requirements.txt`、`python main.py`
4. `static/index.html` — 骨架 HTML，暗色主题 CSS 变量 + 标签页栏（空标签页）

### Phase 2：Python 发现（模块 1）

5. `scanner/pythons.py` — PATH + 注册表快速扫描
6. `server/app.py` — `/api/scan` 触发器、`/api/scan/progress` SSE 端点
7. `server/sse.py` — SSE 事件管理器（线程安全的每扫描队列）
8. `static/app.js` — SSE 消费者、进度条、Python 安装标签页填充数据
9. `static/style.css` — 统计卡片、表格样式、进度条动画

### Phase 3：Venv 发现（模块 2）

10. `scanner/venvs.py` — `pyvenv.cfg` 搜索，带安全排除规则
11. SSE 更新：发现 venv 时即时推送
12. 前端：虚拟环境标签页及可展开行

### Phase 4：pip 缓存（模块 3）

13. `scanner/pip_cache.py` — `pip cache info` 解析器 + 目录扫描降级方案
14. 前端：pip 缓存标签页，CSS 柱状图 + 分类表格

### Phase 5：Site Packages 详情（模块 4）

15. `scanner/site_packages.py` — 快速展示 + 后台富化
16. 前端：包列表标签页，从 Python/venv 点击展开，安全徽章
17. 卸载流程：依赖检查弹窗 + 确认 + 执行

### Phase 6：Conda（模块 5）

18. `scanner/conda.py` — 检测 + 环境列表
19. 前端：Conda 标签页（仅检测到时显示）

### Phase 7：打磨

20. 深度扫描实现（后台文件系统遍历）
21. 设置标签页：配置扫描路径
22. 加载 / 错误 / 空状态处理
23. 所有领域术语的工具提示
24. 刷新 / 重新扫描按钮

## 验证

### Phase 1

- `python main.py` → pywebview 窗口打开，显示骨架 UI
- `GET /api/health` 返回 `{"status": "ok"}`

### Phase 2

- 窗口立即显示 Python 数量（< 1s）
- SSE 进度事件正常推送
- 统计卡片随数据到达更新

### Phase 3

- 虚拟环境标签页显示系统中真实的 venv 列表
- 可展开行显示包列表

### Phase 4

- pip 缓存标签页以柱状图展示真实数据
- 数据与 `pip cache info` 输出一致

### Phase 5

- 点击 Python 安装 → 查看其包列表，含大小和安全徽章
- 卸载  包 → 从列表中消失
- 尝试卸载  包 → 出现警告弹窗
- 尝试卸载  包 → 被拒绝

### Phase 6

- 如果存在 conda：标签页可见，显示环境列表
- 如果不存在 conda：标签页完全隐藏

### Windows 专项

- 在真实 Windows 机器上验证，含 pip+conda
- 验证深度扫描排除 `C:\Windows\` 和 `C:\Program Files\`
- 验证 junction point 不会导致死循环
- 验证 `start.bat` 从资源管理器双击可正常运行
