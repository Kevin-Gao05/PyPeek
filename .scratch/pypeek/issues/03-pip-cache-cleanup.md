# 03 — pip 缓存分类清理

**What to build:** pip 缓存面板每个分类增加「清理」按钮，走 preview → confirm → execute 三段式弹窗，支持按分类清理缓存。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] pip 缓存面板每个分类行（wheels / tarballs / http cache 等）出现「清理」按钮
- [ ] 点击「清理」→ `POST /api/cache/clear/preview` 干运行，弹窗显示该分类大小、文件数、风险警告（如「wheels 清空后下次 pip install 需重新下载」）
- [ ] 弹窗提供「取消」和「确认清理」按钮
- [ ] 确认后 → `POST /api/cache/clear` 执行清理（需 `confirm: true`），复用现有 modal → Toast 成功/失败提示
- [ ] 清理成功后 UI 即时刷新（重新渲染该分类数据，更新统计卡片）
- [ ] 若该分类为空（size = 0），清理按钮显示为 disabled 状态
- [ ] 提供「清理全部缓存」入口（pip 缓存总览区），preview 汇总所有分类
- [ ] API 端点和弹窗交互模式与现有卸载流程一致（preview dry-run → 确认 → 执行）
