# PyPeek — Domain Model

A desktop tool that helps beginners see what Python things are on their Windows machine.

## Glossary

| Term | Definition | Source |
|------|-----------|--------|
| **Python installation** | A Python interpreter installed on the system. May come from python.org, Microsoft Store, conda, or other channels. Each installation has its own `python.exe` and `site-packages`. | PyPA packaging guide |
| **Virtual environment (venv)** | An isolated Python environment created by `python -m venv`, identified by a `pyvenv.cfg` file. Has its own `site-packages` and `Scripts/python.exe`. | [PEP 405](https://peps.python.org/pep-0405/) |
| **Package** | A distributable unit of Python code (wheel, sdist, or conda tarball). Installed packages live in `site-packages`. | pip and conda official docs |
| **site-packages** | The directory inside a Python installation or venv where third-party packages are installed (`Lib/site-packages`). | pip official docs |
| **Package cache** | Local storage of downloaded package files reused across installs. pip: `%LOCALAPPDATA%\pip\cache`. conda: `pkgs/` directory. | pip and conda official docs |
| **Full scan** | The tool's default discovery mode: scans PATH, Windows registry, and filesystem to locate Python installations, venvs, caches, and packages. | — |
| **Deep scan** | Optional filesystem walk that searches beyond common locations for stray venvs and Python installations. Runs in background with progress via SSE. | — |
| **Required-by** | The `pip show <pkg>` field listing packages that depend on the given package. Used to assess uninstall safety. | pip official docs |

## Safety Levels

| Level | Meaning | Condition |
|-------|---------|-----------|
|  Safe | Can be uninstalled without side effects | `Required-by` list is empty |
|  Warning | Other packages depend on this one | `Required-by` is non-empty |
|  Critical | System-essential — do NOT remove | Package name is `pip`, `setuptools`, `wheel`, or `pkg_resources` |

## Module Priority

1. Python installation discovery (PATH + registry → fast; filesystem deep scan → optional)
2. Virtual environment discovery (`pyvenv.cfg` search)
3. pip package cache (`pip cache info` + directory scan)
4. site-packages detail (name, version, size first; Summary + Required-by async)
5. conda environments + cache (only if conda detected on system)
