# PyPeek — Spec

## Problem Statement

A beginner has installed Python on Windows (python.org, Microsoft Store, or conda — they don't know which). They followed tutorials, ran `pip install` and maybe `conda install`, created a few project folders with `.venv` directories. Months later, their C drive is red. They don't know:

- Which Python installations are on their machine
- Where virtual environments live and which ones are still used
- How much space pip and conda caches are eating
- What packages are installed where, and whether any can be safely removed

They open PyPeek, see everything at a glance, and clean up safely — without touching a terminal.

## Solution

PyPeek is a **desktop application** (native window via pywebview) that automatically discovers and visualizes the user's Python ecosystem on Windows. It surfaces: every Python installation on the machine, every virtual environment, pip and conda package caches, and detailed per-package information with safety ratings. Users can safely uninstall packages through the GUI with dependency-warning protection.

## User Stories

### Discovery & First Launch

1. As a beginner, I want to download PyPeek from GitHub by double-clicking `start.bat`, so that I don't need to type terminal commands.
2. As a beginner, I want PyPeek to show me results immediately on launch (within 1 second), so that I don't wonder if it's broken.
3. As a beginner, I want to see a progress bar while PyPeek searches my machine more deeply, so that I know it's still working.
4. As a beginner, I want PyPeek to find my Python installations even if they aren't on PATH, so that I discover things I forgot I installed.

### Python Installations

5. As a beginner, I want to see every Python installation on my machine with its version, source (python.org / Microsoft Store / conda), and disk usage, so that I know what I have.
6. As a beginner, I want to click a Python installation and see every package installed in its global site-packages, so that I understand what came with each Python.

### Virtual Environments

7. As a beginner, I want PyPeek to find all my `.venv` directories across my entire machine, so that I discover ones I forgot about.
8. As a beginner, I want to see each venv's Python version, total size, package count, and last-modified date, so that I can judge which ones are old and unused.
9. As a beginner, I want to click a venv and see its installed packages with sizes, so that I understand what's inside each environment.
10. As a beginner, I want to know which Python installation a venv was created from, so that I understand the relationship between them.

### Package Cache

11. As a beginner, I want to see how much space pip's download cache is using, broken down by category, so that I realize this is reclaimable space.
12. As a beginner, I want to see the cache size as a visual chart, not raw terminal output, so that I can understand it at a glance.
13. As a user who also has conda, I want to see my conda package cache size alongside pip's, so that I have a complete picture.

### Package Management

14. As a beginner, I want to see each package's name, version, and disk size, so that I know what's taking up space.
15. As a beginner, I want a short description of what each package does, so that I don't uninstall something important by accident.
16. As a beginner, I want to know which other packages depend on a given package, so that I understand the consequences of removing it.
17. As a beginner, I want each package color-coded (green = safe to remove, yellow = other things depend on it, red = system-critical), so that I can make safe decisions without understanding Python internals.
18. As a beginner, I want to click "Uninstall" on a green package and have it removed immediately, so that I can reclaim space.
19. As a beginner, I want a clear warning when I try to uninstall a yellow package, listing exactly what will break, so that I don't accidentally destroy my projects.
20. As a beginner, I want PyPeek to refuse to uninstall red (system-critical) packages, so that I can't break Python itself.

### Conda Integration

21. As a conda user, I want PyPeek to show all my conda environments with their packages, so that I have a unified view.
22. As someone who doesn't use conda, I want PyPeek to hide conda-related information entirely, so that the interface stays simple.

### Settings & Customization

23. As an intermediate user, I want to limit the file system scan to specific directories, so that scanning is faster and only covers my project areas.
24. As an intermediate user, I want to trigger a re-scan without restarting the application, so that I can see changes after installing or removing things outside PyPeek.

## Implementation Decisions

### Architecture

1. **Desktop shell**: pywebview wraps a native Windows window around an HTML/CSS/JS frontend. No browser chrome, no address bar.
2. **Backend**: Python standard library `ThreadingHTTPServer` serves both static files and a JSON/SSE API on localhost.
3. **Real-time scanning**: Server-Sent Events (SSE) push phase snapshots as each scanner module runs. The frontend subscribes to a single SSE endpoint and renders results progressively.
4. **Frontend**: Single-page application (vanilla HTML/CSS/JS, dark theme, no framework). Five tabs corresponding to the five discovery modules. Stat card dashboard on launch.
5. **Data collection**: All external data gathered via `subprocess` calls to `pip`, `conda`, Windows registry queries, and filesystem walks through `os.scandir`.

### Scanning Strategy

6. **Two-phase scan**: Phase A (fast path) runs PATH lookup and Windows registry reads on startup — results appear in under 1 second. Phase B (deep scan) walks the filesystem in background, reporting progress via SSE.
7. **Python discovery**: PATH (`where python`) + registry (`HKLM\SOFTWARE\Python\PythonCore\`, `HKCU\SOFTWARE\Python\PythonCore\`) + optional filesystem walk for unregistered installations.
8. **Python source detection**: Heuristic based on install path — `WindowsApps` → Microsoft Store; `anaconda`/`miniconda` → conda; `Program Files\Python` → python.org.
9. **Venv discovery**: Recursive filesystem search for `pyvenv.cfg` files. Safety exclusions: skip `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`, `$Recycle.Bin`. Do not follow Windows junction/reparse points.
10. **Venv detail**: Read `pyvenv.cfg` for Python version and home Python. Compute directory size via `os.scandir` walk. Get package list via `pip list --format json --python <path>`.
11. **Package cache discovery**: Parse `pip cache info` for aggregate numbers. Walk `%LOCALAPPDATA%\pip\cache` for per-category breakdown. Fall back to filesystem-only if `pip` is not on PATH.
12. **Site-packages detail**: For each Python or venv, get package list via `pip list --format json --python <path>`. Compute per-package directory sizes via `os.scandir`. Fast display shows name + version + size immediately; background enrichment adds Summary and Required-by via `pip show <pkg> --python <path>`.
13. **Conda integration**: Detect conda presence before scanning (`conda --version` or `where conda`). If absent, skip the entire conda module and hide the conda tab. If present, discover envs via `conda env list --json` and packages via `conda list --json --prefix <path>`.

### Safety & Uninstall

14. **Safety levels**:  Safe (no reverse dependencies),  Warning (has reverse dependencies),  Critical (`pip`, `setuptools`, `wheel`, `pkg_resources` — uninstall rejected unconditionally).
15. **Dependency check**: Before uninstall, run `pip show <pkg> --python <path>` and parse the `Required-by` field.
16. **Uninstall flow**: User clicks "Uninstall" → backend checks dependencies → if , returns the list of dependent packages → frontend shows warning modal → user confirms with explicit second action → backend runs `pip uninstall -y <pkg> --python <path>`.
17. **No undo**: Uninstall is permanent (matching pip behavior). Recovery is via `pip install` — which the user can do outside PyPeek.

### API Contracts

18. **Scan trigger**: `GET /api/scan` starts a scan, returns `{"scan_id": "<uuid>", "status": "started"}`.
19. **Scan progress**: `GET /api/scan/progress?scan_id=<uuid>` is an SSE stream. Events: `phase_update` (partial snapshot per scanner phase) and `scan_complete` (full data).
20. **SSE event shape** (`phase_update`):

```json
{
  "phase": "pythons|venvs|pip_cache|site_packages|conda",
  "done": false,
  "progress": 0.35,
  "pythons": [{"path": "...", "version": "3.12.10", "source": "python.org", "package_count": 23, "site_packages_size_mb": 1200}],
  "venvs": [{"path": "...", "python_version": "3.12.10", "home_python": "...", "total_size_mb": 156, "package_count": 12, "last_modified": "2026-07-15T14:30:00", "packages": [...]}],
  "pip_cache": null,
  "conda_envs": null
}
```

21. **Uninstall**: `POST /api/uninstall` with `{"python_path": "...", "package": "numpy"}`. Returns `{"ok": true}` or `{"ok": false, "error": "DEPENDENCY_CONFLICT", "required_by": ["pandas"]}`. A second call with `{"force": true}` proceeds despite warnings.

### Frontend Design

22. **Theme**: Dark (background `#0F172A`, surface `#1E293B`, accent `#7C3AED`). No external CSS framework.
23. **Layout**: Header bar → scan progress bar → stat cards (Python count, venv count, cache size, package count) → tab bar (Pythons, Venvs, pip Cache, Packages, Conda) → scrollable content area.
24. **Progress bar**: Real-time, driven by SSE `progress` field. Shows current phase name and found count.
25. **Expandable rows**: Clicking a Python installation or venv row expands an inline package table.
26. **Safety badges**: // badges rendered next to each package name in package lists.
27. **Conda tab visibility**: Hidden by default, shown only when conda is detected and scan results include conda data.
28. **Tooltips**: `?` icons next to domain terms (venv, site-packages, pip cache) with one-line explanations for beginners.

### Multi-Drive Support

29. **Drive roots**: Scan all available drive roots (C:\, D:\, E:\, etc.) during deep scan. Apply the same safety exclusions on each drive.

## Testing Decisions

### What Makes a Good Test

- Test against the **HTTP API seam** — the single seam between frontend and backend. Every test sends HTTP requests and asserts on JSON responses.
- Test **external behavior**, not internal implementation. Don't test that `scanner/pythons.py` calls a specific registry key; test that `GET /api/scan/progress` returns Python installations with the correct shape.
- Mock subprocess calls where the real tool (`pip`, `conda`) is unavailable, but prefer integration tests on a system where these tools exist.
- For the uninstall flow: test that dependency conflicts are detected and that force-uninstall works after conflict confirmation.

### Modules Under Test

| Module | Test Focus |
|--------|-----------|
| Python discovery | PATH parsing, registry reading, deduplication |
| Venv discovery | `pyvenv.cfg` finding, safety exclusions, size computation |
| pip cache | `pip cache info` parsing, directory walk fallback |
| Site-packages | Package listing, size computation, dependency parsing |
| Conda | Detection gating, env listing |
| SSE manager | Thread safety, phase ordering, completion signal |
| Uninstall | Safety check, force flag, error handling |

## Out of Scope

- **uv support**: uv was explicitly excluded. This tool focuses on pip and conda, the two package managers that create the most confusion for beginners on Windows.
- **Install/upgrade packages**: Only uninstall is supported. Installing or upgrading requires dependency resolution that is beyond this tool's scope.
- **Cross-platform**: Windows only. Linux and macOS are out of scope.
- **Remote/network scanning**: Only local Python installations and packages. No scanning of remote servers or cloud environments.
- **Package search/recommendation**: No PyPI search or package suggestions.
- **Bulk uninstall**: One package at a time, with individual dependency checks each time.
- **Undo/rollback**: Uninstall is permanent. No snapshot or rollback.
- **Non-Python disk usage**: Only Python-related directories. PyPeek is not a general disk analyzer.

## Further Notes

- The implementation plan (`plans/implementation-plan.md`) provides detailed module-by-module breakdowns. This spec is the authoritative requirements document; the implementation plan is the engineering execution guide.
- The domain model (`CONTEXT.md`) defines all terminology. All code, UI labels, and documentation must use the canonical terms from the glossary.
- This spec was produced by `/grill-with-docs` — every decision was reached through adversarial interview with the stakeholder.
