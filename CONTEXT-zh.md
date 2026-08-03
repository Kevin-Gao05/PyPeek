# PyPeek — 领域模型

一个桌面工具，帮助新手看懂自己 Windows 机器上有哪些 Python 相关的东西。

## 术语表

| 术语 | 定义 | 来源 |
|------|------|------|
| **Python 安装** | 系统上安装的 Python 解释器。可能来自 python.org、Microsoft Store、conda 或其他渠道。每个安装都有自己的 `python.exe` 和 `site-packages`。 | PyPA 打包指南 |
| **虚拟环境 (venv)** | 通过 `python -m venv` 创建的隔离 Python 环境，由 `pyvenv.cfg` 文件标识。拥有独立的 `site-packages` 和 `Scripts/python.exe`。 | [PEP 405](https://peps.python.org/pep-0405/) |
| **包 (Package)** | 可分发的 Python 代码单元（wheel、sdist 或 conda tarball）。已安装的包位于 `site-packages` 中。 | pip 和 conda 官方文档 |
| **site-packages** | Python 安装或虚拟环境中存放第三方包的目录（`Lib/site-packages`）。 | pip 官方文档 |
| **包缓存** | 下载的包文件的本地存储，跨安装复用。pip：`%LOCALAPPDATA%\pip\cache`。conda：`pkgs/` 目录。 | pip 和 conda 官方文档 |
| **完整扫描** | 工具的默认发现模式：扫描 PATH、Windows 注册表和文件系统，定位 Python 安装、虚拟环境、缓存和包。 | — |
| **深度扫描** | 可选的文件系统遍历，在常见位置之外搜索散落的虚拟环境和 Python 安装。在后台运行，通过 SSE 推送进度。 | — |
| **Required-by（被依赖列表）** | `pip show <pkg>` 的输出字段，列出依赖此包的其他包。用于评估卸载安全性。 | pip 官方文档 |

## 安全等级

| 等级 | 含义 | 触发条件 |
|------|------|----------|
|  安全 | 可以安全卸载，无副作用 | `Required-by` 列表为空 |
|  警告 | 其他包依赖此包 | `Required-by` 非空 |
|  危险 | 系统必需 — 绝对不能删除 | 包名为 `pip`、`setuptools`、`wheel` 或 `pkg_resources` |

## 模块优先级

1. Python 安装发现（PATH + 注册表 → 快速；文件系统深度扫描 → 可选）
2. 虚拟环境发现（`pyvenv.cfg` 搜索）
3. pip 包缓存（`pip cache info` + 目录扫描）
4. site-packages 详情（先展示名称、版本、大小；再异步补充 Summary 和 Required-by）
5. conda 环境 + 缓存（仅在系统检测到 conda 时启用）
