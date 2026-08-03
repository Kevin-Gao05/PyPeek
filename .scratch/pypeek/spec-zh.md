# PyPeek 产品规格书

## 问题描述

一个新手在 Windows 上装了 Python（python.org、Microsoft Store 还是 conda —— 他自己也不知道）。跟着教程跑过 `pip install`、可能还跑过 `conda install`，建过几个带 `.venv` 的项目文件夹。几个月后 C 盘红了。他不知道：

- 机器上到底装了几个 Python
- 虚拟环境散落在哪、哪些还在用
- pip 和 conda 缓存吃了多少空间
- 每个 Python 环境里装了哪些包、哪些可以安全删掉

他打开 PyPeek，一眼看全，安全清理 —— 不用碰终端。

## 解决方案

PyPeek 是一个**桌面应用**（pywebview 原生窗口），自动发现并可视化 Windows 上用户的 Python 生态。展示内容包括：每台机器上的所有 Python 安装、所有虚拟环境、pip/conda 包缓存、以及每个包的详细信息和安全评级。用户可以通过界面安全卸载包，带依赖冲突警告保护。

## 用户故事

### 发现与首次启动

1. 作为新手，我想从 GitHub 下载后双击 `start.bat` 就能启动 PyPeek，这样我不用敲终端命令。
2. 作为新手，我想打开 PyPeek 后立刻看到结果（1 秒内），这样我不会以为它坏了。
3. 作为新手，我想在 PyPeek 深度搜索时看到一个进度条，这样我知道它还在工作。
4. 作为新手，我想 PyPeek 能找到不在 PATH 里的 Python 安装，这样我能发现自己都忘了装过的东西。

### Python 安装

5. 作为新手，我想看到机器上每个 Python 安装的版本、来源（python.org / Microsoft Store / conda）和磁盘占用，这样我知道自己有什么。
6. 作为新手，我想点开一个 Python 安装后看到它全局 site-packages 里装的所有包，这样我知道每个 Python 自带了什么。

### 虚拟环境

7. 作为新手，我想 PyPeek 能找到整个机器上所有的 `.venv` 目录，这样我能发现早就忘掉的旧环境。
8. 作为新手，我想看到每个 venv 的 Python 版本、总大小、包数量和最后修改时间，这样我能判断哪些是老的、不再用的。
9. 作为新手，我想点开一个 venv 然后看到它装的包及各自大小，这样我知道里面有什么。
10. 作为新手，我想知道一个 venv 是从哪个 Python 安装创建的，这样我能理解它们之间的关系。

### 包缓存

11. 作为新手，我想看到 pip 下载缓存占了多大空间、按类别拆开看，这样我能意识到这是可以回收的空间。
12. 作为新手，我想用图表看缓存大小，而不是原始终端输出，这样我能一眼看懂。
13. 作为同时有 conda 的用户，我想看到 conda 包缓存和 pip 缓存并排展示，这样我有完整的图景。

### 包管理

14. 作为新手，我想看到每个包的名称、版本和磁盘大小，这样我知道什么在占空间。
15. 作为新手，我想要每个包有一句简短的功能说明，这样我不会误删重要的东西。
16. 作为新手，我想知道哪些其他包依赖于某个包，这样我理解删除它的后果。
17. 作为新手，我想每个包用颜色标记（绿色 = 可安全删、黄色 = 有其他包依赖它、红色 = 系统关键不可删），这样我不懂 Python 也能安全决策。
18. 作为新手，我想点绿色包的"卸载"，它就直接删掉，这样我能回收空间。
19. 作为新手，我想在卸载黄色包时看到一个清晰的警告，列出具体哪些东西会坏，这样我不会搞炸自己的项目。
20. 作为新手，我想 PyPeek 拒绝卸载红色（系统关键）包，这样我不能搞坏 Python 本身。

### Conda 集成

21. 作为 conda 用户，我想看到所有 conda 环境及其包，这样我有一个统一的视图。
22. 作为不用 conda 的人，我想 PyPeek 完全隐藏 conda 相关信息，这样界面保持简洁。

### 设置与定制

23. 作为进阶用户，我想限制文件系统扫描到指定目录，这样扫描更快、只覆盖我的项目区域。
24. 作为进阶用户，我想不重启应用就能触发重新扫描，这样我在 PyPeek 外面装/删东西后能立刻看到变化。

## 实现决策

### 架构

1. **桌面外壳**：pywebview 把原生 Windows 窗口包在 HTML/CSS/JS 前端外面。没有浏览器外壳，没有地址栏。
2. **后端**：Python 标准库 `ThreadingHTTPServer` 在 localhost 上提供静态文件 + JSON/SSE API。
3. **实时扫描**：服务器发送事件（SSE）在每个扫描模块运行时推送阶段快照。前端订阅单个 SSE 端点，逐步渲染结果。
4. **前端**：单页应用（纯 HTML/CSS/JS，暗色主题，无框架）。五个标签页对应五个发现模块。启动时展示统计卡片看板。
5. **数据采集**：所有外部数据通过 `subprocess` 调用 `pip`、`conda`、Windows 注册表查询、以及 `os.scandir` 文件系统遍历获取。

### 扫描策略

6. **两阶段扫描**：阶段 A（快速路径）启动时运行 PATH 查询和 Windows 注册表读取 —— 1 秒内出结果。阶段 B（深度扫描）在后台遍历文件系统，通过 SSE 报告进度。
7. **Python 发现**：PATH（`where python`）+ 注册表（`HKLM\SOFTWARE\Python\PythonCore\`、`HKCU\SOFTWARE\Python\PythonCore\`）+ 可选的文件系统遍历发现未注册的安装。
8. **Python 来源识别**：基于安装路径启发式判断 —— `WindowsApps` → Microsoft Store；`anaconda`/`miniconda` → conda；`Program Files\Python` → python.org。
9. **Venv 发现**：递归文件系统搜索 `pyvenv.cfg` 文件。安全排除：跳过 `C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\ProgramData`、`$Recycle.Bin`。不跟踪 Windows junction/reparse point。
10. **Venv 详情**：读 `pyvenv.cfg` 获取 Python 版本和 home Python。通过 `os.scandir` 遍历计算目录大小。通过 `pip list --format json --python <path>` 获取包列表。
11. **包缓存发现**：解析 `pip cache info` 获取汇总数字。遍历 `%LOCALAPPDATA%\pip\cache` 获取分类详情。如果 `pip` 不在 PATH 上则降级为纯文件系统扫描。
12. **Site-packages 详情**：对每个 Python 或 venv，通过 `pip list --format json --python <path>` 获取包列表。通过 `os.scandir` 计算每个包目录大小。快速展示先显示名称 + 版本 + 大小；后台富化通过 `pip show <pkg> --python <path>` 补充简介和 Required-by。
13. **Conda 集成**：扫描前先检测 conda 是否存在（`conda --version` 或 `where conda`）。如不存在，跳过整个 conda 模块并隐藏 conda 标签页。如存在，通过 `conda env list --json` 发现环境，通过 `conda list --json --prefix <path>` 获取包列表。

### 安全与卸载

14. **安全分级**： 安全（无反向依赖）， 警告（存在反向依赖）， 关键（`pip`、`setuptools`、`wheel`、`pkg_resources` —— 无条件拒绝卸载）。
15. **依赖检查**：卸载前运行 `pip show <pkg> --python <path>` 并解析 `Required-by` 字段。
16. **卸载流程**：用户点"卸载" → 后端检查依赖 → 如果是 ，返回依赖包列表 → 前端显示警告弹窗 → 用户确认后二次显式操作 → 后端执行 `pip uninstall -y <pkg> --python <path>`。
17. **无撤销**：卸载是永久的（与 pip 行为一致）。恢复需通过 `pip install` —— 用户可在 PyPeek 之外操作。

### API 契约

18. **扫描触发**：`GET /api/scan` 启动扫描，返回 `{"scan_id": "<uuid>", "status": "started"}`。
19. **扫描进度**：`GET /api/scan/progress?scan_id=<uuid>` 是 SSE 端点。事件类型：`phase_update`（每个扫描阶段的部分快照）和 `scan_complete`（完整数据）。
20. **SSE 事件格式**（`phase_update`）：

```json
{
  "phase": "pythons|venvs|pip_cache|site_packages|conda",
  "done": false,
  "progress": 0.35,
  "pythons": [{"path": "...", "version": "3.12.10", "source": "python.org", "package_count": 23, "site_packages_size_mb": 1200}],
  "venvs": [{"path": "...", "python_version": "3.12.10", "home_python": "...", "total_size_mb": 156, "package_count": 12, "last_modified": "2026-07-15T14:30:00", "packages": [...]}],
  "pip_cache": null,
  "conda_envs": null
}
```

21. **卸载**：`POST /api/uninstall` 请求体 `{"python_path": "...", "package": "numpy"}`。返回 `{"ok": true}` 或 `{"ok": false, "error": "DEPENDENCY_CONFLICT", "required_by": ["pandas"]}`。第二次调用带上 `{"force": true}` 则跳过警告继续执行。

### 前端设计

22. **主题**：暗色（背景 `#0F172A`，表面 `#1E293B`，强调色 `#7C3AED`）。无外部 CSS 框架。
23. **布局**：顶栏 → 扫描进度条 → 统计卡片（Python 数量、venv 数量、缓存大小、包数量）→ 标签页栏（Python 安装、虚拟环境、pip 缓存、包、Conda）→ 可滚动内容区域。
24. **进度条**：实时，由 SSE `progress` 字段驱动。显示当前阶段名称和已找到数量。
25. **可展开行**：点击一个 Python 安装或 venv 行展开内嵌的包表格。
26. **安全徽章**：包列表中每个包名旁边渲染 // 徽章。
27. **Conda 标签页可见性**：默认隐藏，仅当检测到 conda 且扫描结果包含 conda 数据时才显示。
28. **工具提示**：领域术语（venv、site-packages、pip 缓存）旁边的 `?` 图标，给新手提供一行解释。

### 多盘符支持

29. **盘符遍历**：深度扫描时遍历所有可用的盘符根目录（C:\、D:\、E:\ 等）。每个盘符应用相同的安全排除规则。

## 测试决策

### 什么算好的测试

- 对 **HTTP API 缝** 测试 —— 前后端之间唯一的分界。每个测试发 HTTP 请求，断言 JSON 响应。
- 测试**外部行为**，不是内部实现。不要测试 `scanner/pythons.py` 是否调了某个注册表键；测试 `GET /api/scan/progress` 是否返回正确 shape 的 Python 安装列表。
- 在真实工具不存在时 mock subprocess 调用，但优先在安装了对应工具的系统上跑集成测试。
- 对于卸载流程：测试依赖冲突是否能被正确检测，以及冲突确认后 force-uninstall 是否正常工作。

### 测试覆盖模块

| 模块            | 测试重点                       |
| ------------- | -------------------------- |
| Python 发现     | PATH 解析、注册表读取、去重           |
| Venv 发现       | `pyvenv.cfg` 查找、安全排除、大小计算  |
| pip 缓存        | `pip cache info` 解析、目录扫描降级 |
| Site-packages | 包列表、大小计算、依赖解析              |
| Conda         | 存在性检测门控、环境列表               |
| SSE 管理器       | 线程安全、阶段排序、完成信号             |
| 卸载            | 安全检查、force 标志、错误处理         |

## 不在范围内

- **uv 支持**：uv 被明确排除。此工具聚焦 pip 和 conda，这两个是 Windows 新手最困惑的包管理器。
- **安装/升级包**：仅支持卸载。安装或升级需要依赖解析，超出此工具范围。
- **跨平台**：仅 Windows。Linux 和 macOS 不在范围内。
- **远程/网络扫描**：仅本地 Python 安装和包。不扫描远程服务器或云环境。
- **包搜索/推荐**：无 PyPI 搜索或包建议。
- **批量卸载**：一次一个包，每次单独做依赖检查。
- **撤销/回滚**：卸载是永久的，无快照或回滚。
- **非 Python 磁盘占用**：仅 Python 相关目录。PyPeek 不是通用磁盘分析器。

## 补充说明

- 实现计划（`plans/implementation-plan.md`）提供了逐个模块的详细分解。本规格书是权威需求文档；实现计划是工程执行指南。
- 领域模型（`CONTEXT.md`）定义了所有术语。所有代码、UI 标签和文档必须使用术语表中的规范术语。
- 本规格书由 `/grill-with-docs` 产出 —— 每一项决策都经过了与利益相关者的对抗式盘问。
