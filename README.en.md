# PyPeek

[中文](README.md) | English

PyPeek — a desktop browser for your Python environments. Double-click to open, see every Python installation, virtual environment, and pip cache on your Windows machine at a glance. Clean up safely, no terminal needed.

> Currently in beta — some features are still in progress.

## Features

- **Python Discovery** — PATH scanning + Windows Registry lookup. Identifies installs from python.org, Microsoft Store, and Conda. Flags duplicate versions across multiple locations.
- **Virtual Environment Discovery** — Full-disk search for `pyvenv.cfg`. Lists path, Python version, disk usage, package count, and last modified time. Skips system directories automatically.
- **pip Cache Analysis** — Categorized view of download cache, locally-built wheels, and self-check records. Bar chart visualization of each category's footprint.
- **Package Browser** — Click any Python or venv row to expand its package list. Name, version, size, summary, and safety level per package.
- **Safe Uninstall** — Three-tier safety classification (safe / dependency conflict warning / system-critical blocked). Dry-run preview before uninstall. Dependency conflict modal lists all affected packages. Force uninstall requires explicit confirmation.
- **Virtual Environment Deletion** — Three safety checks: pyvenv.cfg verification, symlink rejection, post-delete existence check.
- **SSE Real-time Progress** — Scan progress pushed via Server-Sent Events. No polling.
- **Local Cache** — Scan results cached locally (`~/.config/PyPeek/cache.json`). Second launch loads instantly — no waiting.
- **pip Cache Cleanup** — Clear individual cache categories or all at once. Preview → confirm → execute flow shows size, file count, and risk warnings before deleting.

## Screenshots

> Windows only for now.

![Main interface](docs/screenshots/01-overview.png)
*Python discovery — Swiss design system, stat cards + data table*

![pip cache](docs/screenshots/02-pip-cache.png)
*pip cache bar chart — download / wheels / selfcheck by category*

![Packages](docs/screenshots/03-packages.png)
*Package browser — safety badges, expandable rows*

![Uninstall warning](docs/screenshots/04-uninstall-warning.png)
*Dependency conflict warning — lists affected packages, requires confirmation*

## Tech Stack

Python 3.10+ standard library (`http.server.ThreadingHTTPServer`) + pywebview desktop shell | Frontend: vanilla HTML/CSS/JS, zero frameworks, zero build tools | Swiss design system (Helvetica Neue + Swiss Red + 1px hairline grid)

## Quick Start

**Requirements**: Windows 10 or 11, Python 3.10+ installed.

```bat
git clone git@github.com:Kevin-Gao05/PyPeek.git
cd PyPeek
start.bat
```

First run auto-installs `pywebview`, then opens the desktop window.

**Linux/macOS (dev mode, no GUI)**:

```bash
python3 -c "from server.app import create_app; create_app().run()"
# Open http://127.0.0.1:8080
```

## Project Structure

```
main.py                   Entry point: starts HTTP server + pywebview window
start.bat                 Windows one-click launcher
scanner/
  pythons.py              Python install discovery (PATH + registry)
  venvs.py                Virtual environment discovery (pyvenv.cfg full-disk search)
  pip_cache.py            pip cache analysis & categorization
  site_packages.py        Package details, safety classification, uninstall
  cache.py                Local scan result cache
server/
  app.py                  HTTP routing, REST API, CORS
  sse.py                  SSE event manager (thread-safe queue)
static/
  index.html              Single-page shell + welcome modal + uninstall modal + toast
  style.css               Swiss design system (CSS custom properties)
  app.js                  Frontend logic: SSE consumer, table rendering, uninstall flow, cache cleanup
```

Pure Python standard library. Zero web framework dependencies. Frontend is vanilla HTML/CSS/JS — no build tools. Scan progress pushed via SSE in real time.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/cache` | Returns cached scan results (`cached: false` = first launch) |
| GET | `/api/scan` | Triggers full scan, returns `scan_id` |
| GET | `/api/scan/progress?scan_id=` | SSE event stream (real-time progress), `scan_complete` includes scan summary |
| GET | `/api/pip-cache` | Returns current pip cache data |
| GET | `/api/packages?python_path=` | Returns package list for a given Python environment |
| POST | `/api/uninstall/preview` | Pre-uninstall safety check (dry-run), returns safety level |
| POST | `/api/uninstall` | Execute uninstall, `{python_path, package, force?}` |
| POST | `/api/cache/clear/preview` | Preview cache cleanup (dry-run), returns size, file count, risk warning |
| POST | `/api/cache/clear` | Execute cache cleanup, `{category_path, confirm}` or `{all: true, confirm}` |
| POST | `/api/open-folder` | Open path in system file explorer |
| POST | `/api/delete-venv` | Delete a virtual environment (with safety checks) |

### Uninstall Flow

```
Click "Uninstall"
  → POST /api/uninstall/preview to check safety level
    → safe: confirm dialog → user confirms → POST /api/uninstall
    → warning: dependency conflict dialog (lists required_by) → user confirms → POST /api/uninstall {force: true}
    → danger: blocked dialog, button disabled, backend returns 403
  → Auto-refresh package list + toast notification on success
```

### Safety Levels

| Level | Condition | Behavior |
|-------|-----------|----------|
| `safe` | No known dependencies | Uninstall after confirmation |
| `warning` | Other packages depend on it | Modal lists dependents, force uninstall requires explicit confirmation |
| `danger` | pip / setuptools / wheel / pkg_resources | Button disabled + 403, unconditionally blocked |

## Security

- **Injection prevention** — `--` separator prepended to all package names passed to pip
- **Path validation** — `python_path` validated against executable name whitelist
- **Deletion protection** — venv deletion checks for symlinks, verifies pyvenv.cfg, confirms directory removal
- **Path traversal prevention** — static file server rejects `..` and absolute paths
- **Concurrency control** — global scan lock, one scan at a time
- **CORS restriction** — only `127.0.0.1` and `localhost` origins allowed
- **Dual safety check** — frontend preview + backend force flag; system-critical packages cannot be uninstalled

## Known Limitations

- Windows only (pywebview desktop window). Linux/macOS can run the web interface in dev mode.
- Does not check project-level `requirements.txt` or `pyproject.toml` for dependency declarations.
- Uninstall only runs `pip uninstall` — does not clean up user scripts or config files.
- Conda environment discovery not yet implemented (`scanner/conda.py` is a placeholder).
- No batch uninstall.
- No dark/light theme toggle (currently Swiss light theme).

## Changelog

### V1.1.0 (2026-08-04)

Three tickets merged, focused on launch experience and cache management.

**Additions**
- Local scan cache (`scanner/cache.py`) — scan results saved to `~/.config/PyPeek/cache.json`, loaded instantly on subsequent launches
- First-launch welcome dialog — privacy notice + scan scope preview, "Start Scan" / "Later" options
- Scan summary row — displays drives, file count, and duration after scan completes
- pip cache category cleanup — "Clear" button per category + "Clear All" in summary
- `GET /api/cache` — returns cached data with `cached` flag
- `GET /api/pip-cache`, `POST /api/cache/clear/preview`, `POST /api/cache/clear` — cache cleanup API

**Improvements**
- `scan_complete` SSE event now includes `scan_summary` field

**Fixes**
- pip cache UI not fully refreshing after clearing a category

### V1.0.0 (2026-08-03)

Initial release.

- Python discovery: PATH + Windows Registry, identifies python.org / Microsoft Store / Conda sources, flags duplicates
- Virtual environment discovery: full-disk `pyvenv.cfg` search, path/version/size/package count/last modified
- pip cache analysis: categorized bar chart showing download cache / local builds / self-check records
- Package browser: expandable rows, safety badges (safe / warning / danger), pip show enrichment
- Safe uninstall: three-tier classification + dependency conflict modal + force confirmation + path validation + injection prevention
- Virtual environment deletion: three safety checks (pyvenv.cfg verification, symlink rejection, post-delete existence check)
- SSE real-time progress: scan phases and percentage pushed via Server-Sent Events
- Swiss design system: Helvetica Neue + Swiss Red + 1px hairline, CSS custom properties
- Zero web framework: `ThreadingHTTPServer` + vanilla HTML/CSS/JS, no third-party dependencies

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
