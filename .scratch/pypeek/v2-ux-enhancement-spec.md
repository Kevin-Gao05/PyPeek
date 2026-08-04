# PyPeek v2 — 用户体验增强

## Problem Statement

PyPeek 目前完成了所有核心功能（Python 发现、Venv 发现、pip 缓存展示、包浏览器、安全卸载），但存在首排体验和操作闭环的缺口：

1. **首次启动空白**：用户打开 app 看到全是 `—` 和空状态提示，不知道要做什么，也没有数据仅本地处理的隐私声明。
2. **无状态，每次重扫**：关闭窗口后再次打开，之前发现的 Python 和 venv 全部丢失，必须重新跑全量扫描——全盘搜索在慢盘上很耗时。
3. **pip 缓存只能看不能清**：用户看到"pip 缓存占用 2.3 GB"后，必须关掉 PyPeek 去终端敲 `pip cache purge`——发现了问题但不能就地解决。
4. **Python 与 venv 缺乏关联**：venv 表格显示了「来源 Python」列，但用户无法从 Python 行看到「我创建了哪些 venv」，清理决策缺少上下文。
5. **重复环境只告知不操作**：扫描结束时弹出 Toast "有 N 个重复环境"，表格也有重复标签，但没有任何操作入口——用户知道有问题但无法在 app 内解决。

## Solution

在不改动现有架构的前提下，补齐 5 个操作闭环 + 1 个引导：

- **首次启动弹窗**：声明隐私策略（本地扫描，不上传）+ 展示即将扫描的范围 + 一键开始
- **本地 JSON 缓存**：扫描结果写入 `%APPDATA%/PyPeek/cache.json`，下次启动直接渲染，手动刷新才重扫
- **pip 缓存分类清理**：复用卸载的三段式流程（preview → 确认 → 执行），支持按 wheeels / tarballs / http 等分类清理
- **Python ↔ Venv 双向关联**：Python 行可展开「关联虚拟环境」子列表；Venv 行可反向跳转到父 Python
- **重复环境子标签**：虚拟环境标签页内建子标签「全部 / 可能重复」，重复子标签下提供对比视图和删除入口
- **轻量 onboarding**：首次启动后 3 步高亮提示（点击行展开包列表、安全等级含义、卸载流程）

## User Stories

### 首次启动

1. As a first-time user, I want to see a welcome dialog when I open PyPeek for the first time, so that I know what the app does and that my data stays on my computer.
2. As a privacy-conscious user, I want the welcome dialog to clearly state that all scanning is local-only and no data is uploaded anywhere, so that I feel safe using the app.
3. As a first-time user, I want the welcome dialog to tell me what will be scanned (PATH, registry, disk drives), so that I know what's going to happen.
4. As a first-time user, I want to click "Start Scan" in the dialog to begin the discovery process, so that I don't have to hunt for a refresh button.
5. As a returning user, I want to NOT see the welcome dialog on subsequent launches, so that I can get straight to my data.

### 扫描透明度

6. As a user waiting for a scan, I want to see a summary after scanning completes (drives scanned, files checked, time taken), so that I know the scan was thorough.
7. As a user with multiple drives, I want to know which drives were scanned and which were skipped, so that I understand the scan's coverage.

### 本地缓存

8. As a returning user, I want to see my previously discovered Python installations and venvs immediately when I open PyPeek, so that I don't have to wait for a full rescan every time.
9. As a user who just created a new venv, I want a "Refresh" button that re-runs the full scan, so that my new environment shows up.
10. As a user who just deleted a venv manually, I want the stale environment to be clearly marked or automatically removed on refresh, so that I don't see ghost entries.
11. As a user with a cache, I want the cache file to be small and unobtrusive (just JSON), so that PyPeek doesn't contradict its own disk-cleaning mission.

### pip 缓存清理

12. As a user with 2.3 GB of pip cache, I want to clear specific categories (e.g., just tarballs, not wheels), so that I can free up space selectively.
13. As a user about to clear cache, I want to see a risk warning (wheels cleared = need to re-download on next install), so that I can make an informed decision.
14. As a user, I want the cache-cleaning flow to look and feel like the uninstall flow (preview → confirm → execute), so that I don't have to learn a new interaction pattern.
15. As a user, I want to know how much space I'll reclaim before I confirm the clean, so that I can decide whether it's worth it.
16. As a user, I want the cache display to update immediately after cleaning, so that I can see the result of my action.

### 双向关联

17. As a user looking at a Python installation row, I want to see all the venvs that were created from this Python, so that I can understand the relationship between my environments.
18. As a user looking at a venv row, I want to click its parent Python to navigate directly to that Python's detail, so that I can compare packages between parent and child environments.
19. As a user with many venvs, I want to know which Python installation "owns" each venv, so that I can safely delete a Python knowing what venvs will break.
20. As a user, I want the parent-child relationship to be visually clear (e.g., indented sub-list, or linked with an arrow icon), so that I don't confuse it with the flat venv list.

### 重复环境子标签

21. As a user who has duplicate Python installations, I want a dedicated tab or sub-tab that shows only the duplicates, so that I can deal with them together.
22. As a user reviewing duplicate environments, I want to compare their paths, versions, and package counts side by side, so that I can decide which one to keep.
23. As a user, I want to delete a duplicate environment from the duplicates view, so that I can clean up without switching back to the main venv tab.
24. As a user, I want the duplicates view to be clearly separated from the main list (e.g., sub-tabs: "全部" / "可能重复"), so that the main list stays clean and focused.

### 轻量 Onboarding

25. As a first-time user, I want to be guided through the key interactions (click row → packages, safety badges, uninstall), so that I don't have to discover them by trial and error.
26. As an experienced user, I want to dismiss the onboarding immediately, so that it doesn't get in my way.
27. As a user going through onboarding, I want no more than 3 steps, so that it doesn't feel like a tutorial.

## Implementation Decisions

### Seam strategy

All features fall on existing codebase patterns wherever possible. Only two new seams are introduced:
- **Cache file I/O** — a single module responsible for reading/writing `cache.json`
- **`POST /api/cache/clear`** — follows the existing uninstall API pattern (preview → confirm → execute)

### Cache format

The cache file stores only the environment-discovery layer (Python installations + venvs). Package lists are NOT cached — they remain real-time via `pip list`.

```
%APPDATA%/PyPeek/cache.json:
{
  "scanned_at": "<ISO timestamp>",
  "scan_summary": {
    "drives_scanned": ["C:", "D:"],
    "files_checked": 14532,
    "duration_seconds": 8.5
  },
  "pythons": [...],   // same shape as current SSE data
  "venvs": [...],      // same shape as current SSE data
  "pip_cache": {...}   // same shape as current SSE data
}
```

Cache is invalidated by user-initiated refresh. No TTL, no background refresh — keep it simple. If the cache file doesn't exist or is corrupted, fall back to empty state (current behavior).

### First-launch detection

Check whether `cache.json` exists and is valid. If not → show welcome dialog. If yes → load cached data immediately, no dialog.

The welcome dialog reuses the existing Modal pattern (overlay + header/body/footer + Escape to close + click-outside-to-close). It cannot be dismissed without either starting a scan or explicitly choosing "Skip for now."

### pip cache cleanup API

Follows the exact same pattern as uninstall:

```
POST /api/cache/clear/preview
  Request:  {"categories": ["wheels", "tarballs"]}   // or "*" for all
  Response: {"total_size_mb": 280, "file_count": 47, "message": "This will remove 280 MB of cached wheel files. Next pip install will need to re-download them."}

POST /api/cache/clear
  Request:  {"categories": ["wheels", "tarballs"], "confirm": true}
  Response: {"ok": true, "message": "已清理 280 MB 缓存"}
```

The `preview` endpoint does NOT modify anything — it's a dry-run that returns what WOULD be deleted. The `clear` endpoint requires `confirm: true` as a safeguard.

Backend implementation: `pip cache remove <pattern>` for specific packages within each category, or targeted directory removal for category-level cleanup. System-level `pip cache purge` is NOT used — it's too blunt.

### Python ↔ Venv bidirectional linking

The `home_python` field from `pyvenv.cfg` (already collected by `scanner/venvs.py`) is the linking key. On the Python installations tab, a "Created venvs" count and expandable sub-list shows all venvs whose `home_python` matches this Python's path. On the venvs tab, the existing "来源 Python" column becomes a clickable link that selects and scrolls to the parent Python.

### Duplicate environments sub-tab

Add two sub-navigation buttons within the venvs panel: "全部" (all venvs) and "可能重复 (N)" (duplicates only). The duplicates sub-tab reuses the same table rendering as the main venv list, but filters to only show entries with a non-empty `duplicate_group`. Each row in the duplicates view gains a "delete" button (reusing the existing delete-venv flow).

### Lightweight onboarding

After first scan completes, show a 3-step overlay sequence (not a full tour library — just sequential tooltip-style highlights):

1. "点击 Python 或虚拟环境行 → 查看已安装的包" (highlight a table row)
2. "安全 / 警告 / 危险 — 卸载前三思" (highlight safety badges)
3. "点击统计卡片 → 快速跳转到对应标签页" (highlight stat cards)

Each step has "下一步" and "跳过" buttons. Onboarding is NOT shown if cache exists (returning user). It's triggered by the completion of the first-ever scan.

### Frontend architecture

No new frontend framework dependencies. All features are implemented in existing files:
- HTML in `static/index.html`
- CSS in `static/style.css`
- JS in `static/app.js`

The sub-tab pattern for duplicates reuses the existing `tab-bar__tab` CSS class. The bidirectional association uses an expandable sub-row pattern similar to the existing package sub-table.

## Testing Decisions

### What makes a good test

- **Backend modules**: Unit test by calling the function with known inputs and checking outputs. Subprocess calls to real pip/conda are mocked or use `--dry-run` equivalents.
- **API endpoints**: Start the server in test mode (`create_app().run()`), send HTTP requests, assert JSON responses.
- **Frontend**: Manual verification in browser mode — the primary test path since most features are UI changes.

### Modules under test

- `scanner/cache.py` — new module: read, write, invalidate cache. Test with temporary JSON files.
- `scanner/pip_cache.py` — modified: clear by category. Test with a dummy cache directory.
- `server/app.py` — new routes: `/api/cache/clear/preview` and `/api/cache/clear`. Test via HTTP.

### Prior art

The testing approach follows the existing pattern documented in `.claude/testing-guide.md`:
```bash
python3 -c "from scanner.site_packages import check_uninstall_safety; ..."
```

New test examples:
```bash
# Cache read/write
python3 -c "from scanner.cache import load_cache; print(load_cache())"

# pip cache clear preview
curl -X POST http://127.0.0.1:8080/api/cache/clear/preview \
  -H "Content-Type: application/json" \
  -d '{"categories": ["wheels"]}'
```

## Out of Scope

- Conda integration
- Settings/configuration tab
- Search/filter for package lists
- Batch uninstall
- Light/dark theme toggle
- Windows Store certification or signing
- Cache TTL, background refresh, or incremental sync
- Cloud sync or multi-machine cache sharing
- Any network-dependent features — PyPeek remains fully offline

## Further Notes

- The implementation order suggested by grilling was: welcome dialog → cache → pip cleanup → bidirectional association → duplicates sub-tab → onboarding. There are no mandatory dependencies between these features — each can be built and shipped independently.
- The welcome dialog's privacy language should be in Chinese (matching the app's UI language).
- The duplicates sub-tab should only appear when `duplicate_group` entries exist; otherwise the venv tab looks identical to today.
- The `cache.json` path on Windows resolves to `%APPDATA%/PyPeek/cache.json`. On Linux/macOS (dev environments), use `~/.config/PyPeek/cache.json` for XDG compliance.
