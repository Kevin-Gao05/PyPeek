# PyPeek -- Python 环境桌面浏览器

[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)](https://github.com/Kevin-Gao05/PyPeek)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/Kevin-Gao05/PyPeek)

双击即开，一眼看全你 Windows 机器上所有的 Python 安装、虚拟环境和 pip 缓存 -- 安全清理不需要的，全程不用碰终端。

## 功能

- **Python 安装发现** -- 通过 PATH 和 Windows 注册表找到所有 Python 安装，识别来源：python.org、Microsoft Store 或 Conda。
- **虚拟环境发现** -- 全盘递归搜索 `pyvenv.cfg` 文件。显示版本、大小、包数量、最后修改时间。检测重复环境。
- **pip 缓存可视化** -- 以横向柱状图展示缓存分类，附带中文说明（"删了也不影响已安装的包"）。
- **包浏览器** -- 点击任意 Python 或 venv 行展开包列表，显示名称、版本、大小、简介和卸载安全等级。
- **安全卸载** -- 三级安全分级：
  - **不可卸载**：pip、setuptools、wheel（Python 包管理基础设施，卸载会导致 pip 不可用）。按钮灰色禁用。
  - **不建议卸载**：其他已安装包声称依赖此包。可查看依赖者列表，需显式确认"强制卸载"。
  - **可以卸载**：无已知依赖。附带提醒：PyPeek 无法检测项目代码中的 import 依赖。
- **删除虚拟环境** -- 直接从表格中删除不用的 venv。校验 pyvenv.cfg 存在、拒绝符号链接、删除后验证目标目录确实消失。

## 快速开始

```bat
git clone https://github.com/Kevin-Gao05/PyPeek.git
cd PyPeek
start.bat
```

> 需要 Windows 10 或 11，已安装 Python 3.10+。首次运行会自动安装 `pywebview`。

如果想获得更丰富的测试数据（6 个不同场景的 venv），先运行：

```bat
setup_test_env.bat
```

这会创建覆盖所有安全等级的虚拟环境 -- 从空的（只有 pip）到依赖链复杂的（flask + requests），再到用于重复检测的双 venv 场景。

## 界面

```
+----------------------------------------------------------+
|  PyPeek                                  [刷新] [关于]    |
+----------------------------------------------------------+
|  [=== 扫描进度条 ===]                                      |
+----------------------------------------------------------+
|  +----------+  +----------+  +----------+  +----------+  |
|  |    2     |  |    5     |  |  340 MB  |  |   156    |  |
|  | Pythons  |  |  Venvs   |  | Pip 缓存  |  |  总包数  |  |
|  +----------+  +----------+  +----------+  +----------+  |
+----------------------------------------------------------+
|  [Python 安装] [虚拟环境] [pip 缓存] [包列表]              |
+----------------------------------------------------------+
|  版本     路径                    来源        包数   大小  |
|  3.12.10  C:\...\python.exe       python.org   23  1.2G |
|  3.11.5   C:\...\python.exe       ms-store      5    89M|
+----------------------------------------------------------+
```

## 项目结构

```
PyPeek/
  main.py                  入口：HTTP 服务 + pywebview 窗口
  start.bat                Windows 双击启动脚本
  setup_test_env.bat       测试环境一键搭建脚本
  scanner/
    pythons.py             Python 安装发现（PATH + 注册表）
    venvs.py               虚拟环境发现（pyvenv.cfg 全盘搜索）
    pip_cache.py           pip 缓存分析
    site_packages.py       包详情、安全分级、卸载
  server/
    app.py                 HTTP 路由 + API 端点 + CORS
    sse.py                 SSE 事件管理器（线程安全）
  static/
    index.html             单页骨架
    style.css              暗色主题
    app.js                 SSE 消费 + 标签页渲染 + 事件委托
  tests/
    setup_test_envs.py     测试 venv 工厂（6 种场景）
```

## 架构

PyPeek 是一个**纯本地桌面应用** -- 无 Web 框架、无浏览器外壳、无外部服务。

```
scanner/          (纯 Python，无 Web 依赖)
    |
    v
server/app.py     (ThreadingHTTPServer + SSE + CORS)
    |
    +-- GET /api/health              健康检查
    +-- GET /api/scan                触发完整扫描，返回 scan_id
    +-- GET /api/scan/progress       SSE 事件流（实时进度）
    +-- GET /api/packages            按 Python 路径获取包列表
    +-- POST /api/uninstall/preview  卸载前安全检查（dry-run）
    +-- POST /api/uninstall          执行卸载（带安全门控）
    +-- POST /api/open-folder        在 Windows 资源管理器中打开路径
    +-- POST /api/delete-venv        删除虚拟环境目录
    |
    v
static/           (HTML/CSS/JS，暗色主题，零框架)
```

**关键设计决策：**

- 零 Web 框架依赖 -- HTTP 服务用 Python 标准库 `ThreadingHTTPServer`。
- SSE（Server-Sent Events）推送扫描进度 -- 不用 WebSocket，不用轮询。
- 单个 `document` 级事件委托 -- 所有按钮点击通过一个处理器分发，避免事件竞态。
- 线程安全扫描锁 -- `threading.Lock` 防止并发扫描（返回 HTTP 429）。
- CORS 白名单 -- 仅允许 `127.0.0.1` 和 `localhost` 来源。

## 安全设计

包卸载经过三级检查：

| 等级 | 判断依据 | 操作 |
|------|---------|------|
| 不可卸载 | 包名为 `pip`、`setuptools`、`wheel` 或 `pkg_resources` | 按钮禁用，无法卸载 |
| 不建议卸载 | `pip show` 返回非空 `Required-by` 列表 | 显示依赖包列表，需显式"强制卸载" |
| 可以卸载 | 无已知依赖 | 正常确认弹窗，附带项目级 import 提醒 |

其他保护措施：
- 所有传给 pip 的包名前加 `--` 分隔符，防止参数注入。
- `python_path` 参数校验：仅允许合法的 Python 可执行文件名（如 `python.exe`、`python3.12`）。
- `delete-venv` 拒绝符号链接，要求 `pyvenv.cfg` 存在，删除后验证目录确实消失。
- `static/` 目录文件服务经过路径穿越校验。

## 开发

### 无 GUI 模式

```bash
python3 tests/server_only.py
# 浏览器打开 http://127.0.0.1:8080
```

### 跑测试

```bash
python3 tests/test_runner.py
```

测试套件覆盖 40 项断言，包括健康检查、静态文件、扫描触发、包浏览、安全分级、依赖冲突、venv 删除、并发控制、CORS 预检。

### Docker 测试

```bash
docker build -t pypeek-test .
docker run --rm pypeek-test
```

Docker 能测什么、Windows 实机必须测什么，详见 `.claude/test-coverage-matrix.md`。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解分支规范、提交格式、代码风格和 PR 流程。

## 许可证

MIT -- 详见 [LICENSE](LICENSE)。
