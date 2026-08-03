# PyPeek 竞品研究

**研究日期**: 2026-08-03
**结论**: 无完全重叠项目，PyPeek 可继续。有 6 个可参考的类似项目。

---

## 一、结论：无完全重叠项目

没有任何一个现有工具同时覆盖 PyPeek 的全部核心功能：

| PyPeek 核心功能 | 现有工具覆盖 |
|---|---|
| pip 安装发现 + 包详情 | pips、Dev-Janitor 部分覆盖 |
| conda 环境发现 | Conda Manager 覆盖 |
| venv 全盘发现 (pyvenv.cfg 搜索) | Jharu、VenviPy 部分覆盖 |
| pip/conda 缓存可视化 | Jharu 部分覆盖 |
|  安全卸载 + 依赖检查 | **无** |
| 面向新手的桌面 GUI | **无**（都是给开发者用的） |
| Windows 原生 .bat 一键启动 | **无** |

**PyPeek 的独特价值**: 面向 **Python 新手**，一键启动后自动展示"你的机器上有什么 Python 东西、占了多大空间、哪些能安全删"。现有工具的目标用户都是懂命令行的开发者。

---

## 二、竞品详情

### 1. Jharu — 最接近的参考

| 项目 | 详情 |
|------|------|
| 仓库 | https://github.com/riponcm/Jharu |
| Stars | 增长中（新项目） |
| 技术栈 | **Tauri (Rust + React)** |
| 平台 | macOS + Windows |
| 维护 |  活跃 (v0.2.0) |

**功能**:
- 发现系统中所有 venv 和 conda 环境，统计每个环境的包大小
- 计算跨环境重复安装的成本（如 PyTorch 装了 11 次）
- 清理 pip/conda/npm/Docker 等 25+ 种缓存
- 全盘树图/列表视图，按类型分类文件夹
- 每项有安全评级、系统位置保护

**与 PyPeek 对比**:
-  做得好的：venv 发现、缓存分析、磁盘可视化、安全评级
-  缺失的：面向的是开发者（清理工具定位），不展示包详情（Summary/Required-by），不支持从界面卸载包，新手友好度低

**参考价值**:  磁盘可视化和 venv 发现策略最佳参考

---

### 2. Dev-Janitor — 功能最丰富的开发者工具箱

| 项目 | 详情 |
|------|------|
| 仓库 | https://github.com/cocojojo5213/dev-janitor |
| Stars | ~832 |
| 技术栈 | **Electron + React + TypeScript** |
| 平台 | Windows / macOS / Linux |
| 维护 |  活跃 |

**功能**:
- 自动检测 36+ 开发工具（Python、pip、Node、Go 等）
- 管理全局 pip/npm/Composer 包，一键更新
- 清理 11 种包管理器的缓存
- AI 分析环境健康（离线 + 可选 OpenAI）
- 检测过期工具、PATH 冲突、端口问题

**与 PyPeek 对比**:
-  做得好的：工具发现、全局包管理、缓存清理
-  缺失的：不聚焦 Python（通用工具箱），无 venv 发现，无包详情，无依赖安全检查，Electron 体积大

**参考价值**:  工具发现策略和包管理 UI 可参考

---

### 3. pips — 唯一同时管 pip + conda 的 GUI

| 项目 | 详情 |
|------|------|
| 仓库 | https://github.com/ptytb/pips |
| Stars | 小众 |
| 技术栈 | **PowerShell GUI**（零依赖） |
| 平台 | Windows 原生 |
| 维护 |  活跃 |

**功能**:
- 统一搜索安装 pip、conda、GitHub 上的包
- 虚拟环境管理（防火墙规则、环境变量）
- 依赖树查看器、包信息工具提示
- 防 typosquatting 保护
- Vim 风格键盘导航

**与 PyPeek 对比**:
-  做得好的：唯一同时覆盖 pip + conda，包搜索安装体验好
-  缺失的：没有 venv 全盘发现，没有缓存分析，没有安全卸载分级，PowerShell 依赖，面向高级用户

**参考价值**:  pip + conda 双轨策略验证了市场需求

---

### 4. VenviPy — 最成熟的 venv GUI

| 项目 | 详情 |
|------|------|
| 仓库 | https://github.com/sinusphi/venvipy |
| Stars | 中等 |
| 技术栈 | **PyQt6** |
| 平台 | Linux / macOS / Windows (实验性) |
| 维护 |  活跃 (v0.4.4, 2026-02) |

**功能**:
- 向导式创建虚拟环境，可选 Python 版本
- 多标签页管理多个环境
- 一键安装/更新/检查包
- 生成 requirements.txt，从文件克隆环境

**与 PyPeek 对比**:
-  做得好的：venv 管理体验好，包操作流畅
-  缺失的：只管 venv，无 conda，无缓存分析，无全盘发现（需手动指定环境），面向开发者

**参考价值**:  venv 交互 UI 最佳参考

---

### 5. Conda Manager — conda 专用 GUI

| 项目 | 详情 |
|------|------|
| 仓库 | https://github.com/JBpeople/conda_manager |
| Stars | 新项目 |
| 技术栈 | **wxPython** |
| 平台 | Windows / macOS / Linux |
| 维护 |  活跃 (2025-01 创建) |

**功能**:
- 可视化显示所有 conda 环境及 Python 版本
- 创建/删除环境，选 Python 版本
- 查看每个环境的已安装包
- 右键打开环境文件夹或终端（自动激活）

**与 PyPeek 对比**:
-  做得好的：conda 环境管理直观
-  缺失的：只管 conda，无 pip，无 venv，无缓存，无安全卸载

**参考价值**:  conda 集成 UI 可参考

---

### 6. pip_gui — 最新、技术栈最前卫的 pip GUI

| 项目 | 详情 |
|------|------|
| 仓库 | https://github.com/programmersd21/pip_gui |
| Stars | 6（新项目） |
| 技术栈 | **Rust + Tauri 2.0 + Vanilla JS + Tailwind** |
| 平台 | Windows (.msi) / macOS (.dmg) / Linux |
| 维护 |  开发中 (2026-01 创建)，作者在招贡献者 |

**功能**:
- 自动检测 `.venv`、`venv`、`env` 目录，解析 `pyvenv.cfg`
- 浏览已安装包、搜索 PyPI、安装/升级/降级/卸载
- 解析 `requirements.txt`、`pyproject.toml`，可视化依赖状态
- Python 版本选择器、venv 快速切换

**与 PyPeek 对比**:
-  做得好的：venv 自动发现、多 venv 切换、依赖可视化
-  缺失的：无 conda，无缓存分析，无安全卸载分级，后端逻辑未完成，项目还不稳定

**参考价值**:  venv 发现 + 包管理 UX 最佳参考，但注意项目不成熟

---

## 三、PyPeek 的差异化定位

| 维度 | 现有工具 | PyPeek |
|------|---------|--------|
| 目标用户 | 开发者 | **Python 新手** |
| 启动方式 | 命令行 | **双击 start.bat** |
| 主要操作 | 创建/管理环境 | **浏览 + 理解 + 安全清理** |
| 覆盖范围 | 单一包管理器 | **pip + conda 双轨** |
| 安全机制 | 无 | ** 三级依赖检查** |
| 缓存可视化 | Jharu 有（清理定位） | **聚合数据 + 图表** |
| 桌面框架 | 混杂 | **pywebview（轻量原生窗口）** |

---

## 四、建议

1. **继续 PyPeek** — 无完全重叠项目，"新手友好的 Python 环境全景浏览器"是市场空白
2. **重点参考 Jharu** — 磁盘可视化和 venv 发现策略最成熟，考虑借鉴其 treemap/分类视图
3. **参考 VenviPy + pip_gui** — venv 交互和包管理 UX 设计
4. **警惕 pips** — 唯一同时覆盖 pip + conda 的 GUI，但其面向高级用户，与 PyPeek 用户群不重叠
5. **killpy 验证了需求** — 11 种环境类型检测 + 安全删除确认 + 大小报告 = 用户确实有这个痛点，但 killpy 是 CLI/TUI，PyPeek 做的是 GUI 新手版

### 7. killpy — CLI/TUI venv 清理工具（补充）

| 项目 | 详情 |
|------|------|
| 仓库 | https://github.com/Tlaloc-Es/killpy |
| 技术栈 | Python + Textual (TUI) |
| 维护 |  活跃 |

检测 11 种环境（venv/conda/poetry/pipx/pyenv/uv 等），TUI 表格浏览、大小报告、批量删除、`__pycache__` 清理。有安全确认流程，不静默删除。

**与 PyPeek 对比**: CLI/TUI 无 GUI，是"清理工具"而非"浏览器"，无包级详情和卸载安全分级。**但它验证了"用户需要看清 Python 环境磁盘占用"这个需求是真实存在的。**
