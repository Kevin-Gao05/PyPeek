# PyPeek

双击即开，一眼看全你 Windows 机器上的 Python 安装、虚拟环境和 pip 缓存。安全清理不需要的，全程不用碰终端。

## 快速开始

```bat
git clone git@github.com:Kevin-Gao05/PyPeek.git
cd PyPeek
start.bat
```

需要 Windows 10 或 11，已安装 Python 3.10 以上。首次运行自动装 `pywebview`。

## 功能

打开后点右上角刷新，自动扫描本机，结果分四个标签页展示。

### Python 安装

列出本机所有 Python，从哪里装的、占多少空间、装了多少包。

- PATH 和 Windows 注册表双重查找
- 识别来源：python.org、Microsoft Store、Conda
- 同版本出现多次会标重复

### 虚拟环境

全盘搜索 `pyvenv.cfg`，列出路径、Python 版本、大小、包数量、最后修改时间。

- 自动跳过系统目录
- 最后修改时间用相对格式（"今天""3 天前"）
- 同目录下多个 venv 标重复

### pip 缓存

柱状图展示 pip 下载缓存，分类说明占用情况。

- 下载缓存、本地编译缓存、自检记录分类显示
- 每类有中文说明

### 包列表

点 Python 或 venv 行展开，看里面装了哪些包。

- 包名、版本、大小、简介
- 卸载安全等级标注

## 安全卸载

卸载前做检查，分三级：

**不可卸载** — pip、setuptools、wheel 等包管理基础设施，卸载导致 pip 不可用。按钮禁用。

**不建议卸载** — 其他包声称依赖它。弹窗列依赖者，需确认"强制卸载"。

**可以卸载** — 无已知依赖。弹窗提醒：PyPeek 检测不到你项目代码里的 import，确认再卸。

## 删除虚拟环境

点删除前做三道检查：必须有 `pyvenv.cfg`、拒绝符号链接、删完验证目录确实消失。

## 项目结构

```
main.py                  入口
start.bat                Windows 双击启动
scanner/
  pythons.py             Python 发现（PATH + 注册表）
  venvs.py               虚拟环境发现（pyvenv.cfg 搜索）
  pip_cache.py           pip 缓存分析
  site_packages.py       包详情、安全分级、卸载
server/
  app.py                 HTTP 路由、API、CORS
  sse.py                 SSE 进度推送
static/
  index.html             页面骨架
  style.css              暗色主题
  app.js                 前端逻辑
```

纯 Python 标准库，零 Web 框架依赖。前端原生 HTML/CSS/JS，暗色主题，无构建工具。扫描进度用 SSE 推送。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/scan` | 触发扫描，返回 scan_id |
| GET | `/api/scan/progress?scan_id=` | SSE 进度流 |
| GET | `/api/packages?python_path=` | 包列表 |
| POST | `/api/uninstall/preview` | 卸载前安全检查 |
| POST | `/api/uninstall` | 执行卸载 |
| POST | `/api/open-folder` | 资源管理器打开路径 |
| POST | `/api/delete-venv` | 删除虚拟环境 |

## 安全措施

- 所有传给 pip 的包名前加 `--` 分隔符，防参数注入
- `python_path` 做可执行文件名校验（白名单）
- 删除 venv 前检查符号链接、验证 pyvenv.cfg、确认目录删干净
- 静态文件路径穿越防护
- 扫描并发锁，同一时间只允许一个扫描
- CORS 仅允许 127.0.0.1 和 localhost

## 参与

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT
