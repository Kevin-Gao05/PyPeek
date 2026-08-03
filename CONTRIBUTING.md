# 参与贡献

## 分支规范

| 分支 | 用途 | 示例 |
|------|------|------|
| `master` | 稳定版本，可随时发布 | — |
| `feat/<名称>` | 新功能 | `feat/conda-support` |
| `fix/<名称>` | 修复 bug | `fix/delete-button-race` |
| `docs/<名称>` | 纯文档变更 | `docs/api-reference` |
| `refactor/<名称>` | 重构（不改行为） | `refactor/scanner-cache` |
| `test/<名称>` | 纯测试 | `test/uninstall-edge-cases` |

## 提交流程

```
1. Fork 仓库（有写权限的直接建分支）

2. 从 master 切分支：
   git checkout master
   git pull origin master
   git checkout -b feat/你的功能

3. 改完跑测试：
   python tests/test_runner.py

4. 提交信息格式：
   feat: 添加 conda 环境检测
   fix: 修复卸载按钮双击
   docs: 更新 API 文档

5. 推送分支：
   git push origin feat/你的功能

6. 向 master 发起 Pull Request
```

## 提交信息格式

```
<类型>: <简短描述>

<可选：解释为什么这样改>
```

类型：`feat`（新功能）、`fix`（修复）、`docs`（文档）、`refactor`（重构）、`test`（测试）、`chore`（杂项）

示例：
```
feat: 添加 pip 缓存一键清除按钮
fix: 处理 venv 扫描器中的 Unicode 路径
docs: 补充 Windows 测试指南
refactor: 提取路径校验公共函数
test: 覆盖删除 venv 的边缘情况
chore: 升级 pywebview 到最新版
```

## Pull Request 规范

- 一个 PR 只做一件事，不要把不相关的改动用在一起。
- PR 标题遵循上面的提交信息格式。
- 提交前跑 `python tests/test_runner.py`。
- 涉及 GUI 的改动，注明是否在 Windows 实机上测过。

## 代码风格

- **Python**：沿用 `scanner/` 和 `server/` 的现有写法。只用标准库，不引入第三方 Web 框架。
- **JavaScript**：原生 ES6，不依赖构建工具。所有动态元素通过 `document` 级事件委托统一处理。
- **CSS**：暗色主题，CSS 自定义属性定义在 `:root`。不用预处理器。
- **注释**：领域逻辑用中文，标准 docstring 用英文。

## 有疑问？

到 GitHub 提 Issue：https://github.com/Kevin-Gao05/PyPeek/issues
