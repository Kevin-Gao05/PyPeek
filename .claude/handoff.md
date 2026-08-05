# PyPeek Handoff — 2026-08-05

## 当前状态

**分支**: `master` (commit `a1f9001`) — 已推送 origin/master。

**V1.1.0 已合并**（Ticket 01 缓存 / 02 欢迎弹窗 / 03 pip 清理）。
**Phase 1 全部 issue (#1-#8) 已关闭。**

## README 结构

```
README.md         ← 中文（默认展示）
README.en.md      ← 英文
```
顶部互链，更新日志需同步两份。

## 项目文档

| 文档 | 路径 |
|------|------|
| 项目 handoff | `.claude/handoff.md` |
| 贡献 + 版本号规范 | `CONTRIBUTING.md` |
| V2 Spec | `.scratch/pypeek/v2-ux-enhancement-spec.md` |
| 演示脚本 | `.scratch/pypeek/demo-video-script.md` |
| X 推广文案 | `.scratch/pypeek/x-promo.md` |

## 待开发

| Ticket | 说明 | 阻塞 |
|--------|------|------|
| 04 | Python ↔ Venv 双向关联 | 无 |
| 05 | 重复环境子标签 | 无 |
| 06 | 轻量 onboarding | 无 |

按 `CONTRIBUTING.md` 流程：从 master 切 `feat/<名称>` → 开发 → PR。

## 版本号规则

一批完整 ticket → 次版本（V1.1.0 → V1.2.0），单修补 → 修订号。

## Suggested Skills

1. **`/implement`** — ticket 04 / 05 / 06 任一张
2. **`/code-review`** — 每张 ticket 完后双轴检查
3. 完成一批后同步中英 README 更新日志
