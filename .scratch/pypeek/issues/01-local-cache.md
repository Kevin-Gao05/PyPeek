# 01 — 本地扫描缓存

**What to build:** 扫描结果自动持久化到本地 JSON 文件，下次启动直接渲染缓存数据，用户手动刷新才重扫。

**Blocked by:** None — can start immediately.

**Soft dependency for:** 02（首次启动弹窗）、06（onboarding）—— 缓存模块提供了「首次启动检测」的标准方法，建议先做 01。

**Status:** ready-for-agent

- [ ] 扫描完成后，Python 安装、venv、pip 缓存数据写入 `%APPDATA%/PyPeek/cache.json`（Linux 则为 `~/.config/PyPeek/cache.json`）
- [ ] 启动时若缓存文件存在且有效，直接渲染缓存数据到 UI（统计卡片 + 三个标签页表格），不触发扫描
- [ ] 缓存数据加载完成后，用户仍可点「刷新」按钮触发全量重扫并更新缓存
- [ ] 缓存文件损坏或不存在时，静默回退到当前空状态（不影响启动）
- [ ] 缓存 schema 包含扫描时间戳和扫描摘要（盘符、文件数、耗时），为后续 02 号 ticket 提供数据
- [ ] 暴露 `load_cache()` / `save_cache(data)` 接口，返回 `None` 表示无缓存（首次启动），供其他 ticket 调用
