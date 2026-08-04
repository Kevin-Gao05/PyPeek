# 04 — Python ↔ Venv 双向关联

**What to build:** Python 安装行显示其创建的 venv 数量及可展开子列表；venv 行的「来源 Python」列变为可点击链接，跳转到对应 Python 安装行。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Python 安装表格新增「关联 venv」列（或行内徽章），显示该 Python 创建的 venv 数量（基于 `home_python` 字段匹配）
- [ ] 点击 Python 行的 venv 数量 → 展开子列表，显示所有由此 Python 创建的 venv（路径、版本、大小），可进一步跳转到 venv 标签页
- [ ] Venv 表格「来源 Python」列由纯文本改为可点击链接
- [ ] 点击 venv 的父 Python 链接 → 自动切换到「Python 安装」标签页，高亮并滚动到对应行
- [ ] 若 venv 的 `home_python` 为空或匹配不到已知 Python，显示「未知」且不可点击
- [ ] 子列表展开/收起遵循现有行展开的交互模式（再次点击收起，点击另一行切换）
